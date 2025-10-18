const fs = require('fs');
const path = require('path');
const {readItems, updateItem} = require("@directus/sdk");
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
async function fetchMediaEntity(mediaId, mediaType = 'image') {
    const api = await getAuthenticatedApi();
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
    csvDir
};