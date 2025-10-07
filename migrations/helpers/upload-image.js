const fs = require('fs');
const { Directus } = require('@directus/sdk'); // Fixed import

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055';
const DIRECTUS_EMAIL = process.env.DIRECTUS_EMAIL;
const DIRECTUS_PASSWORD = process.env.DIRECTUS_PASSWORD;
const DEFAULT_ADMIN_USER = process.env.DEFAULT_ADMIN_USER;

let directusInstance = null;
let imageMap = {};

async function getDirectus() {
    if (!directusInstance) {
        directusInstance = new Directus(DIRECTUS_URL);
        await directusInstance.auth.login({ email: DIRECTUS_EMAIL, password: DIRECTUS_PASSWORD });
    }
    return directusInstance;
}

function loadImageMap() {
    try {
        if (fs.existsSync('image_map.json')) {
            imageMap = JSON.parse(fs.readFileSync('image_map.json', 'utf8'));
        }
    } catch {
        console.warn('⚠️ Failed to load existing image_map.json, starting fresh.');
    }
}

function saveImageMap() {
    fs.writeFileSync('image_map.json', JSON.stringify(imageMap, null, 2));
}

async function uploadImage(drupalId, filename, type = 'image') {
    loadImageMap();

    if (imageMap[drupalId]) {
        console.log(`✅ Reusing existing ${type} image: ${drupalId} → ${imageMap[drupalId]}`);
        return imageMap[drupalId];
    }

    const directus = await getDirectus();
    const imageUrl = `${process.env.DRUPAL_BASE_URL}/sites/default/files/${drupalId}.jpg`;

    try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`Failed to fetch ${imageUrl}`);

        const buffer = Buffer.from(await response.arrayBuffer());
        const uploadedFile = await directus.files.upload(buffer, {
            filename_download: filename,
            title: filename,
        });

        imageMap[drupalId] = uploadedFile.id;
        saveImageMap();

        console.log(`📸 Uploaded ${type} image: ${filename} → ${uploadedFile.id}`);
        return uploadedFile.id;
    } catch (error) {
        console.error(`❌ Failed to upload ${type} for ${filename}: ${error.message}`);
        fs.appendFileSync(
            'image_errors.log',
            `❌ Failed to upload ${type} for ${filename}: ${error.message}\n`
        );
        return null;
    }
}

module.exports = { uploadImage };