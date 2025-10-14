require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/upload-image');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { readRoles, createRole, updateRole } = require('@directus/sdk');


// Role mapping from Drupal to Directus
const ROLE_MAPPING = {
    'administrator': { directus_role: 'Administrator', priority: 100, subscription_type: null, description: 'Administrator role for full access' },
    'super_editor': { directus_role: 'Super Editor', priority: 90, subscription_type: null, description: 'Super Editor role for full access' },
    'publisher': { directus_role: 'Publisher', priority: 90, subscription_type: null, description: 'Publisher role for content publishing' },
    'editor': { directus_role: 'Editor', priority: 80, subscription_type: null, description: 'Editor role for content creation' },
    'basic_content_editor': { directus_role: 'Content Editor', priority: 70, subscription_type: null, description: 'Content Editor for limited content access' },
    'coordinator': { directus_role: 'Coordinator', priority: 60, subscription_type: null, description: 'Coordinator for view-only access' },
    'premium': { directus_role: 'Subscriber', priority: 50, subscription_type: 'premium', description: 'Subscriber for premium content access' },
    'paid_corporate': { directus_role: 'Subscriber', priority: 50, subscription_type: 'corporate', description: 'Subscriber for premium content access' },
    'paid_individual': { directus_role: 'Subscriber', priority: 50, subscription_type: 'individual', description: 'Subscriber for premium content access' },
    'subscriber': { directus_role: 'Subscriber', priority: 40, subscription_type: 'basic', description: 'Subscriber for premium content access' },
    'reports': { directus_role: 'Subscriber', priority: 40, subscription_type: 'reports', description: 'Subscriber for premium content access' },
    'demo': { directus_role: 'Authenticated', priority: 30, subscription_type: 'demo', description: '' },
    'newsletter': { directus_role: 'Authenticated', priority: 20, subscription_type: null, description: '' },
    'opinion': { directus_role: 'Authenticated', priority: 20, subscription_type: null, description: '' },
    'free': { directus_role: 'Authenticated', priority: 10, subscription_type: null, description: '' },
    'authenticated': { directus_role: 'Authenticated', priority: 5, subscription_type: null, description: 'Authenticated user for basic access' },
    'anonymous': { directus_role: 'Public', priority: 0, subscription_type: null, description: 'Public role for anonymous access' },
};

// Fetch all roles from Drupal
async function fetchRoles() {
    const api = await getAuthenticatedApi();
    let allData = [];
    let nextUrl = '/user_role/user_role';
    let page = 1;

    try {
        console.log('📥 Fetching all roles...');
        while (nextUrl) {
            console.log(`📄 Fetching page ${page}...`);
            const response = await api.get(nextUrl, {
                params: { 'page[limit]': 100 }
            });

            const records = response.data.data || [];
            allData = allData.concat(records);
            console.log(`✅ Page ${page}: ${records.length} roles`);

            nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
            page++;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        console.log(`🎉 Fetched ${allData.length} roles across ${page} pages`);
        return allData;
    } catch (error) {
        console.error('❌ Roles fetch failed on page', page, ':', error.response?.status, error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token might be expired, resetting authentication...');
            resetAuth();
        }
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/migration_errors.log', `Roles fetch failed on page ${page}: ${error.message}\n`);
        throw error;
    }
}

// Create or update a role in Directus
async function createOrUpdateRole(directus, role) {

    try {
        // Check if role exists by name
        const existingRoles = await directus.request(
            readRoles({
                filter: { name: { _eq: role.name } }
            })
        );

        if (existingRoles && existingRoles.length > 0) {
            // Update existing role
            await directus.request(
                updateRole(existingRoles[0].id, {
                    name: role.name,
                    description: role.description,
                    admin_access: role.is_admin,
                    app_access: true
                })
            );
            console.log(`🔄 Updated role: ${role.name}`);
        } else {
            // Create new role
            await directus.request(
                createRole({
                    id: role.id,
                    name: role.name,
                    description: role.description,
                    admin_access: role.is_admin,
                    app_access: true
                })
            );
            console.log(`✅ Created role: ${role.name}`);
        }
        return true;
    } catch (error) {
        const errorMessage = error.message || error;
        console.error(`❌ Error processing role ${role.name}: ${errorMessage}`);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Role ${role.name} failed: ${errorMessage}\n`);
        return false;
    }
}

// Migrate roles directly to Directus
async function migrateRolesToDirectus() {
    console.log('\n🚀 Starting role migration process...\n');

    // Initialize Directus client
    let directus;
    try {
        directus = await getDirectus();
    } catch (error) {
        console.error('❌ Failed to initialize Directus client:', error.message);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Directus initialization failed: ${error}\n`);
        process.exit(1);
    }

    // Fetch roles from Drupal
    const rolesData = await fetchRoles();

    // Process unique Directus roles
    console.log('\n📋 Processing roles for Directus...');
    const uniqueDirectusRoles = {};
    const processedRoleIds = new Set();

    for (const role of rolesData) {
        const drupalRoleId = role.attributes.drupal_internal__id;
        const mapping = ROLE_MAPPING[drupalRoleId];

        if (mapping && !uniqueDirectusRoles[mapping.directus_role]) {
            uniqueDirectusRoles[mapping.directus_role] = {
                id: role.id, // Use Drupal UUID
                name: mapping.directus_role,
                description: mapping.description,
                drupal_role_id: drupalRoleId,
                is_admin: role.attributes.is_admin || mapping.directus_role === 'Administrator'
            };
        }
        processedRoleIds.add(role.id);
    }

    // Create or update roles in Directus
    let successCount = 0;
    let failCount = 0;

    for (const [roleName, roleInfo] of Object.entries(uniqueDirectusRoles)) {
        const success = await createOrUpdateRole(directus, roleInfo);
        if (success) {
            successCount++;
        } else {
            failCount++;
        }
    }

    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Roles migrated: ${successCount}`);
    console.log(`❌ Roles failed: ${failCount}`);
    console.log('='.repeat(60));
    if (failCount > 0) {
        console.log(`📜 Check logs/migration_errors.log for details`);
    }
    console.log('\n⚠️ IMPORTANT NOTES:');
    console.log('   • Administrator role is automatically assigned to admin users');
    console.log('   • Run setup_permissions.js to apply role permissions');
    console.log('='.repeat(60) + '\n');
}

// Run the migration
migrateRolesToDirectus().catch((error) => {
    console.error('\n❌ MIGRATION FAILED:', error.message);
    console.error(error.stack);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync(
        'logs/migration_errors.log',
        `\n\n=== MIGRATION FAILED ===\n${new Date().toISOString()}\n${error}\n${error.stack}\n`
    );
    process.exit(1);
});