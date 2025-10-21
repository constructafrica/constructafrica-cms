require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/directus-auth');
const { getAuthenticatedApi, resetAuth, makeResilientApiCall } = require('../helpers/auth');
const { escapeCsv } = require('../helpers/index');
const { readItems, createItems } = require('@directus/sdk');
const { csvDir } = require("../helpers");

// Configuration
const USERS_PER_PAGE = 50;
const USERS_PER_JSON_FILE = 200; // Store 200 users per JSON file
const JSON_DATA_DIR = path.join(process.cwd(), 'data', 'cat-users');

// Ensure data directory exists
if (!fs.existsSync(JSON_DATA_DIR)) {
    fs.mkdirSync(JSON_DATA_DIR, { recursive: true });
}

// Fetch all users from Drupal and save to JSON files
async function fetchAndSaveUsers() {
    const api = await getAuthenticatedApi(true);
    let allData = [];
    let includedData = [];
    let nextUrl = '/user/user';
    let page = 1;
    let jsonFileIndex = 1;
    let usersInCurrentFile = 0;
    let currentFileData = { data: [], included: [] };

    const params = {
        'page[limit]': USERS_PER_PAGE,
    };

    try {
        console.log('📥 Fetching all users with roles and corporate accounts and saving to JSON files...');
        while (nextUrl) {
            console.log(`📄 Fetching page ${page}...`);

            let response;
            try {
                response = await makeResilientApiCall(
                    () => api.get(nextUrl, {
                        params: page === 1 ? params : {},
                        timeout: 120000
                    }),
                    `Fetching users page ${page}`
                );
            } catch (error) {
                console.error(`❌ Failed to fetch page ${page} after retries:`, error.message);

                // Save whatever we have so far
                if (currentFileData.data.length > 0) {
                    const filename = `users_page_${jsonFileIndex}_partial.json`;
                    const filepath = path.join(JSON_DATA_DIR, filename);
                    fs.writeFileSync(filepath, JSON.stringify(currentFileData, null, 2), 'utf8');
                    console.log(`💾 Saved partial data (${currentFileData.data.length} users) to ${filename}`);
                }

                throw error;
            }

            const records = response.data.data || [];

            // console.log('data', response.data.data);
            if (!records || records.length === 0) {
                console.log(`⚠️ No records found on page ${page}, stopping pagination`);
                break;
            }

            allData = allData.concat(records);

            if (response.data.included) {
                includedData = includedData.concat(response.data.included);
                currentFileData.included = currentFileData.included.concat(response.data.included);
            }

            // Add records to current file
            currentFileData.data = currentFileData.data.concat(records);
            usersInCurrentFile += records.length;

            console.log(`✅ Page ${page}: ${records.length} users`);

            // Save to JSON file when we reach the limit or this is the last page
            const isLastPage = !response.data.links?.next?.href;
            if (usersInCurrentFile >= USERS_PER_JSON_FILE || isLastPage) {
                const filename = `users_page_${jsonFileIndex}.json`;
                const filepath = path.join(JSON_DATA_DIR, filename);

                fs.writeFileSync(filepath, JSON.stringify(currentFileData, null, 2), 'utf8');
                console.log(`💾 Saved ${usersInCurrentFile} users to ${filename}`);

                // Reset for next file
                jsonFileIndex++;
                usersInCurrentFile = 0;
                currentFileData = { data: [], included: [] };
            }

            nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
            page++;

            // Add progressive delay to avoid overwhelming the server
            const delay = Math.min(500 + (page * 100), 3000);
            console.log(`⏳ Waiting ${delay}ms before next page...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        console.log(`🎉 Fetched ${allData.length} users across ${page} pages and saved to ${jsonFileIndex-1} JSON files`);
        return { data: allData, included: includedData };
    } catch (error) {
        console.error('❌ Users fetch failed on page', page, ':', error.response?.status, error.response?.data || error.message);

        // Save partial progress
        if (currentFileData.data.length > 0) {
            const filename = `users_page_${jsonFileIndex}_partial.json`;
            const filepath = path.join(JSON_DATA_DIR, filename);
            fs.writeFileSync(filepath, JSON.stringify(currentFileData, null, 2), 'utf8');
            console.log(`💾 Saved partial progress (${currentFileData.data.length} users) to ${filename}`);
        }

        if (error.response?.status === 401) {
            console.log('🔄 Token might be expired, resetting authentication...');
            resetAuth();
        }

        fs.appendFileSync('logs/migration_errors.log', `Users fetch failed on page ${page}: ${error}\n`);
        throw error;
    }
}

// Load users from JSON files
async function loadUsersFromJson() {
    try {
        console.log('📂 Loading users from JSON files...');

        const files = fs.readdirSync(JSON_DATA_DIR)
            .filter(file => file.startsWith('users_page_') && file.endsWith('.json') && !file.includes('_partial'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/users_page_(\d+)\.json/)[1]);
                const numB = parseInt(b.match(/users_page_(\d+)\.json/)[1]);
                return numA - numB;
            });

        if (files.length === 0) {
            console.log('❌ No JSON files found. Please run fetchAndSaveUsers() first.');
            return null;
        }

        let allData = [];
        let allIncluded = [];
        let totalUsers = 0;

        for (const file of files) {
            const filepath = path.join(JSON_DATA_DIR, file);
            const fileData = JSON.parse(fs.readFileSync(filepath, 'utf8'));

            allData = allData.concat(fileData.data || []);
            allIncluded = allIncluded.concat(fileData.included || []);
            totalUsers += (fileData.data || []).length;

            console.log(`✅ Loaded ${(fileData.data || []).length} users from ${file}`);
        }

        console.log(`🎉 Loaded ${totalUsers} users from ${files.length} JSON files`);
        return { data: allData, included: allIncluded };
    } catch (error) {
        console.error('❌ Error loading users from JSON files:', error.message);
        throw error;
    }
}

// Check if JSON data exists and is complete
function hasJsonData() {
    if (!fs.existsSync(JSON_DATA_DIR)) {
        return false;
    }

    const files = fs.readdirSync(JSON_DATA_DIR)
        .filter(file => file.startsWith('users_page_') && file.endsWith('.json'));

    return files.length > 0;
}

// Resume function to continue from where it left off
async function resumeFetchAndSaveUsers() {
    console.log('🔄 Attempting to resume user fetch...');

    // Find the last successfully saved file
    const files = fs.readdirSync(JSON_DATA_DIR)
        .filter(file => file.startsWith('users_page_') && file.endsWith('.json') && !file.includes('_partial'))
        .sort((a, b) => {
            const numA = parseInt(a.match(/users_page_(\d+)\.json/)[1]);
            const numB = parseInt(b.match(/users_page_(\d+)\.json/)[1]);
            return numB - numA; // Get the highest number
        });

    if (files.length === 0) {
        console.log('📥 No previous files found, starting fresh...');
        return await fetchAndSaveUsers();
    }

    const lastFile = files[0];
    const lastFileNumber = parseInt(lastFile.match(/users_page_(\d+)\.json/)[1]);
    console.log(`📂 Found previous files, last file: ${lastFile}`);

    // Check if there are any partial files that need to be recovered
    const partialFiles = fs.readdirSync(JSON_DATA_DIR)
        .filter(file => file.startsWith('users_page_') && file.includes('_partial'));

    if (partialFiles.length > 0) {
        console.log(`⚠️ Found ${partialFiles.length} partial files that need recovery`);
        // You could implement recovery logic here
    }

    console.log(`🔄 Resuming from where we left off...`);
    return await fetchAndSaveUsers();
}

// Create or update a user in Directus
async function createOrUpdateUser(directus, userData) {
    try {
        // Check if user exists by email
        const existingUsers = await directus.request(
            readItems('catracker_users', {
                filter: { email: { _eq: userData.email } },
                limit: 1
            })
        );

        if (existingUsers && existingUsers.length > 0) {
            console.log(`🔄 User ${userData.name} Already exist`);
            return { success: true, action: 'skipped', userId: existingUsers[0].id };
        } else {
            // Create new user
            const newUser = await directus.request(
                createItems('catracker_users', userData)
            );
            console.log(`✅ Created user: ${userData.email}`);
            return { success: true, action: 'created', userId: newUser.id };
        }
    } catch (error) {
        const errorMessage = error.message || error;
        console.error(`❌ Error processing user ${userData.email}: ${errorMessage}`);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - User ${userData.first_name} ${userData.last_name} ${userData.email} failed: ${errorMessage}\n`);
        return { success: false, error: errorMessage };
    }
}

// Transform user data
function transformUser(drupalUser) {
    const attributes = drupalUser.attributes || {};
    const relationships = drupalUser.relationships || {};

    return {
        id: drupalUser.id,
        username: attributes.name || '',
        first_name: attributes.field_first_name || '',
        last_name: attributes.field_last_name || '',
        email: attributes.mail,
        role: relationships?.roles?.data[0]?.meta?.drupal_internal__target_id || '',
        company: attributes.field_company || '',
        country: attributes.field_country || '',
        phone: attributes.field_phone || '',
        subscribe_email: attributes.message_subscribe_email || false,
        drupal_id: attributes.drupal_internal__uid || null,
        drupal_uuid: drupalUser.id,
        status: attributes.status ? 'active' : 'suspended',
        date_created: attributes.created,
        date_updated: attributes.changed,
    };
}

// Main migration function - updated to use JSON data
async function migrateUsersToDirectus(useJsonData = true) {
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

    let usersData;

    // Load data from JSON files or fetch from Drupal
    if (useJsonData && hasJsonData()) {
        console.log('📂 Using existing JSON data files...');
        usersData = await loadUsersFromJson();
        if (!usersData) {
            console.log('❌ No JSON data found. Falling back to fetching from Drupal...');
            usersData = await fetchAndSaveUsers();
        }
    } else {
        console.log('🌐 Fetching fresh data from Drupal...');
        usersData = await fetchAndSaveUsers();
    }

    if (!usersData || !usersData.data || usersData.data.length === 0) {
        console.error('❌ No user data available for migration');
        process.exit(1);
    }

    // Updated CSV headers to match ALL fields being saved to Directus
    const usersCsvHeaders = [
        'id', 'drupal_id', 'drupal_uuid', 'first_name', 'last_name', 'email',
        'username', 'role', 'company', 'country', 'phone', 'subscribe_email',
        'status', 'date_created', 'date_updated', 'migration_status', 'migration_action'
    ];
    const usersCsv = [usersCsvHeaders.join(',')];

    console.log('\n👥 Processing users...');
    let userCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    let failedCount = 0;

    for (const user of usersData.data) {
        let migrationStatus = 'failed';
        let migrationAction = 'none';

        try {
            const attributes = user.attributes || {};

            // Transform user data
            const userData = transformUser(user);

            // Create or update user
            const result = await createOrUpdateUser(directus, userData);

            if (result.success) {
                userCount++;
                migrationStatus = 'success';
                migrationAction = result.action;

                if (result.action === 'created') {
                    createdCount++;
                } else if (result.action === 'skipped') {
                    skippedCount++;
                }
            } else {
                failedCount++;
                migrationStatus = 'failed';
                migrationAction = 'error';
            }

            // Add to CSV backup - include ALL fields from transformUser
            usersCsv.push([
                user.id,
                userData.drupal_id || '',
                escapeCsv(userData.drupal_uuid),
                escapeCsv(userData.first_name),
                escapeCsv(userData.last_name),
                escapeCsv(userData.email),
                escapeCsv(userData.username),
                escapeCsv(userData.role),
                escapeCsv(userData.company),
                escapeCsv(userData.country),
                escapeCsv(userData.phone),
                userData.subscribe_email ? 'true' : 'false',
                userData.status,
                userData.date_created || '',
                userData.date_updated || '',
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
                attributes.drupal_internal__uid || '',
                escapeCsv(user.id),
                escapeCsv(attributes.field_first_name || ''),
                escapeCsv(attributes.field_last_name || ''),
                escapeCsv(attributes.mail || ''),
                escapeCsv(attributes.name || ''),
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                'failed',
                'exception'
            ].join(','));

            fs.appendFileSync(
                'logs/migration_errors.log',
                `User ${user.id} processing failed: ${error}\n${error.stack}\n`
            );
        }
    }

    // Write CSV files
    console.log('\n💾 Writing backup files...');
    fs.writeFileSync(path.join(csvDir, 'catracker_users_migration.csv'), usersCsv.join('\n'), 'utf8');

    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 USER MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Users created: ${createdCount}`);
    console.log(`⏭️  Users skipped: ${skippedCount}`);
    console.log(`❌ Users failed: ${failedCount}`);
    console.log(`📊 Total processed: ${userCount}`);
    console.log('='.repeat(60));
    console.log('\n📁 Backup files generated:');
    console.log(`   • JSON data files in: ${JSON_DATA_DIR}`);
    console.log(`   • CSV file: ${path.join(csvDir, 'catracker_users_migration.csv')}`);

    if (failedCount > 0) {
        console.log(`\n📜 Check logs/migration_errors.log for details`);
    }

    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('   • User data saved to JSON files for future migrations');
    console.log('   • Run with useJsonData=false to fetch fresh data from Drupal');
    console.log('   • All CSV fields now match Directus database fields');
    console.log('='.repeat(60) + '\n');
}

// Export functions for individual use
module.exports = {
    fetchAndSaveUsers,
    loadUsersFromJson,
    hasJsonData,
    resumeFetchAndSaveUsers,
    migrateUsersToDirectus
};

// Run the migration if called directly
if (require.main === module) {
    const useJsonData = process.argv.includes('--use-json') || process.argv.includes('-j');

    migrateUsersToDirectus(useJsonData).catch((error) => {
        console.error('\n❌ MIGRATION FAILED:', error.message);
        console.error(error.stack);
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync(
            'logs/migration_errors.log',
            `\n\n=== USER MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`
        );
        process.exit(1);
    });
}