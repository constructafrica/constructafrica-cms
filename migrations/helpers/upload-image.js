require('dotenv').config();
const fs = require('fs');
const { createDirectus, rest, authentication, uploadFiles, readFile, readFiles } = require('@directus/sdk');
const axios = require("axios");
const https = require("https");

// Environment variables
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055';
const DIRECTUS_EMAIL = process.env.DIRECTUS_EMAIL;
const DIRECTUS_PASSWORD = process.env.DIRECTUS_PASSWORD;

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
            await directusInstance.login({
                email: DIRECTUS_EMAIL,
                password: DIRECTUS_PASSWORD
            });
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

async function createApiInstance() {
    return axios.create({
        baseURL: process.env.DRUPAL_API_URL,
        headers: {
            Accept: 'application/vnd.api+json',
        },
        timeout: 10000,
        httpsAgent: new https.Agent({ family: 4 }), // Force IPv
    });
}

async function getFile(fileId) {
    const maxRetries = 2; // number of retries after the first attempt
    let attempt = 0;
    let lastError;
    const api = await createApiInstance();

    while (attempt <= maxRetries) {
        try {
            const url = `/file/file/${fileId}`;
            const response = await api.get(url);

            if (!response.data) {
                throw new Error(`Failed to fetch file metadata: ${response.status}`);
            }

            const fileData = response.data;
            const attr = fileData.data.attributes;
            const fileUrl = attr.uri.url;

            const absoluteUrl = fileUrl.startsWith('/')
                ? `${process.env.DRUPAL_BASE_URL}${fileUrl}`
                : fileUrl;

            return {
                data: fileData.data,
                url: absoluteUrl,
                fileName: attr.filename,
                userId: fileData.data.relationships?.uid?.data?.id || null,
                createdAt: attr.created,
                updatedAt: attr.changed,
            };
        } catch (error) {
            lastError = error;
            attempt++;

            if (attempt > maxRetries) {
                console.error(`❌ Failed to get file URL for ${fileId} after ${attempt} attempts.`);
                console.error('Last error:', error.message);
                return null;
            }

            const delay = 500 * attempt; // backoff (0.5s, then 1s)
            console.warn(`⚠️ Attempt ${attempt} failed for file ${fileId}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // If we get here, all retries failed
    return null;
}

/**
 * Upload image to Directus
 * @param {string} fileUuid - Drupal file uuid
 * @param {string} folder - Desired folder name
 *
 * @returns {Promise<string|null>} Directus file ID or null on failure
 */
async function uploadImage(fileUuid, folder = '') {
    loadImageMap();
    const directus = await getDirectus();
    const api = await createApiInstance();

    // Check if file already exists in Directus by drupal_uuid
    // try {
    //     const existingFiles = await directus.request(readFiles({
    //         filter: {
    //             drupal_uuid: {
    //                 _eq: fileUuid
    //             }
    //         },
    //         limit: 1
    //     }));
    //
    //     if (existingFiles.data && existingFiles.data.length > 0) {
    //         const existingFile = existingFiles.data[0];
    //         console.log(`✅ Reusing existing image by drupal_uuid: ${fileUuid} → ${existingFile.id}`);
    //         return existingFile.id;
    //     }
    // } catch (error) {
    //     console.log(`📝 No existing file found with drupal_uuid: ${fileUuid}, will upload new file`);
    // }

    if (imageMap[fileUuid]) {
        console.log(`✅ Reusing existing image: ${fileUuid} → ${imageMap[fileUuid]}`);
        return imageMap[fileUuid];
    }

    const file = await getFile(fileUuid);

    if (!file) {
        console.error(`❌ No file data for UUID ${fileUuid}`);
        return null;
    }

    const filename = file.fileName || `file-${fileUuid}`;
    const maxRetries = 2;
    let attempt = 1;

    while (attempt <= maxRetries) {
        try {
            if (!file) {
                throw new Error('Could not get file URL');
            }

            const fileUrl = file?.url;

            console.log(`📥 Downloading image from: ${fileUrl}`);

            // Fetch image from Drupal
            const response = await api.get(fileUrl, { responseType: 'arraybuffer' });
            if (!response.data) throw new Error(`Failed to fetch ${fileUrl} (${response.status})`);

            // Get the blob
            // const blob = await response.data.blob();
            const buffer = Buffer.from(response.data);
            const blob = new Blob([buffer], {
                type: response.headers['content-type'] || 'image/jpeg'
            });

            const formData = new FormData();
            formData.append('file', blob, file.fileName);
            // formData.append('title', file.fileName);
            formData.append('drupal_uuid', fileUuid); // not working
            formData.append('id', fileUuid);
            formData.append('drupal_id', 1);  // not working
            formData.append('folder', folder); // not working
            formData.append('uploaded_by', file.userId || '');
            formData.append('created_on', file.createdAt);
            formData.append('modified_on', file.updatedAt);

            // Upload using the uploadFiles composable
            const uploadedFile = await directus.request(
                uploadFiles(formData)
            );

            imageMap[fileUuid] = uploadedFile.id;
            saveImageMap();

            console.log(`📸 Uploaded image: ${filename} → ${uploadedFile.id} (drupal_uuid: ${fileUuid})`);
            return uploadedFile.id;
        } catch (error) {
            console.error(`❌ Attempt ${attempt} failed for ${filename}:`, error.message);
            if (error.response) {
                console.error('Response details:', await error.response.text());
            }
            if (attempt === maxRetries) {
                console.error('❌ All attempts failed');
                if (!fs.existsSync('logs')) fs.mkdirSync('logs');
                fs.appendFileSync(
                    'logs/image_errors.log',
                    `❌ Failed to upload for ${filename}: ${error.message}\n`
                );
                return null;
            }
            attempt++;
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return null;
}

module.exports = { uploadImage, getDirectus };