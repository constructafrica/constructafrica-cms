require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/upload-image');
const { getAuthenticatedApi } = require('../helpers/auth');
const { uploadImage } = require('../helpers/upload-image');
const { escapeCsv, formatDateTimeForCsv } = require('../helpers/index');

// Fetch all teams paragraphs from Drupal
async function fetchTeams() {
    const api = await getAuthenticatedApi();
    let allData = [];
    let includedData = [];
    let nextUrl = '/paragraph/teams?include=field_key_contact_company,field_photo';
    let page = 1;

    const params = {
        'fields[paragraph--teams]': 'drupal_internal__id,status,created,parent_id,parent_field_name,field_email,field_facebook,field_linkedin,field_name,field_phone,field_role,field_twitter',
        'page[limit]': 50,
    };

    try {
        console.log('📥 Fetching all company contacts (teams)...');
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
            console.log(`✅ Page ${page}: ${records.length} contacts`);

            nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
            page++;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        console.log(`🎉 Fetched ${allData.length} contacts across ${page} pages`);
        return { data: allData, included: includedData };
    } catch (error) {
        console.error('❌ Teams fetch failed:', error.response?.data || error.message);
        throw error;
    }
}

// Get company data from included
function getCompanyFromIncluded(companyData, includedData) {
    if (!companyData || !companyData.id) return null;

    return includedData.find(item =>
        item.type === 'node--company' && item.id === companyData.id
    );
}

// Get photo data from included
function getPhotoFromIncluded(photoData, includedData) {
    if (!photoData || !photoData.id) return null;

    return includedData.find(item =>
        item.type === 'file--file' && item.id === photoData.id
    );
}

// Create or update company in Directus
async function createOrUpdateCompany(directus, companyData) {
    try {
        // Check if company exists by drupal_id
        const existingCompanies = await directus.items('companies').readByQuery({
            filter: { drupal_id: { _eq: companyData.drupal_id } },
            limit: 1
        });

        if (existingCompanies.data && existingCompanies.data.length > 0) {
            // Update existing company
            await directus.items('companies').updateOne(existingCompanies.data[0].id, companyData);
            console.log(`🔄 Updated company: ${companyData.name}`);
            return { success: true, companyId: existingCompanies.data[0].id };
        } else {
            // Create new company
            const newCompany = await directus.items('companies').createOne(companyData);
            console.log(`✅ Created company: ${companyData.name}`);
            return { success: true, companyId: newCompany.id };
        }
    } catch (error) {
        console.error(`❌ Error processing company ${companyData.name}:`, error.message);
        return { success: false, error: error.message };
    }
}

// Create or update company contact in Directus
async function createOrUpdateContact(directus, contactData) {
    try {
        // Check if contact exists by drupal_id
        const existingContacts = await directus.items('company_contacts').readByQuery({
            filter: { drupal_id: { _eq: contactData.drupal_id } },
            limit: 1
        });

        if (existingContacts.data && existingContacts.data.length > 0) {
            // Update existing contact
            await directus.items('company_contacts').updateOne(existingContacts.data[0].id, contactData);
            console.log(`🔄 Updated contact: ${contactData.name}`);
            return { success: true, contactId: existingContacts.data[0].id };
        } else {
            // Create new contact
            const newContact = await directus.items('company_contacts').createOne(contactData);
            console.log(`✅ Created contact: ${contactData.name}`);
            return { success: true, contactId: newContact.id };
        }
    } catch (error) {
        console.error(`❌ Error processing contact ${contactData.name}:`, error.message);
        return { success: false, error: error.message };
    }
}

