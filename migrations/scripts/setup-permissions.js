require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DIRECTUS_URL = process.env.DIRECTUS_URL;
const DIRECTUS_ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

// Create axios instance
const directus = axios.create({
    baseURL: DIRECTUS_URL,
    headers: {
        'Authorization': `Bearer ${DIRECTUS_ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
    }
});

/**
 * Get role ID by name
 */
async function getRoleId(roleName) {
    try {
        const response = await directus.get('/roles', {
            params: {
                filter: { name: { _eq: roleName } }
            }
        });
        const role = response.data.data[0];
        if (!role) {
            console.error(`Role ${roleName} not found`);
            return null;
        }
        return role.id;
    } catch (error) {
        console.error(`Error getting role ${roleName}:`, error.message);
        return null;
    }
}

/**
 * Delete all permissions for a role
 */
async function clearRolePermissions(roleId) {
    try {
        const response = await directus.get('/permissions', {
            params: {
                filter: { role: { _eq: roleId } },
                limit: -1
            }
        });

        const permissions = response.data.data;
        for (const perm of permissions) {
            await directus.delete(`/permissions/${perm.id}`);
        }
        console.log(`  Cleared ${permissions.length} existing permissions for role ID ${roleId}`);
        return true;
    } catch (error) {
        console.error(`Error clearing permissions for role ID ${roleId}:`, error.message);
        return false;
    }
}

/**
 * Create permission
 */
async function createPermission(permission) {
    try {
        await directus.post('/permissions', permission);
        console.log(`  Created permission: ${permission.collection} - ${permission.action}`);
        return true;
    } catch (error) {
        const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
        console.error(`Error creating permission for ${permission.collection} - ${permission.action}: ${errorMessage}`);
        logError(`Permission creation failed: ${JSON.stringify(permission)} - ${errorMessage}`);
        return false;
    }
}

/**
 * Log errors to file
 */
function logError(message) {
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(path.join(logDir, 'permissions_errors.log'), `${new Date().toISOString()} - ${message}\n`);
}

/**
 * Permission definitions for each role
 */
const PERMISSIONS = {
    'Super Editor': {
        directus_users: [
            { action: 'read', fields: '*', permissions: {} },
            {
                action: 'update',
                fields: ['first_name', 'last_name', 'email', 'status', 'company', 'country', 'bio', 'phone', 'job_title', 'subscription_type', 'access_level', 'subscription_start', 'subscription_expiry'].join(','),
                permissions: { status: { _in: ['active', 'suspended'] } }
            }
        ],
        blogs: [ // Changed from 'news' to 'blogs' to match migration context
            { action: 'create', fields: '*', permissions: {}, presets: { writer_id: '$CURRENT_USER', moderation_state: 'draft' } },
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} },
            { action: 'delete', fields: '*', permissions: {} }
        ],
        projects: [
            { action: 'create', fields: '*', permissions: {}, presets: { author: '$CURRENT_USER', status: 'draft' } },
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} },
            { action: 'delete', fields: '*', permissions: {} }
        ],
        directus_files: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} },
            { action: 'delete', fields: '*', permissions: {} }
        ],
        news_categories: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} },
            { action: 'delete', fields: '*', permissions: {} }
        ],
        project_types: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} },
            { action: 'delete', fields: '*', permissions: {} }
        ],
        sectors: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} },
            { action: 'delete', fields: '*', permissions: {} }
        ],
        tags: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} },
            { action: 'delete', fields: '*', permissions: {} }
        ],
        countries: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        user_subscriptions: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} }
        ],
        subscription_plans: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        corporate_accounts: [
            { action: 'read', fields: '*', permissions: {} },
            { action: 'update', fields: '*', permissions: {} }
        ],
        corporate_account_members: [
            { action: 'read', fields: '*', permissions: {} }
        ]
    },
    'Editor': {
        directus_users: [
            {
                action: 'read',
                fields: ['id', 'first_name', 'last_name', 'email', 'avatar', 'company'].join(','),
                permissions: { status: { _eq: 'active' } }
            },
            {
                action: 'update',
                fields: ['first_name', 'last_name', 'bio', 'phone', 'avatar', 'linkedin_url', 'twitter_handle', 'facebook_url'].join(','),
                permissions: { id: { _eq: '$CURRENT_USER' } }
            }
        ],
        blogs: [
            {
                action: 'create',
                fields: '*',
                permissions: {},
                presets: { writer_id: '$CURRENT_USER', moderation_state: 'draft' }
            },
            {
                action: 'read',
                fields: '*',
                permissions: {
                    _or: [
                        { moderation_state: { _eq: 'published' } },
                        { writer_id: { _eq: '$CURRENT_USER' } }
                    ]
                }
            },
            {
                action: 'update',
                fields: '*',
                permissions: { writer_id: { _eq: '$CURRENT_USER' } }
            },
            {
                action: 'delete',
                fields: '*',
                permissions: {
                    _and: [
                        { writer_id: { _eq: '$CURRENT_USER' } },
                        { moderation_state: { _eq: 'draft' } }
                    ]
                }
            }
        ],
        projects: [
            {
                action: 'create',
                fields: '*',
                permissions: {},
                presets: { author: '$CURRENT_USER', status: 'draft' }
            },
            {
                action: 'read',
                fields: '*',
                permissions: {
                    _or: [
                        { status: { _eq: 'published' } },
                        { author: { _eq: '$CURRENT_USER' } }
                    ]
                }
            },
            {
                action: 'update',
                fields: '*',
                permissions: { author: { _eq: '$CURRENT_USER' } }
            },
            {
                action: 'delete',
                fields: '*',
                permissions: {
                    _and: [
                        { author: { _eq: '$CURRENT_USER' } },
                        { status: { _eq: 'draft' } }
                    ]
                }
            }
        ],
        directus_files: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} },
            {
                action: 'update',
                fields: ['title', 'description', 'tags', 'folder'].join(','),
                permissions: { uploaded_by: { _eq: '$CURRENT_USER' } }
            },
            {
                action: 'delete',
                fields: '*',
                permissions: { uploaded_by: { _eq: '$CURRENT_USER' } }
            }
        ],
        news_categories: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        project_types: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        sectors: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        tags: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} }
        ],
        countries: [
            { action: 'read', fields: '*', permissions: {} }
        ]
    },
    'Content Editor': {
        directus_users: [
            {
                action: 'read',
                fields: ['id', 'first_name', 'last_name', 'email', 'avatar'].join(','),
                permissions: { id: { _eq: '$CURRENT_USER' } }
            },
            {
                action: 'update',
                fields: ['first_name', 'last_name', 'avatar', 'bio'].join(','),
                permissions: { id: { _eq: '$CURRENT_USER' } }
            }
        ],
        blogs: [
            { action: 'read', fields: '*', permissions: { moderation_state: { _eq: 'published' } } }
        ],
        projects: [
            { action: 'read', fields: '*', permissions: { status: { _eq: 'published' } } }
        ],
        directus_files: [
            { action: 'create', fields: '*', permissions: {} },
            { action: 'read', fields: '*', permissions: {} },
            {
                action: 'update',
                fields: ['title', 'description'].join(','),
                permissions: { uploaded_by: { _eq: '$CURRENT_USER' } }
            },
            {
                action: 'delete',
                fields: '*',
                permissions: { uploaded_by: { _eq: '$CURRENT_USER' } }
            }
        ]
    },
    'Coordinator': {
        directus_users: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        blogs: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        projects: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        directus_files: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        user_subscriptions: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        corporate_accounts: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        corporate_account_members: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        subscription_plans: [
            { action: 'read', fields: '*', permissions: {} }
        ]
    },
    'Subscriber': {
        directus_users: [
            {
                action: 'read',
                fields: ['id', 'first_name', 'last_name', 'email', 'avatar', 'company'].join(','),
                permissions: {
                    _or: [
                        { id: { _eq: '$CURRENT_USER' } },
                        { status: { _eq: 'active' } }
                    ]
                }
            },
            {
                action: 'update',
                fields: ['first_name', 'last_name', 'bio', 'phone', 'avatar', 'linkedin_url', 'twitter_handle', 'facebook_url'].join(','),
                permissions: { id: { _eq: '$CURRENT_USER' } }
            }
        ],
        blogs: [
            {
                action: 'read',
                fields: '*',
                permissions: {
                    _and: [
                        { moderation_state: { _eq: 'published' } },
                        {
                            _or: [
                                { access_level: { _eq: 'free' } },
                                { access_level: { _eq: 'subscriber_only' } }
                            ]
                        }
                    ]
                }
            }
        ],
        projects: [
            {
                action: 'read',
                fields: '*',
                permissions: {
                    _and: [
                        { status: { _eq: 'published' } },
                        {
                            _or: [
                                { access_level: { _eq: 'free' } },
                                { access_level: { _in: ['subscriber_only', 'premium'] } }
                            ]
                        }
                    ]
                }
            }
        ],
        directus_files: [
            { action: 'read', fields: '*', permissions: {} }
        ],
        user_subscriptions: [
            {
                action: 'read',
                fields: '*',
                permissions: { user_id: { _eq: '$CURRENT_USER' } }
            }
        ],
        subscription_plans: [
            {
                action: 'read',
                fields: '*',
                permissions: { is_active: { _eq: true } }
            }
        ],
        corporate_accounts: [
            {
                action: 'read',
                fields: '*',
                permissions: {
                    _or: [
                        { account_owner_id: { _eq: '$CURRENT_USER' } },
                        { 'members.directus_users_id': { _eq: '$CURRENT_USER' } }
                    ]
                }
            }
        ]
    },
    'Authenticated': {
        directus_users: [
            {
                action: 'read',
                fields: ['id', 'first_name', 'last_name', 'email', 'avatar'].join(','),
                permissions: { id: { _eq: '$CURRENT_USER' } }
            },
            {
                action: 'update',
                fields: ['first_name', 'last_name', 'avatar'].join(','),
                permissions: { id: { _eq: '$CURRENT_USER' } }
            }
        ],
        blogs: [
            {
                action: 'read',
                fields: ['id', 'title', 'slug', 'summary', 'featured_image', 'date_created', 'category', 'writer_id'].join(','),
                permissions: {
                    _and: [
                        { moderation_state: { _eq: 'published' } },
                        { access_level: { _eq: 'free' } }
                    ]
                }
            }
        ],
        projects: [
            {
                action: 'read',
                fields: ['id', 'title', 'slug', 'description', 'featured_image', 'location', 'country', 'project_status', 'published_date'].join(','),
                permissions: {
                    _and: [
                        { status: { _eq: 'published' } },
                        { access_level: { _eq: 'free' } }
                    ]
                }
            }
        ],
        subscription_plans: [
            {
                action: 'read',
                fields: ['id', 'name', 'slug', 'description', 'price', 'billing_cycle', 'features'].join(','),
                permissions: { is_active: { _eq: true } }
            }
        ]
    },
    'Public': {
        blogs: [
            {
                action: 'read',
                fields: ['id', 'title', 'slug', 'summary', 'featured_image', 'date_created'].join(','),
                permissions: {
                    _and: [
                        { moderation_state: { _eq: 'published' } },
                        { access_level: { _eq: 'free' } }
                    ]
                }
            }
        ],
        projects: [
            {
                action: 'read',
                fields: ['id', 'title', 'slug', 'description', 'featured_image', 'location', 'country'].join(','),
                permissions: {
                    _and: [
                        { status: { _eq: 'published' } },
                        { access_level: { _eq: 'free' } }
                    ]
                }
            }
        ],
        directus_files: [
            {
                action: 'read',
                fields: ['id', 'filename_download', 'type', 'filesize'].join(','),
                permissions: {}
            }
        ]
    }
};

/**
 * Main function to set up permissions
 */
async function setupPermissions() {
    console.log('🚀 Starting permissions setup...');
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const [roleName, collections] of Object.entries(PERMISSIONS)) {
        console.log(`\n🔧 Setting up permissions for role: ${roleName}`);

        // Get role ID
        const roleId = await getRoleId(roleName);
        if (!roleId) {
            console.error(`Skipping ${roleName}: Role not found`);
            logError(`Role ${roleName} not found`);
            continue;
        }

        // Clear existing permissions
        const cleared = await clearRolePermissions(roleId);
        if (!cleared) {
            console.error(`Failed to clear permissions for ${roleName}`);
            continue;
        }

        // Create new permissions
        let roleSuccess = 0;
        let roleFailed = 0;
        for (const [collection, permissions] of Object.entries(collections)) {
            for (const perm of permissions) {
                const permission = {
                    role: roleId,
                    collection,
                    action: perm.action,
                    permissions: perm.permissions || {},
                    fields: perm.fields ? perm.fields.split(',').map(f => f.trim()) : ['*'],
                    presets: perm.presets || null
                };

                const success = await createPermission(permission);
                if (success) {
                    roleSuccess++;
                    totalSuccess++;
                } else {
                    roleFailed++;
                    totalFailed++;
                }
            }
        }

        console.log(`✅ ${roleName}: ${roleSuccess} permissions created, ${roleFailed} failed`);
    }

    console.log(`\n🎉 Permissions setup complete: ${totalSuccess} permissions created, ${totalFailed} failed`);
    if (totalFailed > 0) {
        console.log(`📜 Check logs/permissions_errors.log for details`);
    }
}

// Run the script
setupPermissions().catch((error) => {
    console.error('❌ Permissions setup failed:', error.message);
    logError(`Permissions setup failed: ${error.message}\n${error.stack}`);
    process.exit(1);
});