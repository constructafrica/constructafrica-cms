require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/upload-image');
const { escapeCsv, updateRegionKey } = require('../helpers/index');


// Main migration function
async function migrateCountryToDirectus() {
    console.log('\n🚀 Starting country migration process...\n');

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
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    // Initialize mappings and CSV files
    const countryMapping = {};

    const csvHeaders = ['drupal_id', 'drupal_uuid', 'directus_id', 'code', 'name', 'status', 'action'];
    const countriesCsv = [csvHeaders.join(',')];

    let stats = {
        countries: { created: 0, skipped: 0, failed: 0 },
    };

    // Migrate Countries
    console.log('\n🌍 Migrating Countries...');
    const countries = await fetchTaxonomyTerms('country');
    for (const country of countries) {
        const attr = country.attributes || {};
        const drupalId = attr.drupal_internal__tid;
        const code = attr.field_country_code || attr.drupal_internal__tid?.toString() || country.id;
        const name = attr.name || '';

        console.log("countries, ", countries.length)

        const result = await updateRegionKey(directus, 'countries', country.id, attr.field_region_key);

        console.log('result', result)

        if (result.id) {
            countryMapping[country.id] = result.id;
            countryMapping[code] = result.id; // Also map by code
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


    // Write CSV files
    console.log('\n💾 Writing CSV backup files...');
    fs.writeFileSync(path.join(csvDir, 'countries_backup.csv'), countriesCsv.join('\n'), 'utf8');

    // Write mapping files (for use in companies and projects migration)
    fs.writeFileSync(path.join(csvDir, 'countries_mapping.json'), JSON.stringify(countryMapping, null, 2), 'utf8');


    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 COUNTRY MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`🌍 Countries: ${stats.countries.created} created, ${stats.countries.skipped} skipped, ${stats.countries.failed} failed`);

    console.log('\n📁 CSV Backup files generated:');
    console.log(`   • ${path.join(csvDir, 'countries_backup.csv')}`);
}

// Run the migration
migrateCountryToDirectus().catch((error) => {
    console.error('\n❌ MIGRATION FAILED:', error.message);
    console.error(error.stack);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync(
        'logs/migration_errors.log',
        `\n\n=== TAXONOMY MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`
    );
    process.exit(1);
});