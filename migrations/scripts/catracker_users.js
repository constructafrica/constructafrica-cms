require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/upload-image');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { uploadImage } = require('../helpers/upload-image');
const { escapeCsv, formatDateTimeForCsv } = require('../helpers/index');
const { readUsers, createUser, updateUser, readItems, createItems, updateItems, readRoles } = require('@directus/sdk');
const {csvDir} = require("../helpers");

// Fetch all users from Drupal
async function fetchUsers() {
    const api = await getAuthenticatedApi(true);
    let allData = [];
    let includedData = [];
    let nextUrl = '/user/user';
    let page = 1;

    const params = {
        'page[limit]': 5,
    };

    try {
        console.log('📥 Fetching all users with roles and corporate accounts...');
        // while (nextUrl) {
            console.log(`📄 Fetching page ${page}...`);
            const response = await api.get(nextUrl, {
                params: page === 1 ? params : {}
            });

            const records = response.data.data || [];
            allData = allData.concat(records);

            console.log(`✅ Page ${page}: ${records.length} users`);

        //     nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
        //     page++;
        //     await new Promise(resolve => setTimeout(resolve, 300));
        // }
        console.log(`🎉 Fetched ${allData.length} users across ${page} pages`);
        return { data: allData, included: includedData };
    } catch (error) {
        console.error('❌ Users fetch failed on page', page, ':', error.response?.status, error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token might be expired, resetting authentication...');
            resetAuth();
        }

        fs.appendFileSync('logs/migration_errors.log', `Users fetch failed on page ${page}: ${error}\n`);
        throw error;
    }
}

// Create or update a user in Directus
async function createOrUpdateUser(directus, userData) {
    try {
        // Check if user exists by email
        const existingUsers = await directus.request(
            readItems('catracker_users', {
                filter: { name: { _eq: userData.name } },
                limit: 1
            })
        );

        if (existingUsers && existingUsers.length > 0) {
            console.log(`🔄 User ${userData.name} Already exist`);
            return { success: true, userId: existingUsers[0].id };
        } else {
            // Create new user
            const newUser = await directus.request(
                createItems('catracker_users', userData)
            );
            console.log(`✅ Created user: ${userData.name}`);
            return { success: true, action: 'created', userId: newUser.id };
        }
    } catch (error) {
        const errorMessage = error.message || error;
        console.error(`❌ Error processing user ${userData.email}: ${errorMessage}`);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - User ${userData.first_name} ${userData.last_name} ${userData.email} failed: ${errorMessage}\n`);
        return { success: false, error: errorMessage };
    }
}

// Main migration function
async function migrateUsersToDirectus() {
    console.log('\n🚀 Starting user migration process...\n');

    // Initialize Directus client
    let directus;
    try {
        directus = await getDirectus();
    } catch (error) {
        console.error('❌ Failed to initialize Directus client:', error.message);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Directus initialization failed: ${error}\n`);
        process.exit(1);
    }

    // Fetch data from Drupal
    const usersData = await fetchUsers();

    const usersCsvHeaders = [
        'id', 'name', 'migration_status', 'migration_action'
    ];
    const usersCsv = [usersCsvHeaders.join(',')];

    console.log('\n👥 Processing users...');
    let userCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    let createdCount = 0;
    let failedCount = 0;

    for (const user of usersData.data) {
        let migrationStatus = 'failed';
        let migrationAction = 'none';

        try {
            const attributes = user.attributes || {};

            console.log('User Data', user);
            // Prepare user data
            const userData = {
                id: user.id,
                username: attributes.display_name || '',
                first_name: attributes.field_user_first_name || '',
                last_name: attributes.field_user_last_name || '',
                email: attributes.mail,
                role: user.relationships?.roles?.data[0]?.meta.drupal_internal__target_id,
                company: attributes.field_company || '',
                country: attributes.field_country || '',
                phone: attributes.field_phone || '',
                subscribe_email: attributes.message_subscribe_email || false,
                drupal_id: attributes.drupal_internal__uid || null,
                status: attributes.status ? 'active' : 'suspended',
                date_created: attributes.created,
                date_updated: attributes.changed
            };

            // Create or update user
            const result = await createOrUpdateUser(directus, userData);

            if (result.success) {
                userCount++;
                migrationStatus = 'success';
                migrationAction = result.action;

                if (result.action === 'created') createdCount++;
                if (result.action === 'updated') updatedCount++;
            } else {
                failedCount++;
                migrationStatus = 'failed';
                migrationAction = 'error';
            }

            // Add to CSV backup
            usersCsv.push([
                user.id,
                escapeCsv(userData.name),
                migrationStatus,
                migrationAction
            ].join(','));

            if (userCount % 50 === 0) {
                console.log(`  Processed ${userCount} users...`);
            }

        } catch (error) {
            console.error(`❌ Error processing user ${user.id}:`, error);
            failedCount++;

            // Add to CSV with error status
            const attributes = user.attributes || {};
            usersCsv.push([
                user.id,
                escapeCsv(attributes.name || ''),
                'failed',
                'exception'
            ].join(','));

            fs.appendFileSync(
                'logs/migration_errors.log',
                `User ${user.name} processing failed: ${error}\n${error.stack}\n`
            );
        }
    }

    // Write CSV files
    console.log('\n💾 Writing CSV backup files...');
    fs.writeFileSync(path.join(csvDir, 'catracker_users_migration.csv'), usersCsv.join('\n'), 'utf8');

    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Users created: ${createdCount}`);
    console.log(`🔄 Users updated: ${updatedCount}`);
    console.log(`⏭️  Users skipped: ${skippedCount}`);
    console.log(`❌ Users failed: ${failedCount}`);

    if (failedCount > 0) {
        console.log(`\n📜 Check logs/migration_errors.log for details`);
    }

}

// Run the migration
migrateUsersToDirectus().catch((error) => {
    console.error('\n❌ MIGRATION FAILED:', error.message);
    console.error(error.stack);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync(
        'logs/migration_errors.log',
        `\n\n=== MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`
    );
    process.exit(1);
});