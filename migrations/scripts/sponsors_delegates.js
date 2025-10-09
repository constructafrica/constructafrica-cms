require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { uploadImage } = require('../helpers/upload-image');
const { escapeCsv } = require('../helpers/index');

// CSV header
const sponsorsCsv = [
    'id,name,type,logo,website,description,date_created,status',
];

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

// Fetch sponsors/delegates from Drupal with pagination
async function fetchSponsorsDelegates() {
    const api = await getAuthenticatedApi();
    let allData = [];
    let includedData = [];
    let nextUrl = '/paragraph/sponsors_delegates';
    let page = 1;

    const params = {
        'fields[node--sponsor_delegate]': 'drupal_internal__nid,title,created,field_logo,parent_field_name,field_website,body,status',
        'include': 'field_logo',
        'page[limit]': 100,
    };

    try {
        console.log('📥 Fetching all sponsors/delegates...');
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

            console.log(`✅ Page ${page}: ${records.length} records`);

            if (response.data.links?.next?.href) {
                nextUrl = response.data.links.next.href.replace(api.defaults.baseURL, '');
                page++;
            } else {
                nextUrl = null;
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log(`🎉 Fetched ${allData.length} sponsors/delegates across ${page} pages`);

        return {
            data: allData,
            included: includedData
        };
    } catch (error) {
        console.error('❌ Fetch failed on page', page, ':', error.response?.status, error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token might be expired, resetting authentication...');
            resetAuth();
        }
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/csv_errors.log', `Sponsors/delegates fetch failed on page ${page}: ${error.message}\n`);
        throw error;
    }
}

// Generate CSV from fetched Drupal sponsors/delegates
(async () => {
    console.log('🚀 Starting sponsors/delegates migration...');

    let successCount = 0;
    let errorCount = 0;

    try {
        const sponsorsData = await fetchSponsorsDelegates();
        console.log(`📊 Total items to process: ${sponsorsData.data.length}\n`);

        for (const [index, item] of sponsorsData.data.entries()) {
            const attrs = item.attributes;
            const rels = item.relationships;

            // Determine type from parent_field_name
            const type = getType(attrs.parent_field_name);

            console.log(`[${index + 1}/${sponsorsData.data.length}] Processing ${type} (ID: ${item.id})...`);

            // Get Drupal image data
            const fileUuid = rels.field_logo?.data?.id;
            let logoId = '';

            if (fileUuid) {
                try {
                    logoId = await uploadImage(fileUuid, 'sponsor_delegate');
                    if (logoId) {
                        successCount++;
                    } else {
                        errorCount++;
                        console.log(`⚠️ Failed to upload logo for ${type} (ID: ${item.id})`);
                    }
                } catch (error) {
                    errorCount++;
                    console.error(`❌ Error uploading logo for ${type} (ID: ${item.id}):`, error.message);
                    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
                    fs.appendFileSync('logs/image_errors.log', `Failed to upload logo for ${item.id}: ${error.message}\n`);
                }
            } else {
                console.log(`⚠️ No logo found for ${type} (ID: ${item.id})`);
            }

            // Build CSV row with proper escaping
            sponsorsCsv.push(
                [
                    item.id, // Drupal UUID
                    escapeCsv(attrs.title || ''),
                    escapeCsv(type),
                    escapeCsv(logoId),
                    escapeCsv(attrs.field_website?.uri || ''),
                    escapeCsv(attrs.body?.value || ''),
                    escapeCsv(attrs.created?.split('+')[0] || ''),
                    escapeCsv(attrs.status ? 'active' : 'inactive') // Status
                ].join(',')
            );
        }

        // Write CSV
        const outputPath = path.resolve(__dirname, '../csv/sponsors_delegates.csv');
        const csvDir = path.dirname(outputPath);
        if (!fs.existsSync(csvDir)) {
            fs.mkdirSync(csvDir, { recursive: true });
        }

        fs.writeFileSync(outputPath, sponsorsCsv.join('\n'));

        console.log(`\n✅ CSV generated: ${outputPath}`);
        console.log(`📊 Statistics:`);
        console.log(`   - Total items: ${sponsorsData.data.length}`);
        console.log(`   - Images uploaded: ${successCount}`);
        console.log(`   - Errors: ${errorCount}`);

        if (errorCount > 0) {
            console.log(`⚠️ Check logs/image_errors.log for details`);
        }
    } catch (error) {
        console.error('\n❌ CSV generation failed:', error);
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/csv_errors.log', `CSV generation failed: ${error.message}\n${error.stack}\n`);
        process.exit(1);
    }
})();