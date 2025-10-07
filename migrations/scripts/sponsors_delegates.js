const fs = require('fs');
const path = require('path');
const { uploadImage } = require('../helpers/upload-image.js');

// Load Drupal data and image map
const DRUPAL_JSON_SPONSORS_DELEGATES = require('../data/sponsors_delegates.json');
const IMAGE_MAP_FILE = path.resolve(__dirname, '../data/image_map.json');
let IMAGE_MAP = require('../data/image_map.json');

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

// CSV header
const sponsorsCsv = [
    'id,name,type,logo,website,description,date_created',
];

(async () => {
    for (const item of DRUPAL_JSON_SPONSORS_DELEGATES.data) {
        const attrs = item.attributes;
        const rels = item.relationships;

        // Determine type from parent_field_name
        const type = getType(attrs.parent_field_name);

        // Get Drupal image ID
        const drupalImageId = rels.field_logo?.data?.meta?.drupal_internal__target_id;
        let logoId = '';

        if (drupalImageId) {
            // Check if image already uploaded
            if (IMAGE_MAP[drupalImageId]) {
                logoId = IMAGE_MAP[drupalImageId];
                console.log(`✅ Found cached logo for ${type} (${drupalImageId})`);
            } else {
                // Upload new image using helper
                console.log(`⬆️ Uploading new logo for ${type} (${drupalImageId})...`);
                logoId = await uploadImage(drupalImageId, `${type}-${item.id}`, 'sponsor logo');

                if (logoId) {
                    IMAGE_MAP[drupalImageId] = logoId;
                    fs.writeFileSync(IMAGE_MAP_FILE, JSON.stringify(IMAGE_MAP, null, 2));
                }
            }
        }

        sponsorsCsv.push(
            [
                item.id, // UUID
                '', // name (not in JSON)
                type,
                logoId,
                '', // website
                '', // description
                attrs.created?.split('+')[0] || '',
            ].join(',')
        );
    }

    // Write CSV
    const outputPath = './csv/sponsors_delegates.csv';
    fs.writeFileSync(outputPath, sponsorsCsv.join('\n'));

    console.log(`\n✅ CSV generated: ${outputPath}`);
})();
