const fs = require('fs');
const path = require('path');
const { getDirectus } = require("../helpers/upload-image");
const { readItems, createItems } = require('@directus/sdk');
const {csvDir, logDir} = require('../helpers/index');

// Hardcoded project types from Drupal allowed_values
const projectTypes = [
    { value: 'hospital', label: 'Hospital' },
    { value: 'hotel', label: 'Hotel' },
    { value: 'clinic', label: 'Clinic' },
    { value: 'diagnosticcenter', label: 'Diagnostic Center' },
    { value: 'residentialbuilding', label: 'Residential Building' },
    { value: 'commercialbuilding', label: 'Commercial Building' },
    { value: 'officebuilding', label: 'Office Building' },
    { value: 'mall', label: 'Mall' },
    { value: 'shoppingcentre', label: 'Shopping Centre' },
    { value: 'supermarket', label: 'Supermarket' },
    { value: 'school', label: 'School' },
    { value: 'university', label: 'University' },
    { value: 'library', label: 'Library' },
    { value: 'governmentbuilding', label: 'Government Building' },
    { value: 'theatre', label: 'Theatre' },
    { value: 'auditorium', label: 'Auditorium' },
    { value: 'stadium', label: 'Stadium' },
    { value: 'mixeduseddevelopment', label: 'Mixed Use Development' },
    { value: 'market', label: 'Market' },
    { value: 'carpark', label: 'Car Park' },
    { value: 'worshipfacility', label: 'Worship Facility' },
    { value: 'park', label: 'Park' },
    { value: 'aquaticcentre', label: 'Aquatic Centre' },
    { value: 'science&technologypark', label: 'Science & Technology Park' },
    { value: 'roadshighways', label: 'Roads / Highways' },
    { value: 'airport', label: 'Airport' },
    { value: 'bridge', label: 'Bridge' },
    { value: 'seaport', label: 'Seaport' },
    { value: 'sportsfacility', label: 'Sports Facility' },
    { value: 'railway', label: 'Railway' },
    { value: 'busterminus', label: 'Bus Terminus' },
    { value: 'brt', label: 'BRT' },
    { value: 'aerialtramway(cablecar)', label: 'Aerial Tramway (Cable Car)' },
    { value: 'tunnel', label: 'Tunnel' },
    { value: 'storageterminal', label: 'Storage Terminal' },
    { value: 'watertreatmentplant', label: 'Water Treatment Plant' },
    { value: 'sewagetreatmentplant', label: 'Sewage Treatment Plant' },
    { value: 'waterpipeline', label: 'Water Pipeline' },
    { value: 'sewagepipeline', label: 'Sewage Pipeline' },
    { value: 'waterstoragereservoir', label: 'Water Storage Reservoir' },
    { value: 'dam', label: 'Dam' },
    { value: 'datacentre', label: 'Data Centre' },
    { value: 'submarinecable', label: 'Submarine Cable' },
    { value: 'fibreopticnetwork', label: 'Fibre Optic Network' },
    { value: 'telecomfacility', label: 'Telecom Facility' },
    { value: 'productionfacility', label: 'Production Facility' },
    { value: 'warehouse', label: 'Warehouse' },
    { value: 'others', label: 'Others' },
    { value: 'hydroelectric', label: 'Hydro-Electric' },
    { value: 'solarenergy(over100watts)', label: 'Solar Energy (over 100 Watts)' },
    { value: 'windenergy', label: 'Wind Energy' },
    { value: 'powertransmission', label: 'Power Transmission' },
    { value: 'nuclearenergy', label: 'Nuclear Energy' },
    { value: 'geothermalenergy', label: 'Geothermal Energy' },
    { value: 'biomassenergy', label: 'Biomass Energy' }
];

// Function to check if project type already exists
async function checkExistingProjectType(directus, key) {
    try {
        const existing = await directus.request(
            readItems('project_types', {
                filter: { name: { _eq: key } },
                fields: ['id'],
                limit: 1
            })
        );
        return existing && existing.length > 0 ? existing[0] : null;
    } catch (error) {
        console.error(`❌ Error checking existing project type ${key}:`, error.message);
        return null;
    }
}

// Function to create a single project type
async function createProjectType(directus, type) {
    try {
        // Check if already exists
        const existing = await checkExistingProjectType(directus, type.label);

        if (existing) {
            console.log(`  🔄 Project type already exists: ${type.label}`);
            return { id: existing.id, action: 'skipped' };
        }

        // Create new project type
        const itemData = {
            drupal_key: type.value,
            name: type.label,
        };

        const newItem = await directus.request(
            createItems('project_types', itemData)
        );

        console.log(`  ✅ Created project type: ${type.label}`);
        return { id: newItem.id, action: 'created' };
    } catch (error) {
        console.error(`  ❌ Error creating project type ${type.label}:`, error.message);
        return { id: null, action: 'failed', error: error.message };
    }
}

// Migrate project types to Directus
async function migrateProjectTypes() {
    let directus;

    try {
        directus = await getDirectus();
        console.log('✅ Directus client initialized');
    } catch (error) {
        console.error('❌ Failed to initialize Directus client:', error.message);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Directus initialization failed: ${error}\n`);
        process.exit(1);
    }

    console.log(`🔄 Migrating ${projectTypes.length} project types...`);

    const results = {
        created: 0,
        skipped: 0,
        failed: 0
    };

    // Process each project type sequentially
    for (const type of projectTypes) {
        const result = await createProjectType(directus, type);

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
    console.log(`  📝 Total: ${projectTypes.length}`);

    // Write success log
    const successMessage = `${new Date().toISOString()} - Successfully migrated ${results.created} project types (${results.skipped} skipped, ${results.failed} failed)\n`;
    fs.appendFileSync(path.join(__dirname, 'logs/migration_success.log'), successMessage);

    if (results.failed > 0) {
        throw new Error(`${results.failed} project types failed to migrate`);
    }

    return results;
}

// Main execution
(async () => {
    try {
        console.log('🚀 Starting project types migration...');
        await migrateProjectTypes();
        console.log('✅ Migration complete');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        fs.appendFileSync(path.join(__dirname, 'logs/migration_errors.log'), `${new Date().toISOString()} - Migration failed: ${error.message}\n`);
        process.exit(1);
    }
})();