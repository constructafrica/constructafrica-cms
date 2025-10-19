require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/upload-image');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { escapeCsv, toDrupalMachineName, updateRegionKey } = require('../helpers/index');
const { readItems, createItems} = require('@directus/sdk');

// Fetch taxonomy terms from Drupal
async function fetchTaxonomyTerms(vocabularyId) {
    const api = await getAuthenticatedApi();
    let allData = [];
    let nextUrl = `/taxonomy_term/${vocabularyId}`;
    let page = 1;

    try {
        console.log(`📥 Fetching taxonomy: ${vocabularyId}...`);
        while (nextUrl) {
            const response = await api.get(nextUrl, {
                params: { 'page[limit]': 100 }
            });

            const records = response.data.data || [];
            allData = allData.concat(records);

            nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
            page++;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        console.log(`✅ Fetched ${allData.length} terms for ${vocabularyId}`);
        return allData;
    } catch (error) {
        console.error(`❌ Taxonomy fetch failed for ${vocabularyId}:`, error.message);
        return [];
    }
}

// Create or get taxonomy item
async function createOrGetTaxonomy(directus, collection, drupalId, code, name, description = '', additionalData = {}) {
    try {
        // Check if exists by drupal_id
        const existing = await directus.request(
            readItems(collection, {
                filter: { drupal_id: { _eq: drupalId } },
                limit: 1
            })
        );

        if (existing && existing.length > 0) {
            console.log(`  🔄 ${collection} already exists: ${name}`);
            return { id: existing[0].id, action: 'skipped' };
        }

        // Create new
        const itemData = {
            id: uuidv4(),
            drupal_id: drupalId,
            drupal_key: code,
            name: name,
            description: description,
            ...additionalData
        };

        const newItem = await directus.request(
            createItems(collection, itemData)
        );

        console.log(`  ✅ Created ${collection}: ${name}`);
        return { id: newItem.id, action: 'created' };
    } catch (error) {
        console.error(`  ❌ Error creating ${collection}/${code}:`, error.message);
        return { id: null, action: 'failed', error: error.message };
    }
}

// Main migration function
async function migrateTaxonomiesToDirectus() {
    console.log('\n🚀 Starting taxonomy migration process...\n');

    // Initialize Directus client
    let directus;
    try {
        directus = await getDirectus();
    } catch (error) {
        console.error('❌ Failed to initialize Directus client:', error.message);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Directus initialization failed: ${error}\n`);
        process.exit(1);
    }

    // Setup CSV directory
    const csvDir = path.join(__dirname, '../csv');

    // Initialize mappings and CSV files
    const countryMapping = {};
    const regionMapping = {};
    const sectorMapping = {};
    const projectTypeMapping = {};
    const companyTypeMapping = {};

    const csvHeaders = ['drupal_id', 'drupal_uuid', 'directus_id', 'code', 'name', 'status', 'action'];
    const countriesCsv = [csvHeaders.join(',')];
    const regionsCsv = [csvHeaders.join(',')];
    const sectorsCsv = [csvHeaders.join(',')];
    const projectTypesCsv = [csvHeaders.join(',')];
    const companyTypesCsv = [csvHeaders.join(',')];

    let stats = {
        countries: { created: 0, skipped: 0, failed: 0 },
        regions: { created: 0, skipped: 0, failed: 0 },
        sectors: { created: 0, skipped: 0, failed: 0 },
        projectTypes: { created: 0, skipped: 0, failed: 0 },
        companyTypes: { created: 0, skipped: 0, failed: 0 }
    };

    // Migrate Countries
    console.log('\n🌍 Migrating Countries...');
    const countries = await fetchTaxonomyTerms('country');
    for (const country of countries) {
        const attr = country.attributes || {};
        const drupalId = attr.drupal_internal__tid;
        const code = attr.field_country_code || attr.drupal_internal__tid?.toString() || country.id;
        const name = attr.name || '';
        const description = attr.description?.processed || '';

        // const result = await createOrGetTaxonomy(
        //     directus,
        //     'countries',
        //     drupalId,
        //     code,
        //     name,
        //     description,
        //     {
        //         iso_code: attr.field_iso_code || ''
        //     }
        // );

        const result = await updateRegionKey(directus, 'countries', country.id, attr.field_region_key);

        if (result.id) {
            countryMapping[country.id] = result.id;
            countryMapping[code] = result.id;
            countryMapping[attr.field_region_key] = result.id;
        }

        stats.countries[result.action]++;

        countriesCsv.push([
            drupalId || '',
            escapeCsv(country.id),
            result.id || '',
            escapeCsv(code),
            escapeCsv(name),
            result.action === 'failed' ? 'failed' : 'success',
            result.action
        ].join(','));
    }

    // Migrate Regions
    console.log('\n🗺️  Migrating Regions...');
    const regions = await fetchTaxonomyTerms('region');
    for (const region of regions) {
        const attr = region.attributes || {};
        const drupalId = attr.drupal_internal__tid;
        const code = attr.field_region_code || attr.drupal_internal__tid?.toString() || region.id;
        const name = attr.name || '';
        const description = attr.description?.processed || '';

        // const result = await createOrGetTaxonomy(
        //     directus,
        //     'regions',
        //     drupalId,
        //     code,
        //     name,
        //     description
        // );

        const result = await updateRegionKey(directus, 'regions', attr.name, attr.field_region_key, 'name');

        if (result.id) {
            regionMapping[region.id] = result.id;
            regionMapping[code] = result.id; // Also map by code
            regionMapping[attr.field_region_key] = result.id; // Also map by code
        }

        stats.regions[result.action]++;

        regionsCsv.push([
            drupalId || '',
            escapeCsv(region.id),
            result.id || '',
            escapeCsv(code),
            escapeCsv(name),
            result.action === 'failed' ? 'failed' : 'success',
            result.action
        ].join(','));
    }

    // Migrate Sectors
    console.log('\n🏭 Migrating Sectors...');
    const sectors = await fetchTaxonomyTerms('sector');
    for (const sector of sectors) {
        const attr = sector.attributes || {};
        const drupalId = attr.drupal_internal__tid;
        const code = attr.field_sector_code || attr.drupal_internal__tid?.toString() || sector.id;
        const name = attr.name || '';
        const description = attr.description?.processed || '';

        const result = await createOrGetTaxonomy(
            directus,
            'sectors',
            drupalId,
            code,
            name,
            description,
            {drupal_key: attr.field_region_key || toDrupalMachineName(attr.name)}
        );

        if (result.id) {
            sectorMapping[sector.id] = result.id;
            sectorMapping[code] = result.id; // Also map by code
            sectorMapping[attr.field_region_key || toDrupalMachineName(attr.name)] = result.id; // Also map by code
        }

        stats.sectors[result.action]++;

        sectorsCsv.push([
            drupalId || '',
            escapeCsv(sector.id),
            result.id || '',
            escapeCsv(code),
            escapeCsv(name),
            result.action === 'failed' ? 'failed' : 'success',
            result.action
        ].join(','));
    }

    // Write CSV files
    console.log('\n💾 Writing CSV backup files...');
    fs.writeFileSync(path.join(csvDir, 'countries_backup.csv'), countriesCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'regions_backup.csv'), regionsCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'sectors_backup.csv'), sectorsCsv.join('\n'), 'utf8');

    fs.writeFileSync(path.join(csvDir, 'countries_mapping.json'), JSON.stringify(countryMapping, null, 2), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'regions_mapping.json'), JSON.stringify(regionMapping, null, 2), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'sectors_mapping.json'), JSON.stringify(sectorMapping, null, 2), 'utf8');
    // fs.writeFileSync(path.join(csvDir, 'company_types_mapping.json'), JSON.stringify(companyTypeMapping, null, 2), 'utf8');

    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TAXONOMY MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`🌍 Countries: ${stats.countries.created} created, ${stats.countries.skipped} skipped, ${stats.countries.failed} failed`);
    console.log(`🗺️  Regions: ${stats.regions.created} created, ${stats.regions.skipped} skipped, ${stats.regions.failed} failed`);
    console.log(`🏭 Sectors: ${stats.sectors.created} created, ${stats.sectors.skipped} skipped, ${stats.sectors.failed} failed`);
    console.log('='.repeat(60));
    console.log('\n📁 CSV Backup files generated:');
    console.log(`   • ${path.join(csvDir, 'countries_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'regions_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'sectors_backup.csv')}`);
    console.log('\n📁 Mapping files generated (for companies/projects migration):');
    console.log(`   • ${path.join(csvDir, 'countries_mapping.json')}`);
    console.log(`   • ${path.join(csvDir, 'regions_mapping.json')}`);
    console.log(`   • ${path.join(csvDir, 'sectors_mapping.json')}`);
    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('   • Run this script BEFORE migrating companies and projects');
    console.log('   • Mapping files are required for companies and projects migration');
    console.log('   • Taxonomy codes are mapped for easy reference');
    console.log('   • Next step: Run migrate-companies.js');
    console.log('='.repeat(60) + '\n');
}

// Run the migration
migrateTaxonomiesToDirectus().catch((error) => {
    console.error('\n❌ MIGRATION FAILED:', error.message);
    console.error(error.stack);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync(
        'logs/migration_errors.log',
        `\n\n=== TAXONOMY MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`
    );
    process.exit(1);
});