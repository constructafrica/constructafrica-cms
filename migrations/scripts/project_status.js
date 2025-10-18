const fs = require('fs');
const path = require('path');
const { getDirectus } = require("../helpers/upload-image");
const { readItems, createItems } = require('@directus/sdk');

const projectStatuses = [
    { value: 'conceptplanning', label: 'Concept / Planning' },
    { value: 'studyfeasibility', label: 'Study / Feasibility' },
    { value: 'design', label: 'Design' },
    { value: 'eoi', label: 'Main Contract Prequalification / Call for Expression of Interest (EOI)' },
    { value: 'maincontractbid', label: 'Main Contract Bid' },
    { value: 'maincontractidevaluation', label: 'Main Contract Bid Evaluation' },
    { value: 'executionunderconstruction', label: 'Execution / Under Construction' },
    { value: 'onhold', label: 'On Hold' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'complete', label: 'Complete' }
];

// Function to check if project status already exists
async function checkExisting(directus, key) {
    try {
        const existing = await directus.request(
            readItems('project_status', {
                filter: { name: { _eq: key } },
                fields: ['id'],
                limit: 1
            })
        );
        return existing && existing.length > 0 ? existing[0] : null;
    } catch (error) {
        console.error(`❌ Error checking existing project status ${key}:`, error.message);
        return null;
    }
}

// Function to create a single project status
async function createProjectStatus(directus, type) {
    try {
        // Check if already exists
        const existing = await checkExisting(directus, type.label);

        if (existing) {
            console.log(`  🔄 project status already exists: ${type.label}`);
            return { id: existing.id, action: 'skipped' };
        }

        // Create new project status
        const itemData = {
            drupal_key: type.value,
            name: type.label,
        };

        const newItem = await directus.request(
            createItems('project_status', itemData)
        );

        console.log(`  ✅ Created project status: ${type.label}`);
        return { id: newItem.id, action: 'created' };
    } catch (error) {
        console.error(`  ❌ Error creating project status ${type.label}:`, error.message);
        return { id: null, action: 'failed', error: error.message };
    }
}

// Migrate project status to Directus
async function migrateProjectStatus() {
    let directus;

    try {
        directus = await getDirectus();
        console.log('✅ Directus client initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Directus client:', error.message);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Directus initialization failed: ${error}\n`);
        process.exit(1);
    }

    console.log(`🔄 Migrating ${projectStatuses.length} project status...`);

    const results = {
        created: 0,
        skipped: 0,
        failed: 0
    };

    // Process each project status sequentially
    for (const type of projectStatuses) {
        const result = await createProjectStatus(directus, type);

        if (result.action === 'created') {
            results.created++;
        } else if (result.action === 'skipped') {
            results.skipped++;
        } else if (result.action === 'failed') {
            results.failed++;
        }
    }

    // Log results
    console.log('\n📊 Migration Summary:');
    console.log(`  ✅ Created: ${results.created}`);
    console.log(`  🔄 Skipped: ${results.skipped}`);
    console.log(`  ❌ Failed: ${results.failed}`);
    console.log(`  📝 Total: ${ProjectStatus.length}`);

    // Write success log
    const successMessage = `${new Date().toISOString()} - Successfully migrated ${results.created} project status (${results.skipped} skipped, ${results.failed} failed)\n`;
    fs.appendFileSync(path.join(__dirname, 'logs/migration_success.log'), successMessage);

    if (results.failed > 0) {
        throw new Error(`${results.failed} project status failed to migrate`);
    }

    return results;
}

// Ensure logs directory exists
function ensureLogsDirectory() {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
}

// Main execution
(async () => {
    try {
        ensureLogsDirectory();
        console.log('🚀 Starting project status migration...');
        await migrateProjectStatus();
        console.log('✅ Migration complete');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        fs.appendFileSync(path.join(__dirname, 'logs/migration_errors.log'), `${new Date().toISOString()} - Migration failed: ${error.message}\n`);
        process.exit(1);
    }
})();