require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { escapeCsv, formatDateTimeForCsv } = require('../helpers/index');
const { uploadImage } = require('../helpers/upload-image');

// Role mapping from Drupal to Directus
const ROLE_MAPPING = {
    'administrator': { directus_role: 'Administrator', priority: 100, subscription_type: null },
    'publisher': { directus_role: 'Publisher', priority: 95, subscription_type: null },
    'super_editor': { directus_role: 'Super Editor', priority: 90, subscription_type: null },
    'editor': { directus_role: 'Editor', priority: 80, subscription_type: null },
    'basic_content_editor': { directus_role: 'Content Editor', priority: 70, subscription_type: null },
    'coordinator': { directus_role: 'Coordinator', priority: 60, subscription_type: null },
    'premium': { directus_role: 'Subscriber', priority: 50, subscription_type: 'premium' },
    'paid_corporate': { directus_role: 'Subscriber', priority: 50, subscription_type: 'corporate' },
    'paid_individual': { directus_role: 'Subscriber', priority: 50, subscription_type: 'individual' },
    'subscriber': { directus_role: 'Subscriber', priority: 40, subscription_type: 'basic' },
    'reports': { directus_role: 'Subscriber', priority: 40, subscription_type: 'reports' },
    'demo': { directus_role: 'Authenticated', priority: 30, subscription_type: 'demo' },
    'newsletter': { directus_role: 'Authenticated', priority: 20, subscription_type: null },
    'opinion': { directus_role: 'Authenticated', priority: 20, subscription_type: null },
    'free': { directus_role: 'Authenticated', priority: 10, subscription_type: null },
    'authenticated': { directus_role: 'Authenticated', priority: 5, subscription_type: null },
    'anonymous': { directus_role: 'Public', priority: 0, subscription_type: null },
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

// Fetch all users from Drupal
async function fetchUsers() {
    const api = await getAuthenticatedApi();
    let allData = [];
    let includedData = [];
    let nextUrl = '/user/user?include=roles,field_corporate_accounts,user_picture';
    let page = 1;

    const params = {
        'page[limit]': 50, // Reduced for better handling
    };

    try {
        console.log('📥 Fetching all users with roles and corporate accounts...');
        while (nextUrl) {
            console.log(`📄 Fetching page ${page}...`);
            const response = await api.get(nextUrl, {
                params: page === 1 ? params : {}
            });

            const records = response.data.data || [];
            allData = allData.concat(records);
            if (response.data.included) {
                includedData = includedData.concat(response.data.included);
            }
            console.log(`✅ Page ${page}: ${records.length} users`);

            nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
            page++;
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        console.log(`🎉 Fetched ${allData.length} users across ${page} pages`);
        return { data: allData, included: includedData };
    } catch (error) {
        console.error('❌ Users fetch failed on page', page, ':', error.response?.status, error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token might be expired, resetting authentication...');
            resetAuth();
        }
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/migration_errors.log', `Users fetch failed on page ${page}: ${error.message}\n`);
        throw error;
    }
}

// Get user's roles from included data
function getUserRolesFromIncluded(userRolesData, includedData) {
    if (!userRolesData || !Array.isArray(userRolesData)) return [];

    const roles = [];
    for (const roleRef of userRolesData) {
        const role = includedData.find(item =>
            item.type === 'user_role--user_role' && item.id === roleRef.id
        );
        if (role) {
            roles.push(role);
        }
    }
    return roles;
}

// Determine primary role based on priority
function determinePrimaryRole(userRoles) {
    let highestPriority = -1;
    let primaryMapping = ROLE_MAPPING['authenticated']; // Default
    let allDrupalRoles = [];

    for (const role of userRoles) {
        const drupalRoleId = role.attributes.drupal_internal__id;
        allDrupalRoles.push(drupalRoleId);

        const mapping = ROLE_MAPPING[drupalRoleId];
        if (mapping && mapping.priority > highestPriority) {
            highestPriority = mapping.priority;
            primaryMapping = { ...mapping, drupal_role_id: drupalRoleId };
        }
    }

    return {
        ...primaryMapping,
        all_drupal_roles: allDrupalRoles
    };
}

// Map Directus role name to UUID (using Drupal UUID for consistency)
function getDirectusRoleId(directusRoleName, rolesData) {
    // For Administrator, use a fixed UUID or find the first admin role
    if (directusRoleName === 'Administrator') {
        const adminRole = rolesData.find(r => r.attributes.is_admin === true);
        return adminRole ? adminRole.id : null;
    }

    // For other roles, use Drupal UUID directly
    const drupalRoleId = Object.keys(ROLE_MAPPING).find(
        key => ROLE_MAPPING[key].directus_role === directusRoleName
    );

    if (drupalRoleId) {
        const role = rolesData.find(r => r.attributes.drupal_internal__id === drupalRoleId);
        return role ? role.id : null;
    }

    return null;
}

// Map Drupal file UUID to Directus file ID
async function getProfilePictureId(fileData, included) {
    if (!fileData || !fileData.id) return '';
    try {
        const directusFileId = await uploadImage(fileData.id, 'users');
        return directusFileId || '';
    } catch (error) {
        console.error(`❌ Failed to upload profile picture for file ${fileData.id}:`, error.message);
        return '';
    }
}

// Get corporate account members
function getCorporateAccountMembers(fieldCorporateAccounts, includedData) {
    if (!fieldCorporateAccounts || !Array.isArray(fieldCorporateAccounts)) return [];

    const members = [];
    for (const memberRef of fieldCorporateAccounts) {
        const member = includedData.find(item =>
            item.type === 'user--user' && item.id === memberRef.id
        );
        if (member) {
            members.push({
                id: member.id,
                uid: member.attributes.drupal_internal__uid,
                email: member.attributes.mail,
                name: member.attributes.display_name
            });
        }
    }
    return members;
}

// Determine access level based on subscription
function determineAccessLevel(subscriptionType, subscriptionExpiry) {
    if (!subscriptionType) return 'free';

    if (subscriptionExpiry) {
        const expiryDate = new Date(subscriptionExpiry);
        const now = new Date();
        if (expiryDate < now) return 'expired';
    }

    if (['corporate', 'premium', 'individual', 'reports'].includes(subscriptionType)) {
        return 'premium';
    }

    if (subscriptionType === 'basic') return 'subscriber';

    return 'free';
}

// Generate CSVs for roles, users, user_roles, and corporate_accounts
async function generateUsersAndRolesCsv() {
    const csvDir = path.join(__dirname, '../csv');
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    // Fetch data
    console.log('\n🚀 Starting migration process...\n');
    const rolesData = await fetchRoles();
    const usersData = await fetchUsers();

    // ==========================================
    // 1. ROLES CSV - Use Drupal UUID as Directus Role ID
    // ==========================================
    console.log('\n📋 Generating Roles CSV...');
    const rolesCsvHeaders = [
        'id',
        'name',
        'icon',
        'description',
        'drupal_role_id',
        'is_admin',
        'app_access'
    ];
    const rolesCsv = [rolesCsvHeaders.join(',')];
    const processedRoles = new Set();

    // Create unique Directus roles based on mapping
    const uniqueDirectusRoles = {};
    for (const role of rolesData) {
        const drupalRoleId = role.attributes.drupal_internal__id;
        const mapping = ROLE_MAPPING[drupalRoleId];

        if (mapping && !uniqueDirectusRoles[mapping.directus_role]) {
            uniqueDirectusRoles[mapping.directus_role] = {
                id: role.id, // Use Drupal UUID
                name: mapping.directus_role,
                drupal_id: drupalRoleId,
                is_admin: role.attributes.is_admin || false
            };
        }
    }

    // Write Directus roles
    for (const [roleName, roleInfo] of Object.entries(uniqueDirectusRoles)) {
        rolesCsv.push([
            roleInfo.id,
            escapeCsv(roleInfo.name),
            roleName === 'Administrator' ? 'admin_panel_settings' : 'group',
            escapeCsv(roleInfo.drupal_id),
            roleInfo.is_admin ? 'true' : 'false',
            'true'
        ].join(','));
        processedRoles.add(roleInfo.id);
    }

    console.log(`✅ Generated ${Object.keys(uniqueDirectusRoles).length} unique Directus roles`);

    // ==========================================
    // 2. USERS CSV
    // ==========================================
    console.log('\n👥 Generating Users CSV...');
    const usersCsvHeaders = [
        'id',
        'first_name',
        'last_name',
        'email',
        'password',
        'role',
        'status',
        'username',
        'timezone',
        'company',
        'country',
        'bio',
        'phone',
        'facebook_url',
        'linkedin_url',
        'twitter_handle',
        'job_title',
        'verification_status',
        'verification_timestamp',
        'terms_accepted',
        'avatar',
        'subscription_type',
        'drupal_role',
        'access_level',
        'subscription_start',
        'subscription_expiry',
        'drupal_id',
        'drupal_uuid',
        'date_created',
        'date_updated',
        'trial_used',
    ];
    const usersCsv = [usersCsvHeaders.join(',')];

    // User-Roles junction table (for multiple roles tracking)
    const userRolesCsvHeaders = ['id', 'directus_users_id', 'directus_roles_id'];
    const userRolesCsv = [userRolesCsvHeaders.join(',')];

    // Corporate Accounts
    const corporateAccountsCsvHeaders = [
        'id',
        'account_owner_id',
        'company_name',
        'subscription_type',
        'subscription_start',
        'subscription_expiry',
        'max_users',
        'status'
    ];
    const corporateAccountsCsv = [corporateAccountsCsvHeaders.join(',')];

    // Corporate Account Members junction
    const corpAccountMembersCsvHeaders = ['id', 'corporate_accounts_id', 'directus_users_id'];
    const corpAccountMembersCsv = [corpAccountMembersCsvHeaders.join(',')];

    const corporateAccountsMap = new Map();
    let userCount = 0;
    let skippedCount = 0;

    for (const user of usersData.data) {
        try {
            const attributes = user.attributes || {};
            const relationships = user.relationships || {};

            // Skip Anonymous user
            if (attributes.drupal_internal__uid === 0) {
                console.log(`⏭️  Skipping Anonymous user`);
                skippedCount++;
                continue;
            }

            // Use Drupal UUID as Directus user ID
            const directusUserId = user.id;

            // Get user roles
            const userRoles = getUserRolesFromIncluded(
                relationships.roles?.data,
                usersData.included
            );

            // Determine primary role and subscription
            const roleMapping = determinePrimaryRole(userRoles);
            const primaryRoleId = getDirectusRoleId(roleMapping.directus_role, rolesData);

            if (!primaryRoleId) {
                console.log(`⚠️  No role found for user ${attributes.mail}, using Authenticated`);
            }

            // Get profile picture
            const profilePictureId = await getProfilePictureId(
                relationships.user_picture?.data,
                usersData.included
            );

            // Determine access level
            const accessLevel = determineAccessLevel(
                attributes.field_subscription,
                attributes.field_subscription_expiry
            );

            // Add to users CSV
            usersCsv.push([
                directusUserId,
                escapeCsv(attributes.field_user_first_name || ''),
                escapeCsv(attributes.field_user_last_name || ''),
                escapeCsv(attributes.mail || ''),
                '', // Password - cannot be migrated, users will need to reset
                primaryRoleId || '',
                attributes.status ? 'active' : 'suspended',
                escapeCsv(attributes.name || ''),
                escapeCsv(attributes.timezone || 'UTC'),
                escapeCsv(attributes.field_company || ''),
                escapeCsv(attributes.field_country || ''),
                escapeCsv(attributes.field_bio?.processed || ''),
                escapeCsv(attributes.field_phone || ''),
                escapeCsv(attributes.field_facebook || ''),
                escapeCsv(attributes.field_linkedln?.uri || ''),
                escapeCsv(attributes.field_twitter || ''),
                escapeCsv(attributes.field_job_t || ''),
                escapeCsv(attributes.field_verification || 'pending'),
                formatDateTimeForCsv(attributes.field_verification_timestamp || ''),
                attributes.field_terms_conditions ? 'true' : 'false',
                escapeCsv(profilePictureId),
                escapeCsv(roleMapping.subscription_type || ''),
                escapeCsv(roleMapping.all_drupal_roles.join('|') || ''),
                escapeCsv(accessLevel),
                formatDateTimeForCsv(attributes.field_subscription_start || ''),
                formatDateTimeForCsv(attributes.field_subscription_expiry || ''),
                attributes.drupal_internal__uid || '',
                escapeCsv(user.id),
                formatDateTimeForCsv(attributes.created || ''),
                formatDateTimeForCsv(attributes.changed || ''),
                escapeCsv(attributes.field_trial_used || false)
            ].join(','));

            // Add to user_roles junction (for all roles)
            for (const role of userRoles) {
                const drupalRoleId = role.attributes.drupal_internal__id;
                const mapping = ROLE_MAPPING[drupalRoleId];
                if (mapping) {
                    const roleId = getDirectusRoleId(mapping.directus_role, rolesData);
                    if (roleId) {
                        userRolesCsv.push([
                            uuidv4(),
                            directusUserId,
                            roleId
                        ].join(','));
                    }
                }
            }

            // Handle corporate accounts
            if (attributes.field_subscription === 'corporate' && relationships.field_corporate_accounts?.data) {
                const corporateMembers = getCorporateAccountMembers(
                    relationships.field_corporate_accounts.data,
                    usersData.included
                );

                if (corporateMembers.length > 0) {
                    const corpAccountId = uuidv4();

                    corporateAccountsCsv.push([
                        corpAccountId,
                        directusUserId,
                        escapeCsv(attributes.field_company || 'Corporate Account'),
                        'corporate',
                        formatDateTimeForCsv(attributes.field_subscription_start || ''),
                        formatDateTimeForCsv(attributes.field_subscription_expiry || ''),
                        corporateMembers.length + 1, // +1 for owner
                        attributes.field_expired_subscription ? 'expired' : 'active'
                    ].join(','));

                    // Add corporate members
                    for (const member of corporateMembers) {
                        corpAccountMembersCsv.push([
                            uuidv4(),
                            corpAccountId,
                            member.id
                        ].join(','));
                    }

                    corporateAccountsMap.set(directusUserId, {
                        accountId: corpAccountId,
                        members: corporateMembers
                    });
                }
            }

            userCount++;
            if (userCount % 50 === 0) {
                console.log(`  Processed ${userCount} users...`);
            }

        } catch (error) {
            console.error(`❌ Error processing user ${user.id}:`, error.message);
            if (!fs.existsSync('logs')) fs.mkdirSync('logs');
            fs.appendFileSync(
                'logs/migration_errors.log',
                `User ${user.id} (${user.attributes?.mail}) processing failed: ${error.message}\n${error.stack}\n`
            );
        }
    }

    // ==========================================
    // 3. WRITE ALL CSV FILES
    // ==========================================
    console.log('\n💾 Writing CSV files...');

    fs.writeFileSync(path.join(csvDir, 'directus_roles.csv'), rolesCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'directus_users.csv'), usersCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'directus_users_roles.csv'), userRolesCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'corporate_accounts.csv'), corporateAccountsCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'corporate_account_members.csv'), corpAccountMembersCsv.join('\n'), 'utf8');

    // ==========================================
    // 4. GENERATE MIGRATION SUMMARY
    // ==========================================
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Roles migrated: ${Object.keys(uniqueDirectusRoles).length}`);
    console.log(`✅ Users migrated: ${userCount}`);
    console.log(`⏭️  Users skipped: ${skippedCount}`);
    console.log(`✅ User-Role relationships: ${userRolesCsv.length - 1}`);
    console.log(`✅ Corporate accounts: ${corporateAccountsCsv.length - 1}`);
    console.log(`✅ Corporate members: ${corpAccountMembersCsv.length - 1}`);
    console.log('='.repeat(60));
    console.log('\n📁 Generated files:');
    console.log(`   • ${path.join(csvDir, 'directus_roles.csv')}`);
    console.log(`   • ${path.join(csvDir, 'directus_users.csv')}`);
    console.log(`   • ${path.join(csvDir, 'directus_users_roles.csv')}`);
    console.log(`   • ${path.join(csvDir, 'corporate_accounts.csv')}`);
    console.log(`   • ${path.join(csvDir, 'corporate_account_members.csv')}`);
    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('   • Passwords cannot be migrated - users need to reset passwords');
    console.log('   • Drupal UUIDs are preserved as Directus IDs for easy mapping');
    console.log('   • Administrator role is automatically assigned to admin users');
    console.log('   • Multiple roles per user are tracked in directus_users_roles junction');
    console.log('='.repeat(60) + '\n');
}

// Run the migration
generateUsersAndRolesCsv().catch((error) => {
    console.error('\n❌ MIGRATION FAILED:', error.message);
    console.error(error.stack);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync(
        'logs/migration_errors.log',
        `\n\n=== MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`
    );
    process.exit(1);
});