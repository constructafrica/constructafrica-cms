require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/upload-image');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { uploadImage } = require('../helpers/upload-image');
const { escapeCsv, formatDateTimeForCsv, csvDir } = require('../helpers/index');
const { readUsers, createUser, updateUser, readItems, createItems, updateItems, readRoles } = require('@directus/sdk');

// Role mapping from Drupal to Directus
const ROLE_MAPPING = {
    'administrator': { directus_role: 'Administrator', priority: 100, subscription_type: null, description: 'Administrator role for full access' },
    'super_editor': { directus_role: 'Super Editor', priority: 90, subscription_type: null, description: 'Super Editor role for full access' },
    'publisher': { directus_role: 'Publisher', priority: 85, subscription_type: null, description: 'Publisher role for content publishing' },
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
    'opinion': { directus_role: 'Authenticated', priority: 20, subscription_type: 'opinion', description: '' },
    'free': { directus_role: 'Authenticated', priority: 10, subscription_type: null, description: '' },
    'authenticated': { directus_role: 'Authenticated', priority: 5, subscription_type: null, description: 'Authenticated user for basic access' },
    'anonymous': { directus_role: 'Public', priority: 0, subscription_type: null, description: 'Public role for anonymous access' },
};

// Fetch all users from Drupal
async function fetchUsers() {
    const api = await getAuthenticatedApi();
    let allData = [];
    let includedData = [];
    let nextUrl = '/user/user?include=roles,field_corporate_accounts,user_picture';
    let page = 1;

    const params = {
        'page[limit]': 50,
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
        console.error('❌ Roles fetch failed:', error.message);
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
    let primaryMapping = ROLE_MAPPING['authenticated'];
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

// Map Directus role name to UUID
async function getDirectusRoleIdold(directusRoleName, rolesData, directus) {
    // For Administrator, get the existing Directus admin role UUID
    if (directusRoleName === 'Administrator') {
        try {
            const adminRoles = await directus.request(
                readRoles({
                    filter: { name: { _eq: 'Administrator' } },
                    limit: 1
                })
            );
            console.log('admin role', adminRoles[0].id)

            if (adminRoles && adminRoles.length > 0) {
                return adminRoles[0].id;
            }else{
                // Fallback to Drupal admin role
                const adminRole = rolesData.find(r => r.attributes.is_admin == true);
                console.log('directus admin role main', adminRole)
                return adminRole ? adminRole.id : null;
            }
        } catch (error) {
            console.error('❌ Error fetching admin role from Directus:', error.message);
        }


    }

    const drupalRoleId = Object.keys(ROLE_MAPPING).find(
        key => ROLE_MAPPING[key].directus_role === directusRoleName
    );

    if (drupalRoleId) {
        const role = rolesData.find(r => r.attributes.drupal_internal__id === drupalRoleId);
        return role ? role.id : null;
    }

    return null;
}

// Map Directus role name to UUID - FIXED VERSION
async function getDirectusRoleId(directusRoleName, rolesData, directus) {
    console.log(`🔍 Looking up Directus role: ${directusRoleName}`);

    // For Administrator, get the existing Directus admin role UUID
    if (directusRoleName === 'Administrator') {
        try {
            const adminRoles = await directus.request(
                readRoles({
                    filter: { name: { _eq: 'Administrator' } },
                    limit: 1
                })
            );

            if (adminRoles && adminRoles.length > 0) {
                console.log(`✅ Found Administrator role: ${adminRoles[0].id}`);
                return adminRoles[0].id;
            } else {
                // Fallback to Drupal admin role
                const adminRole = rolesData.find(r => r.attributes.is_admin == true);
                console.log(`⚠️ Using Drupal admin role: ${adminRole?.id}`);
                return adminRole ? adminRole.id : null;
            }
        } catch (error) {
            console.error('❌ Error fetching admin role from Directus:', error.message);
            return null;
        }
    }

    // FIRST: Try to find the role in Directus by name
    try {
        const directusRoles = await directus.request(
            readRoles({
                filter: { name: { _eq: directusRoleName } },
                limit: 1
            })
        );

        if (directusRoles && directusRoles.length > 0) {
            console.log(`✅ Found Directus role ${directusRoleName}: ${directusRoles[0].id}`);
            return directusRoles[0].id;
        }
    } catch (error) {
        console.error(`❌ Error fetching Directus role ${directusRoleName}:`, error.message);
    }

    // SECOND: If not found in Directus, find the representative Drupal role for this Directus role
    console.log(`🔍 Looking for representative Drupal role for Directus role: ${directusRoleName}`);

    // Find all Drupal roles that map to this Directus role
    const mappedDrupalRoleIds = Object.keys(ROLE_MAPPING).filter(
        drupalRoleId => ROLE_MAPPING[drupalRoleId].directus_role === directusRoleName
    );

    console.log(`📋 Drupal roles mapped to ${directusRoleName}:`, mappedDrupalRoleIds);

    if (mappedDrupalRoleIds.length > 0) {
        // Find the highest priority role to use as representative
        let highestPriority = -1;
        let representativeRole = null;

        for (const drupalRoleId of mappedDrupalRoleIds) {
            const mapping = ROLE_MAPPING[drupalRoleId];
            const drupalRole = rolesData.find(r => r.attributes.drupal_internal__id === drupalRoleId);

            if (drupalRole && mapping.priority > highestPriority) {
                highestPriority = mapping.priority;
                representativeRole = drupalRole;
            }
        }

        if (representativeRole) {
            console.log(`✅ Using representative Drupal role ${representativeRole.attributes.drupal_internal__id} for Directus role ${directusRoleName}: ${representativeRole.id}`);
            return representativeRole.id;
        }
    }

    // THIRD: Fallback - try to find any role with the same name in Drupal data
    const fallbackRole = rolesData.find(r =>
        r.attributes.label?.toLowerCase() === directusRoleName.toLowerCase() ||
        r.attributes.drupal_internal__id?.toLowerCase() === directusRoleName.toLowerCase()
    );

    if (fallbackRole) {
        console.log(`⚠️ Using fallback role ${fallbackRole.attributes.drupal_internal__id} for ${directusRoleName}: ${fallbackRole.id}`);
        return fallbackRole.id;
    }

    console.log(`❌ Could not find any role mapping for: ${directusRoleName}`);
    return null;
}

// Get profile picture ID
async function getProfilePictureId(fileData, included) {
    if (!fileData || !fileData.id) return null;
    try {
        const directusFileId = await uploadImage(fileData.id, 'users');
        return directusFileId || null;
    } catch (error) {
        console.error(`❌ Failed to upload profile picture for file ${fileData.id}:`, error.message);
        return null;
    }
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

// Create or update a user in Directus
async function createOrUpdateUser(directus, userData) {
    try {
        // Check if user exists by email
        const existingUsers = await directus.request(
            readUsers({
                filter: { email: { _eq: userData.email } },
                limit: 1
            })
        );

        if (existingUsers && existingUsers.length > 0) {
            // Update existing user
            // await directus.request(
            //     updateUser(existingUsers[0].id, userData)
            // );
            console.log(`🔄 Updated user: ${userData.email}`);
            return { success: true, action: 'updated', userId: existingUsers[0].id };
        } else {
            // Create new user
            const newUser = await directus.request(
                createUser(userData)
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

// Create corporate account
async function createCorporateAccount(directus, accountData) {
    try {
        const newAccount = await directus.request(
            createItems('coporate_account', accountData)
        );
        return { success: true, accountId: newAccount.id };
    } catch (error) {
        console.error(`❌ Error creating corporate account: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Create corporate account members
async function createCorporateAccountMembers(directus, membersData) {
    try {
        await directus.request(
            createItems('coporate_account_directus_users', membersData)
        );
        return { success: true };
    } catch (error) {
        console.error(`❌ Error creating corporate account members: ${error.message}`);
        return { success: false, error: error.message };
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

    // Get the Directus Authenticated role ID
    let authenticatedRoleId;
    try {
        const authRoles = await directus.request(
            readRoles({
                filter: { name: { _eq: 'Authenticated' } },
                limit: 1
            })
        );
        if (authRoles && authRoles.length > 0) {
            authenticatedRoleId = authRoles[0].id;
            console.log(`✅ Found Authenticated role: ${authenticatedRoleId}`);
        }
    } catch (error) {
        console.error('❌ Error fetching Authenticated role:', error.message);
    }

    // Fetch data from Drupal
    const rolesData = await fetchRoles();
    const usersData = await fetchUsers();

    const usersCsvHeaders = [
        'id', 'first_name', 'last_name', 'email', 'role', 'status', 'username',
        'timezone', 'company', 'country', 'bio', 'phone', 'facebook_url',
        'linkedin_url', 'twitter_handle', 'job_title', 'verification_status',
        'verification_timestamp', 'terms_accepted', 'avatar', 'subscription_type',
        'drupal_role', 'access_level', 'subscription_start', 'subscription_expiry',
        'drupal_id', 'drupal_uuid', 'trial_used', 'migration_status', 'migration_action'
    ];
    const usersCsv = [usersCsvHeaders.join(',')];

    const corporateAccountsCsvHeaders = [
        'id', 'owner_id', 'company_name', 'subscription_type', 'subscription_start',
        'subscription_end', 'max_users', 'status', 'migration_status'
    ];
    const corporateAccountsCsv = [corporateAccountsCsvHeaders.join(',')];

    const corpAccountMembersCsvHeaders = ['id', 'coporate_account_id', 'directus_users_id', 'migration_status'];
    const corpAccountMembersCsv = [corpAccountMembersCsvHeaders.join(',')];

    console.log('\n👥 Processing users...');
    let userCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    let createdCount = 0;
    let failedCount = 0;
    const corporateAccountsToCreate = [];

    for (const user of usersData.data) {
        let migrationStatus = 'failed';
        let migrationAction = 'none';

        try {
            const attributes = user.attributes || {};
            const relationships = user.relationships || {};

            // Skip Anonymous user
            if (attributes.drupal_internal__uid === 0) {
                console.log(`⏭️  Skipping Anonymous user`);
                skippedCount++;
                continue;
            }

            // Get user roles
            const userRoles = getUserRolesFromIncluded(
                relationships.roles?.data,
                usersData.included
            );

            // Determine primary role and subscription
            const roleMapping = determinePrimaryRole(userRoles);
            let primaryRoleId = await getDirectusRoleId(roleMapping.directus_role, rolesData, directus);

            // If no role found or user has no roles, assign Authenticated role
            if (!primaryRoleId || userRoles.length === 0) {
                console.log(`⚠️  No role found for user ${attributes.mail}, assigning Authenticated role`);
                primaryRoleId = authenticatedRoleId;

                if (!primaryRoleId) {
                    console.log(`❌ Could not find Authenticated role, skipping user ${attributes.mail}`);
                    skippedCount++;

                    // Add to CSV with failed status
                    usersCsv.push([
                        user.id,
                        escapeCsv(attributes.field_user_first_name || ''),
                        escapeCsv(attributes.field_user_last_name || ''),
                        escapeCsv(attributes.mail || ''),
                        '',
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
                        '',
                        escapeCsv(roleMapping.subscription_type || ''),
                        escapeCsv(roleMapping.all_drupal_roles.join('|') || ''),
                        '',
                        formatDateTimeForCsv(attributes.field_subscription_start || ''),
                        formatDateTimeForCsv(attributes.field_subscription_expiry || ''),
                        attributes.drupal_internal__uid || '',
                        escapeCsv(user.id),
                        escapeCsv(attributes.field_trial_used || false),
                        'failed',
                        'no_role_found'
                    ].join(','));

                    continue;
                }
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

            let email = attributes.mail;
            if(!email) {
                email = user.id + '@generated.com'
            }
            // Prepare user data
            const userData = {
                id: user.id,
                first_name: attributes.field_user_first_name || '',
                last_name: attributes.field_user_last_name || '',
                email: email,
                role: primaryRoleId,
                status: attributes.status ? 'active' : 'suspended',
                username: attributes.name || '',
                timezone: attributes.timezone || 'UTC',
                company: attributes.field_company || '',
                country: attributes.field_country || '',
                bio: attributes.field_bio?.processed || '',
                phone: attributes.field_phone || '',
                facebook_url: attributes.field_facebook?.uri || '',
                linkedin_url: attributes.field_linkedln?.uri || '',
                twitter_handle: attributes.field_twitter?.uri || '',
                job_title: attributes.field_job_t || '',
                verification_status: attributes.field_verification || 'pending',
                verification_timestamp: attributes.field_verification_timestamp || null,
                terms_accepted: attributes.field_terms_conditions || false,
                avatar: profilePictureId,
                subscription_type: roleMapping.subscription_type || null,
                drupal_role: roleMapping.all_drupal_roles.join('|') || '',
                access_level: accessLevel,
                subscription_start: attributes.field_subscription_start || null,
                subscription_expiry: attributes.field_subscription_expiry || null,
                drupal_id: attributes.drupal_internal__uid || null,
                drupal_uuid: user.id,
                trial_used: attributes.field_trial_used || false,
            };

            // Create or update user
            const result = await createOrUpdateUser(directus, userData);

            if (result.success) {
                userCount++;
                migrationStatus = 'success';
                migrationAction = result.action;

                if (result.action === 'created') createdCount++;
                if (result.action === 'updated') updatedCount++;

                // Handle corporate accounts
                if (attributes.field_subscription === 'corporate' && relationships.field_corporate_accounts?.data) {
                    const corporateMembers = getCorporateAccountMembers(
                        relationships.field_corporate_accounts.data,
                        usersData.included
                    );

                    if (corporateMembers.length > 0) {
                        corporateAccountsToCreate.push({
                            ownerId: result.userId,
                            companyName: attributes.field_company || 'Corporate Account',
                            subscriptionType: 'corporate',
                            subscriptionStart: attributes.field_subscription_start || null,
                            subscriptionExpiry: attributes.field_subscription_expiry || null,
                            maxUsers: corporateMembers.length + 1,
                            status: attributes.field_expired_subscription ? 'expired' : 'active',
                            members: corporateMembers
                        });
                    }
                }
            } else {
                failedCount++;
                migrationStatus = 'failed';
                migrationAction = 'error';
            }

            // Add to CSV backup
            usersCsv.push([
                user.id,
                escapeCsv(userData.first_name),
                escapeCsv(userData.last_name),
                escapeCsv(userData.email),
                primaryRoleId || '',
                userData.status,
                escapeCsv(userData.username),
                escapeCsv(userData.timezone),
                escapeCsv(userData.company),
                escapeCsv(userData.country),
                escapeCsv(userData.bio),
                escapeCsv(userData.phone),
                escapeCsv(userData.facebook_url),
                escapeCsv(userData.linkedin_url),
                escapeCsv(userData.twitter_handle),
                escapeCsv(userData.job_title),
                escapeCsv(userData.verification_status),
                formatDateTimeForCsv(userData.verification_timestamp),
                userData.terms_accepted ? 'true' : 'false',
                escapeCsv(userData.avatar || ''),
                escapeCsv(userData.subscription_type || ''),
                escapeCsv(userData.drupal_role),
                escapeCsv(userData.access_level),
                formatDateTimeForCsv(userData.subscription_start),
                formatDateTimeForCsv(userData.subscription_expiry),
                userData.drupal_id || '',
                escapeCsv(userData.drupal_uuid),
                escapeCsv(userData.trial_used || false),
                migrationStatus,
                migrationAction
            ].join(','));

            if (userCount % 50 === 0) {
                console.log(`  Processed ${userCount} users...`);
            }

        } catch (error) {
            console.error(`❌ Error processing user ${user.id}:`, error.message);
            failedCount++;

            // Add to CSV with error status
            const attributes = user.attributes || {};
            usersCsv.push([
                user.id,
                escapeCsv(attributes.field_user_first_name || ''),
                escapeCsv(attributes.field_user_last_name || ''),
                escapeCsv(attributes.mail || ''),
                '',
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
                '',
                '',
                '',
                '',
                formatDateTimeForCsv(attributes.field_subscription_start || ''),
                formatDateTimeForCsv(attributes.field_subscription_expiry || ''),
                attributes.drupal_internal__uid || '',
                escapeCsv(user.id),
                escapeCsv(attributes.field_trial_used || false),
                'failed',
                'exception'
            ].join(','));

            if (!fs.existsSync('logs')) fs.mkdirSync('logs');
            fs.appendFileSync(
                'logs/migration_errors.log',
                `User ${user.id} (${user.attributes?.mail}) processing failed: ${error.message}\n${error.stack}\n`
            );
        }
    }

    // Create corporate accounts
    console.log('\n🏢 Creating corporate accounts...');
    let corpAccountCount = 0;
    for (const corpAccount of corporateAccountsToCreate) {
        const accountId = uuidv4();
        const accountData = {
            id: accountId,
            owner_id: corpAccount.ownerId,
            company_name: corpAccount.companyName,
            subscription_type: corpAccount.subscriptionType,
            subscription_start: corpAccount.subscriptionStart,
            subscription_end: corpAccount.subscriptionExpiry,
            max_users: corpAccount.maxUsers,
            status: corpAccount.status
        };

        const accountResult = await createCorporateAccount(directus, accountData);

        let accountStatus = 'failed';
        if (accountResult.success) {
            corpAccountCount++;
            accountStatus = 'success';

            // Create members
            const membersData = corpAccount.members.map(member => ({
                id: uuidv4(),
                coporate_account_id: accountResult.accountId,
                directus_users_id: member.id
            }));

            const membersResult = await createCorporateAccountMembers(directus, membersData);

            // Add members to CSV
            for (let i = 0; i < membersData.length; i++) {
                corpAccountMembersCsv.push([
                    membersData[i].id,
                    accountResult.accountId,
                    membersData[i].users_id,
                    membersResult.success ? 'success' : 'failed'
                ].join(','));
            }
        }

        // Add to corporate accounts CSV
        corporateAccountsCsv.push([
            accountId,
            escapeCsv(corpAccount.ownerId),
            escapeCsv(corpAccount.companyName),
            escapeCsv(corpAccount.subscriptionType),
            formatDateTimeForCsv(corpAccount.subscriptionStart),
            formatDateTimeForCsv(corpAccount.subscriptionExpiry),
            corpAccount.maxUsers,
            escapeCsv(corpAccount.status),
            accountStatus
        ].join(','));
    }

    // Write CSV files
    console.log('\n💾 Writing CSV backup files...');
    fs.writeFileSync(path.join(csvDir, 'users_migration_backup.csv'), usersCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'corporate_accounts_backup.csv'), corporateAccountsCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'corporate_members_backup.csv'), corpAccountMembersCsv.join('\n'), 'utf8');

    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Users created: ${createdCount}`);
    console.log(`🔄 Users updated: ${updatedCount}`);
    console.log(`⏭️  Users skipped: ${skippedCount}`);
    console.log(`❌ Users failed: ${failedCount}`);
    console.log(`🏢 Corporate accounts created: ${corpAccountCount}`);
    console.log('='.repeat(60));
    console.log('\n📁 CSV Backup files generated:');
    console.log(`   • ${path.join(csvDir, 'users_migration_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'corporate_accounts_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'corporate_members_backup.csv')}`);
    if (failedCount > 0) {
        console.log(`\n📜 Check logs/migration_errors.log for details`);
    }
    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('   • Passwords cannot be migrated - users need to reset passwords');
    console.log('   • Drupal UUIDs are preserved as Directus IDs for easy mapping');
    console.log('   • Administrator role uses existing Directus admin role UUID');
    console.log('   • Users without roles are assigned to Authenticated role');
    console.log('   • CSV files include migration status for verification');
    console.log('='.repeat(60) + '\n');
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