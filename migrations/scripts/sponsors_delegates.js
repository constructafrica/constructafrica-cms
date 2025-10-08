const fs = require('fs');
const path = require('path');
const { uploadImage, uploadImageBlob } = require('../helpers/upload-image.js');

// Load Drupal data and image map
const DRUPAL_JSON_SPONSORS_DELEGATES = require('../data/sponsors_delegates.json');
const IMAGE_MAP_FILE = path.resolve(__dirname, '../data/image_map.json');
let IMAGE_MAP = fs.existsSync(IMAGE_MAP_FILE)
    ? require('../data/image_map.json')
    : {};

const DRUPAL_BASE_URL = process.env.DRUPAL_BASE_URL || 'https://dev-constructafrica.pantheonsite.io';

// Helper: escape CSV values safely
function escapeCsv(value) {
    if (value === null || value === undefined) return '';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
}

// Helper: map Drupal field to Directus type
function getType(fieldName) {
    switch (fieldName) {
        case 'field_supporting_partners':
            return 'partner';
        case 'field_sponsors':
            return 'sponsor';
        case 'field_delegates':
            return 'delegate';
        default:
            return 'unknown';
    }
}

// Helper: Download and upload image
async function downloadAndUploadImage(fileUuid, drupalTargetId, filename, type) {
    // Check if already uploaded
    if (IMAGE_MAP[drupalTargetId]) {
        console.log(`✅ Found cached logo for ${type} (Drupal ID: ${drupalTargetId})`);
        return IMAGE_MAP[drupalTargetId];
    }

    try {
        // Get the actual file URL from Drupal
        const fileUrl = await getFileUrl(fileUuid);

        if (!fileUrl) {
            throw new Error('Could not get file URL');
        }

        console.log(`📥 Downloading image from: ${fileUrl}`);

        // Download the image
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();

        // Determine file extension from content type or URL
        const contentType = response.headers.get('content-type');
        let extension = 'jpg';

        if (contentType) {
            if (contentType.includes('png')) extension = 'png';
            else if (contentType.includes('gif')) extension = 'gif';
            else if (contentType.includes('webp')) extension = 'webp';
            else if (contentType.includes('svg')) extension = 'svg';
        } else {
            // Try to get extension from URL
            const urlParts = fileUrl.split('.');
            if (urlParts.length > 1) {
                extension = urlParts[urlParts.length - 1].split('?')[0].toLowerCase();
            }
        }

        const finalFilename = `${filename}.${extension}`;

        // Now upload to Directus using your helper
        const directusFileId = await uploadImageBlob(blob, finalFilename, type);

        if (directusFileId) {
            IMAGE_MAP[drupalTargetId] = directusFileId;
            fs.writeFileSync(IMAGE_MAP_FILE, JSON.stringify(IMAGE_MAP, null, 2));
            console.log(`✅ Uploaded ${type} logo: ${finalFilename} → ${directusFileId}`);
        }

        return directusFileId;
    } catch (error) {
        console.error(`❌ Failed to process image for ${filename}:`, error.message);

        // Log error
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/image_errors.log',
            `❌ Failed to process ${type} image ${filename}: ${error.message}\n`
        );

        return null;
    }
}

// CSV header
const sponsorsCsv = [
    'id,name,type,logo,website,description,date_created',
];

(async () => {
    console.log(`🚀 Starting sponsors/delegates migration...`);
    console.log(`📊 Total items to process: ${DRUPAL_JSON_SPONSORS_DELEGATES.data.length}\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const [index, item] of DRUPAL_JSON_SPONSORS_DELEGATES.data.entries()) {
        const attrs = item.attributes;
        const rels = item.relationships;

        // Determine type from parent_field_name
        const type = getType(attrs.parent_field_name);

        console.log(`\n[${index + 1}/${DRUPAL_JSON_SPONSORS_DELEGATES.data.length}] Processing ${type}...`);

        // Get Drupal image data
        const fileUuid = rels.field_logo?.data?.id;
        const drupalTargetId = rels.field_logo?.data?.meta?.drupal_internal__target_id;
        let logoId = '';

        if (fileUuid && drupalTargetId) {
            // logoId = await downloadAndUploadImage(
            //     fileUuid,
            //     drupalImageId,
            //     `${type}-${attrs.drupal_internal__id}`,
            //     type
            // );

            logoId = await uploadImage(drupalTargetId, fileUuid,  `${type}-${item.id}`, type);

            if (logoId) {
                successCount++;
            } else {
                errorCount++;
            }
        } else {
            console.log(`⚠️  No logo found for ${type} (ID: ${attrs.drupal_internal__id})`);
        }

        // Build CSV row with proper escaping
        sponsorsCsv.push(
            [
                item.id, // UUID
                escapeCsv(''), // name (not in JSON)
                escapeCsv(type),
                escapeCsv(logoId),
                escapeCsv(''), // website
                escapeCsv(''), // description
                escapeCsv(attrs.created?.split('+')[0] || ''),
            ].join(',')
        );
    }

    // Write CSV
    const outputPath = path.resolve(__dirname, '../csv/sponsors_delegates.csv');

    // Ensure csv directory exists
    const csvDir = path.dirname(outputPath);
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, sponsorsCsv.join('\n'));

    console.log(`\n✅ CSV generated: ${outputPath}`);
    console.log(`📊 Statistics:`);
    console.log(`   - Total items: ${DRUPAL_JSON_SPONSORS_DELEGATES.data.length}`);
    console.log(`   - Images uploaded: ${successCount}`);
    console.log(`   - Errors: ${errorCount}`);

    if (errorCount > 0) {
        console.log(`\n⚠️  Check logs/image_errors.log for details`);
    }
})().catch((error) => {
    console.error("\n❌ CSV generation failed:", error);

    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync("logs/csv_errors.log",
        `CSV generation failed: ${error.message}\n${error.stack}\n`
    );
    process.exit(1);
});