// Main migration function
async function migrateCompanyContacts() {
    console.log('\n🚀 Starting company contacts migration...\n');

    // Initialize Directus client
    let directus;
    try {
        directus = await getDirectus();
    } catch (error) {
        console.error('❌ Failed to initialize Directus client:', error.message);
        process.exit(1);
    }

    // Fetch data from Drupal
    const teamsData = await fetchTeams();

    // Setup CSV files
    const csvDir = path.join(__dirname, '../csv');
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    // CSV headers
    const companiesCsvHeaders = [
        'id', 'name', 'description', 'website', 'logo', 'industry',
        'headquarters', 'founded_year', 'employee_count', 'drupal_id',
        'drupal_uuid', 'status', 'date_created', 'date_updated', 'migration_status'
    ];
    const companiesCsv = [companiesCsvHeaders.join(',')];

    const contactsCsvHeaders = [
        'id', 'company_id', 'name', 'role', 'email', 'phone', 'linkedin_url',
        'twitter_handle', 'facebook_url', 'photo', 'drupal_id', 'drupal_uuid',
        'parent_id', 'parent_field_name', 'status', 'sort', 'date_created',
        'date_updated', 'migration_status'
    ];
    const contactsCsv = [contactsCsvHeaders.join(',')];

    console.log('\n🏢 Processing companies and contacts...');

    const companyMap = new Map(); // Track processed companies
    let companyCount = 0;
    let contactCount = 0;
    let failedCount = 0;

    for (const team of teamsData.data) {
        try {
            const attributes = team.attributes || {};
            const relationships = team.relationships || {};

            // Get company data
            const companyData = getCompanyFromIncluded(
                relationships.field_key_contact_company?.data,
                teamsData.included
            );

            if (!companyData) {
                console.log(`⚠️  No company found for contact ${attributes.field_name}, skipping`);
                failedCount++;
                continue;
            }

            let companyId;

            // Process company if not already processed
            if (!companyMap.has(companyData.id)) {
                const companyAttributes = companyData.attributes || {};

                // Prepare company data
                const companyMigrationData = {
                    id: companyData.id, // Use Drupal UUID
                    name: companyAttributes.title || 'Unknown Company',
                    description: companyAttributes.body?.processed || '',
                    website: companyAttributes.field_website?.uri || '',
                    logo: null, // Would need separate logo migration
                    industry: companyAttributes.field_industry || '',
                    headquarters: companyAttributes.field_headquarters || '',
                    founded_year: companyAttributes.field_founded_year || null,
                    employee_count: companyAttributes.field_employee_count || '',
                    drupal_id: companyAttributes.drupal_internal__nid,
                    drupal_uuid: companyData.id,
                    status: companyAttributes.status ? 'active' : 'inactive',
                    date_created: companyAttributes.created || new Date().toISOString(),
                    date_updated: companyAttributes.changed || new Date().toISOString()
                };

                // Create/update company in Directus
                const companyResult = await createOrUpdateCompany(directus, companyMigrationData);

                if (companyResult.success) {
                    companyId = companyResult.companyId;
                    companyMap.set(companyData.id, companyId);
                    companyCount++;

                    // Add to CSV
                    companiesCsv.push([
                        companyMigrationData.id,
                        escapeCsv(companyMigrationData.name),
                        escapeCsv(companyMigrationData.description),
                        escapeCsv(companyMigrationData.website),
                        escapeCsv(companyMigrationData.logo || ''),
                        escapeCsv(companyMigrationData.industry),
                        escapeCsv(companyMigrationData.headquarters),
                        companyMigrationData.founded_year || '',
                        escapeCsv(companyMigrationData.employee_count),
                        companyMigrationData.drupal_id || '',
                        escapeCsv(companyMigrationData.drupal_uuid),
                        companyMigrationData.status,
                        formatDateTimeForCsv(companyMigrationData.date_created),
                        formatDateTimeForCsv(companyMigrationData.date_updated),
                        'success'
                    ].join(','));
                } else {
                    console.log(`❌ Failed to create company for contact ${attributes.field_name}`);
                    failedCount++;
                    continue;
                }
            } else {
                companyId = companyMap.get(companyData.id);
            }

            // Get photo data
            const photoData = getPhotoFromIncluded(
                relationships.field_photo?.data,
                teamsData.included
            );

            let photoId = null;
            if (photoData) {
                try {
                    photoId = await uploadImage(
                        photoData.meta.drupal_internal__target_id,
                        photoData.id,
                        `contact-${attributes.field_name}`,
                        'contact_photo'
                    );
                } catch (error) {
                    console.log(`⚠️  Failed to upload photo for ${attributes.field_name}:`, error.message);
                }
            }

            // Prepare contact data
            const contactMigrationData = {
                id: team.id, // Use Drupal UUID
                company_id: companyId,
                name: attributes.field_name || '',
                role: attributes.field_role || '',
                email: attributes.field_email || '',
                phone: attributes.field_phone || '',
                linkedin_url: attributes.field_linkedin || '',
                twitter_handle: attributes.field_twitter || '',
                facebook_url: attributes.field_facebook || '',
                photo: photoId,
                drupal_id: attributes.drupal_internal__id,
                drupal_uuid: team.id,
                parent_id: attributes.parent_id,
                parent_field_name: attributes.parent_field_name,
                status: attributes.status,
                sort: 0, // Can be used for ordering
                date_created: attributes.created || new Date().toISOString(),
                date_updated: attributes.created || new Date().toISOString() // Use created if no updated
            };

            // Create/update contact in Directus
            const contactResult = await createOrUpdateContact(directus, contactMigrationData);

            if (contactResult.success) {
                contactCount++;

                // Add to CSV
                contactsCsv.push([
                    contactMigrationData.id,
                    contactMigrationData.company_id,
                    escapeCsv(contactMigrationData.name),
                    escapeCsv(contactMigrationData.role),
                    escapeCsv(contactMigrationData.email),
                    escapeCsv(contactMigrationData.phone),
                    escapeCsv(contactMigrationData.linkedin_url),
                    escapeCsv(contactMigrationData.twitter_handle),
                    escapeCsv(contactMigrationData.facebook_url),
                    escapeCsv(contactMigrationData.photo || ''),
                    contactMigrationData.drupal_id,
                    escapeCsv(contactMigrationData.drupal_uuid),
                    contactMigrationData.parent_id,
                    escapeCsv(contactMigrationData.parent_field_name),
                    contactMigrationData.status ? 'active' : 'inactive',
                    contactMigrationData.sort,
                    formatDateTimeForCsv(contactMigrationData.date_created),
                    formatDateTimeForCsv(contactMigrationData.date_updated),
                    'success'
                ].join(','));
            } else {
                failedCount++;
            }

            if ((companyCount + contactCount) % 50 === 0) {
                console.log(`  Processed ${companyCount} companies and ${contactCount} contacts...`);
            }

        } catch (error) {
            console.error(`❌ Error processing team ${team.id}:`, error.message);
            failedCount++;
        }
    }

    // Write CSV files
    console.log('\n💾 Writing CSV backup files...');
    fs.writeFileSync(path.join(csvDir, 'company_contacts_migration.csv'), contactsCsv.join('\n'), 'utf8');

    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 COMPANY CONTACTS MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`👥 Contacts migrated: ${contactCount}`);
    console.log(`❌ Failed records: ${failedCount}`);
    console.log('='.repeat(60));
    console.log('\n📁 CSV Backup files generated:');
    console.log(`   • ${path.join(csvDir, 'company_contacts_migration.csv')}`);
    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('   • Companies are linked to contacts via company_id field');
    console.log('   • Drupal UUIDs are preserved for easy reference');
    console.log('   • Contact photos are uploaded to Directus files');
    console.log('   • Parent relationships are preserved for future reference');
    console.log('='.repeat(60) + '\n');
}

// Run the migration
migrateCompanyContacts().catch((error) => {
    console.error('\n❌ MIGRATION FAILED:', error.message);
    process.exit(1);
});