require('dotenv').config();
const fs = require('fs');
const { createDirectus, rest, authentication, uploadFiles } = require('@directus/sdk');

// Environment variables
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055';
const DIRECTUS_EMAIL = process.env.DIRECTUS_EMAIL || "dev.constructafrica@gmail.com";
const DIRECTUS_PASSWORD = process.env.DIRECTUS_PASSWORD || "Abayomi@123";
const DRUPAL_BASE_URL = process.env.DRUPAL_BASE_URL;

let directusInstance = null;
let imageMap = {};

/**
 * Initialize Directus client with REST and authentication
 * @returns {Promise<Client>} Directus client instance
 */
async function getDirectus() {
    if (!directusInstance) {
        directusInstance = createDirectus(DIRECTUS_URL)
            .with(authentication())
            .with(rest());

        try {
            await directusInstance.login(DIRECTUS_EMAIL, DIRECTUS_PASSWORD);
            console.log('🔐 Logged into Directus successfully');
        } catch (error) {
            console.error('❌ Login failed:', error);
            throw error;
        }
    }
    return directusInstance;
}

/**
 * Load existing image map from file
 */
function loadImageMap() {
    try {
        if (fs.existsSync('image_map.json')) {
            imageMap = JSON.parse(fs.readFileSync('image_map.json', 'utf8'));
        }
    } catch {
        console.warn('⚠️ Failed to load existing image_map.json, starting fresh.');
    }
}

/**
 * Save image map to file
 */
function saveImageMap() {
    fs.writeFileSync('image_map.json', JSON.stringify(imageMap, null, 2));
}

async function getFileUrl(fileId) {
    try {
        const url = `${DRUPAL_BASE_URL}/jsonapi/file/file/${fileId}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch file metadata: ${response.status}`);
        }

        const fileData = await response.json();

        // The actual file URL is in attributes.uri.url
        const fileUrl = fileData.data.attributes.uri.url;

        // If it's a relative URL, make it absolute
        if (fileUrl.startsWith('/')) {
            return `${DRUPAL_BASE_URL}${fileUrl}`;
        }

        return fileUrl;
    } catch (error) {
        console.error(`❌ Failed to get file URL for ${fileId}:`, error.message);
        return null;
    }
}

/**
 * Upload image to Directus (stored in Cloudflare R2)
 * @param {string} drupalTargetId - Drupal file ID
 * @param {string} fileUuid - Drupal file uuid
 * @param {string} filename - Desired filename
 * @param {string} type - Image type (e.g., 'sponsor_delegate_logo', 'partner_logo')
 * @returns {Promise<string|null>} Directus file ID or null on failure
 */
async function uploadImage(drupalTargetId, fileUuid, filename, type = 'image') {
    loadImageMap();

    // Check if image is already uploaded
    if (imageMap[drupalTargetId]) {
        console.log(`✅ Reusing existing ${type} image: ${drupalTargetId} → ${imageMap[drupalTargetId]}`);
        return imageMap[drupalTargetId];
    }

    const directus = await getDirectus();
    // const imageUrl = `${DRUPAL_BASE_URL}/sites/default/files/${drupalTargetId}.jpg`;

    try {
        const fileUrl = await getFileUrl(fileUuid);

        if (!fileUrl) {
            throw new Error('Could not get file URL');
        }

        console.log(`📥 Downloading image from: ${fileUrl}`);

        // Fetch image from Drupal
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`Failed to fetch ${fileUrl} (${response.status})`);

        // Get the blob
        const blob = await response.blob();

        // Create FormData (Directus expects multipart/form-data)
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('title', filename);

        // Upload using the uploadFiles composable
        const uploadedFile = await directus.request(
            uploadFiles(formData)
        );

        imageMap[drupalTargetId] = uploadedFile.id;
        saveImageMap();

        console.log(`📸 Uploaded ${type} image: ${filename} → ${uploadedFile.id}`);
        return uploadedFile.id;
    } catch (error) {
        console.error(`❌ Failed to upload ${type} for ${filename}:`, error.message);

        // Ensure logs directory exists
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs');
        }

        fs.appendFileSync(
            'logs/image_errors.log',
            `❌ Failed to upload ${type} for ${filename}: ${error.message}\n`
        );
        return null;
    }
}

async function uploadImageBlob(blob, filename, type) {
    const directus = await getDirectus();

    try {
        // Create FormData
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('title', filename);

        // Get auth token
        const token = await directus.getToken();

        // Upload using raw fetch
        const uploadResponse = await fetch(`${process.env.DIRECTUS_URL}/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
        }

        const result = await uploadResponse.json();
        return result.data.id;
    } catch (error) {
        console.error(`❌ Failed to upload blob for ${filename}:`, error.message);
        return null;
    }
}

module.exports = { uploadImage, getDirectus, uploadImageBlob };