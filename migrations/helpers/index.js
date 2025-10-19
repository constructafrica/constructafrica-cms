const fs = require('fs');
const path = require('path');
const {readItems, updateItem, readUsers} = require("@directus/sdk");
const { getAuthenticatedApi } = require('./auth');


function escapeCsv(value) {
    if (value === null || value === undefined) return '';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
}

// Helper: Format date for CSV (remove timezone)
function formatDateForCsv(dateString) {
    if (!dateString) return '';
    return dateString.split('+')[0].split('T')[0]; // Returns YYYY-MM-DD
}

// Helper: Format datetime for CSV (remove timezone)
function formatDateTimeForCsv(dateTimeString) {
    if (!dateTimeString) return '';
    return dateTimeString.split('+')[0]; // Returns YYYY-MM-DDTHH:mm:ss
}

function toDrupalMachineName(name) {
    return name
        // Convert to lowercase
        .toLowerCase()
        // Remove text in parentheses and brackets
        .replace(/[\(\[].*?[\)\]]/g, '')
        // Replace slashes, spaces, and punctuation with underscores
        .replace(/[\/\s\.\,\-\+]+/g, '')
        // Remove any remaining special characters except underscores
        .replace(/[^a-z0-9_]/g, '')
        // Remove leading/trailing underscores and multiple consecutive underscores
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '');
}

async function updateRegionKey(directus, collection, filterValue, key, filterField = 'drupal_uuid') {
    try {
        console.log(`🔄 Updating ${collection} with ${filterField}: ${filterValue}, key: ${key}`);

        const existing = await directus.request(
            readItems(collection, {
                filter: { [filterField]: { _eq: filterValue } },
                fields: ['id'],
                limit: 1
            })
        );

        if (!existing || existing.length === 0) {
            console.log(`  ⚠️  No ${collection} found with ${filterField}: ${filterValue}`);
            return { id: null, action: 'not_found' };
        }

        const itemId = existing[0].id;
        console.log(`  📍 Found existing ${collection} with ID: ${itemId}`);

        await directus.request(
            updateItem(collection, itemId, {
                drupal_key: key,
            })
        );

        console.log(`  ✅ Successfully updated ${collection} ${itemId} with key: ${key}`);
        return { id: itemId, action: 'updated' };

    } catch (error) {
        console.error(`  ❌ Error updating ${collection} for ${filterField} ${filterValue}:`, error.message);
        return { id: null, action: 'failed', error: error.message };
    }
}

// Fetch media entity to get the actual file reference
async function fetchMediaEntity(mediaId, mediaType = 'image', isCat = true) {
    const api = await getAuthenticatedApi(isCat);
    try {
        const response = await api.get(`/media/${mediaType}/${mediaId}`);
        return response.data.data;
    } catch (error) {
        console.error(`❌ Failed to fetch media ${mediaId}:`, error.message);
        return null;
    }
}

// Fetch paragraph data (teams, news updates, etc.)
async function fetchParagraph(paragraphId, paragraphType, isCat = true) {
    const api = await getAuthenticatedApi(true);
    try {
        const response = await api.get(`/paragraph/${paragraphType}/${paragraphId}`);
        return response.data.data;
    } catch (error) {
        console.error(`❌ Failed to fetch paragraph ${paragraphId}:`, error.message);
        return null;
    }
}

/**
 * Helper to check if an image already exists in Directus
 * for this company using drupal_uuid or file reference.
 */
async function galleryImageExists(directus, imageId, fieldValue, fieldKey = 'company') {
    try {
        const existing = await directus.request(
            readItems('media_gallery', {
                filter: {
                    _or: [
                        { file: { _eq: imageId } },
                    ],
                    [fieldKey]: { _eq: fieldValue },
                },
                limit: 1,
            })
        );
        return existing.length > 0;
    } catch (error) {
        console.error('Error checking existing gallery image:', error);
        return false;
    }
}

function logDir() {
    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
}

function createCsvDir() {
    // Setup CSV files
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }
}

const csvDir = path.join(__dirname, '../csv');
const logsDir = path.join(__dirname, '../logs');

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

// Load taxonomy mapping
function loadTaxonomyMapping() {
    const csvDir = path.join(__dirname, '../csv');
    try {
        const countries = JSON.parse(fs.readFileSync(path.join(csvDir, 'countries_mapping.json'), 'utf8'));
        const regions = JSON.parse(fs.readFileSync(path.join(csvDir, 'regions_mapping.json'), 'utf8'));
        const sectors = JSON.parse(fs.readFileSync(path.join(csvDir, 'sectors_mapping.json'), 'utf8'));
        const projectTypes = JSON.parse(fs.readFileSync(path.join(csvDir, 'types_mapping.json'), 'utf8'));

        return { countries, regions, sectors, projectTypes };
    } catch (error) {
        console.error('⚠️  Could not load taxonomy mapping, taxonomies will not be linked', error);
        return { countries: {}, regions: {}, sectors: {}, projectTypes: {} };
    }
}

async function getUserId(directus, email) {
    const user = await directus.request(
        readUsers({
            filter: { email: { _eq: email } },
            limit: 1
        })
    );

    if (user && user.length > 0) {
        return existingProjects[0].id;
    }

    return null
}

module.exports = {
    escapeCsv,
    formatDateForCsv,
    formatDateTimeForCsv,
    toDrupalMachineName,
    updateRegionKey,
    fetchMediaEntity,
    fetchParagraph,
    galleryImageExists,
    logsDir,
    csvDir,
    ROLE_MAPPING,
    loadTaxonomyMapping,
    getUserId
};