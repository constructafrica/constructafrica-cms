require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/upload-image');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { uploadImage } = require('../helpers/upload-image');
const { escapeCsv, fetchMediaEntity, fetchParagraph, galleryImageExists} = require('../helpers/index');
const { readItems, createItems, updateItems, readItem } = require('@directus/sdk');

// Fetch all companies from Drupal
async function fetchCompanies() {
    const api = await getAuthenticatedApi(true);
    let allData = [];
    let includedData = [];
    let nextUrl = '/node/company?sort=-created';
    // let nextUrl = '/node/company?include=field_logo,field_gallery,field_key_contacts_companies,field_team,field_awards_companies,field_certifications_companies,field_news_updates_paragraph_com,field_projects,field_tags_company,field_country,field_region,field_sector,field_type';
    let page = 1;

    const params = {
        'page[limit]': 10,
    };

    try {
        console.log('📥 Fetching all companies with relationships...');
        // while (nextUrl) {
            console.log(`📄 Fetching page ${page}...`);
            const response = await api.get(nextUrl, {
                params: page === 1 ? params : {}
            });

            const records = response.data.data || [];
            allData = allData.concat(records);
            if (response.data.included) {
                includedData = includedData.concat(response.data.included);
            }
            console.log(`✅ Page ${page}: ${records.length} companies`);

            // nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
            // page++;
            // await new Promise(resolve => setTimeout(resolve, 300));
        // }
        console.log(`🎉 Fetched ${allData.length} companies across ${page} pages`);
        return { data: allData, included: includedData };
    } catch (error) {
        console.error('❌ Companies fetch failed on page', page, ':', error.response?.status, error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token might be expired, resetting authentication...');
            resetAuth();
        }
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/migration_errors.log', `Companies fetch failed on page ${page}: ${error.message}\n`);
        throw error;
    }
}

// Fetch all taxonomy terms
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

// Create company gallery
async function createCompanyGallery(directus, drupalGallery, companyId) {
    const galleryItems = [];

    console.log('Uploading company gallery=====')
    if (!drupalGallery || !drupalGallery.id) {
        console.log('No gallery found for the company', drupalGallery)
        return [];
    }

    try {
        // Fetch the gallery media entity
        const galleryEntity = await fetchMediaEntity(drupalGallery.id, 'gallery');
        if (!galleryEntity) {
            console.log(`  ⚠️  Could not fetch gallery entity: ${drupalGallery.id}`);
            return [];
        }

        const galleryAttr = galleryEntity.attributes || {};
        const galleryRel = galleryEntity.relationships || {};

        console.log(`  📸 Processing gallery: ${galleryAttr.name}`);

        // Get the main/featured image (field_media_image)
        const mainImageRef = galleryRel.field_media_image?.data;
        let imageId = null;
        if (mainImageRef) {
            try {
                imageId = await uploadImage(mainImageRef.id, 'company_gallery', true);

                if (imageId) {
                    // Prevent duplicates
                    const exists = await galleryImageExists(directus, imageId, companyId, 'company');
                    if (exists) {
                        console.log(`⚠️ Skipping duplicate featured image for company ${companyId}`);
                    } else {
                        const mediaItem = {
                            id: uuidv4(),
                            drupal_id: galleryAttr.drupal_internal__mid,
                            drupal_uuid: galleryEntity.id,
                            type: 'image',
                            name: galleryAttr.name || 'Featured Image',
                            caption: mainImageRef.meta?.title || '',
                            alt_text: mainImageRef.meta?.alt || '',
                            file: imageId,
                            company: companyId,
                            sort: 1,
                        };

                        const newMedia = await directus.request(
                            createItems('media_gallery', mediaItem)
                        );
                        galleryItems.push(newMedia);
                        console.log(`    ✅ Created featured image`);
                    }
                }
            } catch (error) {
                console.error(`    ❌ Failed to create featured image: ${companyId} imageID ${imageId}`, error);
                fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Featured image creation failed: ${error}\n`);
            }
        }

        // Get all gallery images (field_gallery_images)
        const galleryImagesRef = galleryRel.field_gallery_images?.data;
        if (galleryImagesRef && Array.isArray(galleryImagesRef)) {
            let sortOrder = 2; // Start after featured image

            for (const imageRef of galleryImagesRef) {
                try {
                    const imageId = await uploadImage(imageRef.id, 'company_gallery', true);
                    if (!imageId) continue;

                    const exists = await galleryImageExists(directus, imageId, companyId, 'company');
                    if (exists) {
                        console.log(`⚠️ Skipping duplicate featured image for company ${companyId}`);
                    } else {
                        const mediaItem = {
                            id: uuidv4(),
                            drupal_id: imageRef.meta?.drupal_internal__target_id,
                            drupal_uuid: imageRef.id,
                            type: 'image',
                            name: `${galleryAttr.name} - Image ${sortOrder - 1}`,
                            caption: imageRef.meta?.title || '',
                            alt_text: imageRef.meta?.alt || '',
                            file: imageId,
                            company: companyId,
                            sort: sortOrder++,
                            status: 'published'
                        };

                        const newMedia = await directus.request(
                            createItems('media_gallery', mediaItem)
                        );
                        galleryItems.push(newMedia);
                        console.log(`    ✅ Created gallery image ${sortOrder - 2}`);
                    }
                } catch (error) {
                    console.error(`    ❌ Failed to create gallery image:`, error);
                }
            }
        }

        console.log(`  ✅ Total gallery items created: ${galleryItems.length}`);

    } catch (error) {
        console.error(`  ❌ Failed to process gallery:`, error.message);
    }

    return galleryItems;
}

// Transform company data
function transformCompany(drupalCompany) {
    const attr = drupalCompany.attributes || {};
    const rel = drupalCompany.relationships || {};

    return {
        id: drupalCompany.id,
        drupal_id: attr.drupal_internal__nid,
        drupal_uuid: drupalCompany.id,
        name: attr.title || '',
        slug: attr.path?.alias?.replace('/company/', '') || '',
        status: attr.status ? 'published' : 'draft',
        description: attr.body?.processed || '',
        activities: attr.field_activities || '',
        company_role: attr.field_company_role || '',
        headquarters: attr.field_headquater || '',
        employees: attr.field_employees ? parseInt(attr.field_employees) : null,
        projects_completed: attr.field_projects_completed ? parseInt(attr.field_projects_completed) : null,
        ongoing_projects: attr.field_on_going_projects ? parseInt(attr.field_on_going_projects) : null,
        address: attr.field_address || '',
        location_details: attr.field_location_details?.processed || '',
        latitude: attr.field_location_geo?.[0]?.lat || null,
        longitude: attr.field_location_geo?.[0]?.lng || null,
        map_iframe: attr.field_map_iframe?.processed || '',
        phone: attr.field_phone || '',
        fax: attr.field_fax || '',
        email: attr.field_email || '',
        company_email: attr.field_company_email || '',
        website: attr.field_website || '',
        facebook: attr.field_facebook || '',
        twitter: attr.field_twitter || '',
        linkedin: attr.field_linkedin || '',
        awards: attr.field_awards || '',
        certifications: attr.field_certifications || '',
        is_free_company: attr.field_free_company || false,
        date_created: attr.created || null,
        date_updated: attr.changed || null,
        user_created: rel.uid.data.id
    };
}

// Create or update company in Directus
async function createOrUpdateCompany(directus, companyData) {
    try {
        // Check if company exists by drupal_id
        const existingCompanies = await directus.request(
            readItems('companies', {
                filter: { drupal_id: { _eq: companyData.drupal_id } },
                limit: 1
            })
        );

        if (existingCompanies && existingCompanies.length > 0) {
            console.log(`🔄 Company already exists: ${companyData.name} (ID: ${companyData.drupal_id})`);
            return { success: true, action: 'skipped', companyId: existingCompanies[0].id };
        } else {
            // Create new company
            const newCompany = await directus.request(
                createItems('companies', companyData)
            );
            console.log(`✅ Created company: ${companyData.name}`);
            return { success: true, action: 'created', companyId: newCompany.id };
        }
    } catch (error) {
        const errorMessage = error.message || error;
        console.error(`❌ Error processing company ${companyData.name}: ${errorMessage}`);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Company ${companyData.name} failed: ${errorMessage}\n`);
        return { success: false, error: errorMessage };
    }
}

// Create company contacts
async function createCompanyContacts(directus, drupalContacts, companyId, includedData) {
    const contacts = [];

    console.log('creating company contacts ==')
    if (!drupalContacts || drupalContacts.length === 0) return [];

    for (const contactRef of drupalContacts) {
        try {
            const contactData = await fetchParagraph(contactRef.id, 'teams');
            if (!contactData) continue;

            const attr = contactData.attributes || {};
            const rel = contactData.relationships || {};

            // Upload photo if exists
            let photoId = null;
            if (rel.field_photo?.data?.id) {
                photoId = await uploadImage(rel.field_photo.data.id, 'company_contacts', true);
            }

            const contact = {
                id: contactData.id,
                drupal_id: attr.drupal_internal__id,
                drupal_uuid: contactData.id,
                name: attr.field_name || '',
                role: attr.field_role || '',
                email: attr.field_email || '',
                phone: attr.field_phone || '',
                facebook: attr.field_facebook || '',
                twitter: attr.field_twitter || '',
                linkedin: attr.field_linkedin || '',
                photo: photoId,
                company: companyId,
                status: 'published'
            };

            const newContact = await directus.request(
                createItems('contacts', contact)
            );
            contacts.push(newContact);
            console.log(`  ✅ Created contact: ${contact.name}`);
        } catch (error) {
            console.error(`  ❌ Failed to create contact:`, error.message);
        }
    }

    return contacts;
}

// Create company team members
async function createCompanyTeamMembers(directus, drupalTeam, companyId, includedData) {
    const teamMembers = [];

    if (!drupalTeam || drupalTeam.length === 0) return [];

    for (const memberRef of drupalTeam) {
        try {
            const memberData = await fetchParagraph(memberRef.id, 'teams');
            if (!memberData) continue;

            const attr = memberData.attributes || {};
            const rel = memberData.relationships || {};

            // Upload photo if exists
            let photoId = null;
            if (rel.field_photo?.data?.id) {
                photoId = await uploadImage(rel.field_photo.data.id, 'company_team', true);
            }

            const member = {
                id: memberData.id,
                drupal_id: attr.drupal_internal__id,
                drupal_uuid: memberData.id,
                name: attr.field_name || '',
                position: attr.field_role || '',
                email: attr.field_email || '',
                phone: attr.field_phone || '',
                facebook: attr.field_facebook || '',
                twitter: attr.field_twitter || '',
                linkedin: attr.field_linkedin || '',
                photo: photoId,
                company: companyId,
                status: 'published'
            };

            const newMember = await directus.request(
                createItems('company_team_members', member)
            );
            teamMembers.push(newMember);
            console.log(`  ✅ Created team member: ${member.name}`);
        } catch (error) {
            console.error(`  ❌ Failed to create team member:`, error.message);
        }
    }

    return teamMembers;
}

// Create company news updates
async function createCompanyNewsUpdates(directus, drupalNews, companyId) {
    const newsUpdates = [];
    console.log('creating company news and updates')

    if (!drupalNews || drupalNews.length === 0) return [];

    for (const newsRef of drupalNews) {
        try {
            const newsData = await fetchParagraph(newsRef.id, 'news_updates');
            if (!newsData) continue;

            const attr = newsData.attributes || {};

            const news = {
                id: newsData.id,
                drupal_id: attr.drupal_internal__id,
                drupal_uuid: newsData.id,
                title: attr.field_event_type || '',
                content: attr.field_news?.processed || '',
                author: attr.field_author_new || '',
                date: attr.field_news_date || null,
                company: companyId,
                status: 'published'
            };

            const newNews = await directus.request(
                createItems('news_updates', news)
            );
            newsUpdates.push(newNews);
            console.log(`  ✅ Created news update: ${news.title}`);
        } catch (error) {
            console.error(`  ❌ Failed to create news update:`, error.message);
        }
    }

    return newsUpdates;
}

// Create taxonomy or get existing
async function createOrGetTaxonomy(directus, collection, code, name, description = '') {
    try {
        // Check if exists
        const existing = await directus.request(
            readItems(collection, {
                filter: { name: { _eq: name } },
                limit: 1
            })
        );

        if (existing && existing.length > 0) {
            return existing[0].id;
        }

        // Create new
        const newItem = await directus.request(
            createItems(collection, {
                id: uuidv4(),
                name: name,
                description: description
            })
        );

        return newItem.id;
    } catch (error) {
        console.error(`❌ Error creating taxonomy ${collection}/${code}:`, error.message);
        return null;
    }
}

// Main migration function
async function migrateCompaniesToDirectus() {
    console.log('\n🚀 Starting company migration process...\n');

    // Initialize Directus client
    let directus;
    try {
        directus = await getDirectus();
    } catch (error) {
        console.error('❌ Failed to initialize Directus client:', error.message);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Directus initialization failed: ${error}\n`);
        process.exit(1);
    }

    // Fetch taxonomies from Drupal
    console.log('\n📚 Fetching taxonomies...');
    // const countries = await fetchTaxonomyTerms('country');
    // const regions = await fetchTaxonomyTerms('region');
    // const sectors = await fetchTaxonomyTerms('sector');
    // const companyTypes = await fetchTaxonomyTerms('company_type');

    // Create taxonomy mappings
    const countryMapping = {};
    const regionMapping = {};
    const sectorMapping = {};
    const companyTypeMapping = {};

    // console.log('\n🗂️  Creating taxonomy records...');

    // for (const country of countries) {
    //     const id = await createOrGetTaxonomy(
    //         directus,
    //         'countries',
    //         country.id,
    //         country.attributes.name || '',
    //         country.attributes.description?.processed || ''
    //     );
    //     countryMapping[country.id] = id;
    // }
    //
    // for (const region of regions) {
    //     const id = await createOrGetTaxonomy(
    //         directus,
    //         'regions',
    //         region.attributes.drupal_internal__tid?.toString() || region.id,
    //         region.attributes.name || '',
    //         region.attributes.description?.processed || ''
    //     );
    //     regionMapping[region.id] = id;
    // }
    //
    // for (const sector of sectors) {
    //     const id = await createOrGetTaxonomy(
    //         directus,
    //         'sectors',
    //         sector.attributes.drupal_internal__tid?.toString() || sector.id,
    //         sector.attributes.name || '',
    //         sector.attributes.description?.processed || ''
    //     );
    //     sectorMapping[sector.id] = id;
    // }

    // for (const type of companyTypes) {
    //     const id = await createOrGetTaxonomy(
    //         directus,
    //         'project_types',
    //         type.attributes.drupal_internal__tid?.toString() || type.id,
    //         type.attributes.name || '',
    //         type.attributes.description?.processed || ''
    //     );
    //     companyTypeMapping[type.id] = id;
    // }

    // Fetch companies from Drupal
    const companiesData = await fetchCompanies();

    // Setup CSV files
    const csvDir = path.join(__dirname, '../csv');
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    const companiesCsvHeaders = [
        'id', 'drupal_id', 'drupal_uuid', 'name', 'slug', 'status', 'description',
        'headquarters', 'employees', 'projects_completed', 'phone', 'email', 'website',
        'migration_status', 'migration_action'
    ];
    const companiesCsv = [companiesCsvHeaders.join(',')];

    const contactsCsvHeaders = ['id', 'drupal_id', 'name', 'role', 'email', 'company_id', 'migration_status'];
    const contactsCsv = [contactsCsvHeaders.join(',')];

    const teamMembersCsvHeaders = ['id', 'drupal_id', 'name', 'position', 'email', 'company_id', 'migration_status'];
    const teamMembersCsv = [teamMembersCsvHeaders.join(',')];

    console.log('\n🏢 Processing companies...');
    let companyCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    let failedCount = 0;
    let contactsCount = 0;
    let teamMembersCount = 0;
    let newsCount = 0;
    let galleryCount = 0;

    const companyMapping = {}; // Store drupal UUID to Directus ID mapping

    for (const company of companiesData.data) {
        let migrationStatus = 'failed';
        let migrationAction = 'none';

        try {
            const attr = company.attributes || {};
            const rel = company.relationships || {};

            // Transform company data
            const companyData = transformCompany(company);

            // Upload logo if exists
            if (rel.field_logo?.data?.id) {
                try {
                    companyData.logo = await uploadImage(rel.field_logo.data.id, 'company_logos', true);
                } catch (error) {
                    console.error(`  ⚠️  Failed to upload logo:`, error.message);
                }
            }

            // Create or update company
            const result = await createOrUpdateCompany(directus, companyData);

            if (result.success) {
                companyMapping[company.id] = result.companyId;

                // if (result.action === 'created') {
                    companyCount++;
                    createdCount++;
                    migrationStatus = 'success';
                    migrationAction = 'created';

                    // Create contacts
                    const contacts = await createCompanyContacts(
                        directus,
                        rel.field_key_contacts_companies?.data,
                        result.companyId,
                    );

                    contactsCount += contacts.length;

                    // Add contacts to CSV
                    for (const contact of contacts) {
                        contactsCsv.push([
                            contact.id,
                            contact.drupal_id || '',
                            escapeCsv(contact.name),
                            escapeCsv(contact.role),
                            escapeCsv(contact.email),
                            result.companyId,
                            'success'
                        ].join(','));
                    }

                    // Create team members
                    // const teamMembers = await createCompanyTeamMembers(
                    //     directus,
                    //     rel.field_team?.data,
                    //     result.companyId,
                    //     companiesData.included
                    // );
                    // teamMembersCount += teamMembers.length;
                    //
                    // // Add team members to CSV
                    // for (const member of teamMembers) {
                    //     teamMembersCsv.push([
                    //         member.id,
                    //         member.drupal_id || '',
                    //         escapeCsv(member.name),
                    //         escapeCsv(member.position),
                    //         escapeCsv(member.email),
                    //         result.companyId,
                    //         'success'
                    //     ].join(','));
                    // }

                    // Create news updates
                    const news = await createCompanyNewsUpdates(
                        directus,
                        rel.field_news_updates_paragraph_com?.data,
                        result.companyId
                    );
                    newsCount += news.length;

                    // Create gallery
                    const gallery = await createCompanyGallery(
                        directus,
                        rel.field_gallery?.data,
                        result.companyId
                    );
                    galleryCount += gallery.length;


                    // Handle taxonomy relationships
                    const taxonomyRelations = [];

                    // Countries
                    // if (attr.field_country && Array.isArray(attr.field_country)) {
                    //     for (const countryCode of attr.field_country) {
                    //         const countryId = countryMapping[countryCode];
                    //         if (countryId) {
                    //             taxonomyRelations.push({
                    //                 collection: 'companies_countries',
                    //                 data: {
                    //                     companies_id: result.companyId,
                    //                     countries_id: countryId
                    //                 }
                    //             });
                    //         }
                    //     }
                    // }

                    // Regions
                    // if (attr.field_region && Array.isArray(attr.field_region)) {
                    //     for (const regionCode of attr.field_region) {
                    //         const regionId = regionMapping[regionCode];
                    //         if (regionId) {
                    //             taxonomyRelations.push({
                    //                 collection: 'companies_regions',
                    //                 data: {
                    //                     companies_id: result.companyId,
                    //                     regions_id: regionId
                    //                 }
                    //             });
                    //         }
                    //     }
                    // }

                    // Sectors
                    // if (attr.field_sector && Array.isArray(attr.field_sector)) {
                    //     for (const sectorCode of attr.field_sector) {
                    //         const sectorId = sectorMapping[sectorCode];
                    //         if (sectorId) {
                    //             taxonomyRelations.push({
                    //                 collection: 'companies_sectors',
                    //                 data: {
                    //                     companies_id: result.companyId,
                    //                     sectors_id: sectorId
                    //                 }
                    //             });
                    //         }
                    //     }
                    // }

                    // Company Types
                    // if (attr.field_type && Array.isArray(attr.field_type)) {
                    //     for (const typeCode of attr.field_type) {
                    //         const typeId = companyTypeMapping[typeCode];
                    //         if (typeId) {
                    //             taxonomyRelations.push({
                    //                 collection: 'companies_company_types',
                    //                 data: {
                    //                     companies_id: result.companyId,
                    //                     company_types_id: typeId
                    //                 }
                    //             });
                    //         }
                    //     }
                    // }

                    // Create all taxonomy relations
                    // for (const relation of taxonomyRelations) {
                    //     try {
                    //         await directus.request(
                    //             createItems(relation.collection, relation.data)
                    //         );
                    //     } catch (error) {
                    //         console.error(`  ⚠️  Failed to create taxonomy relation:`, error.message);
                    //     }
                    // }

                // } else if (result.action === 'skipped') {
                //     skippedCount++;
                //     migrationStatus = 'skipped';
                //     migrationAction = 'skipped';
                // }
            } else {
                failedCount++;
                migrationStatus = 'failed';
                migrationAction = 'error';
            }

            // Add to CSV backup
            companiesCsv.push([
                company.id,
                companyData.drupal_id || '',
                escapeCsv(companyData.drupal_uuid),
                escapeCsv(companyData.name),
                escapeCsv(companyData.slug),
                companyData.status,
                escapeCsv(companyData.description?.substring(0, 100) || ''),
                escapeCsv(companyData.headquarters),
                companyData.employees || '',
                companyData.projects_completed || '',
                escapeCsv(companyData.phone),
                escapeCsv(companyData.email),
                escapeCsv(companyData.website),
                migrationStatus,
                migrationAction
            ].join(','));

            if (companyCount % 20 === 0 && companyCount > 0) {
                console.log(`  Processed ${companyCount} companies...`);
            }

        } catch (error) {
            console.error(`❌ Error processing company ${company.id}:`, error.message);
            failedCount++;

            const attr = company.attributes || {};
            companiesCsv.push([
                company.id,
                attr.drupal_internal__nid || '',
                escapeCsv(company.id),
                escapeCsv(attr.title || ''),
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                '',
                'failed',
                'exception'
            ].join(','));

            if (!fs.existsSync('logs')) fs.mkdirSync('logs');
            fs.appendFileSync(
                'logs/migration_errors.log',
                `Company ${company.id} (${attr.title}) processing failed: ${error.message}\n${error.stack}\n`
            );
        }
    }

    // Write CSV files
    console.log('\n💾 Writing CSV backup files...');
    fs.writeFileSync(path.join(csvDir, 'companies_migration_backup.csv'), companiesCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'company_contacts_backup.csv'), contactsCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'company_team_members_backup.csv'), teamMembersCsv.join('\n'), 'utf8');

    // Save company mapping for projects migration
    fs.writeFileSync(
        path.join(csvDir, 'company_mapping.json'),
        JSON.stringify(companyMapping, null, 2),
        'utf8'
    );

    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 COMPANY MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Companies created: ${createdCount}`);
    console.log(`⏭️  Companies skipped: ${skippedCount}`);
    console.log(`❌ Companies failed: ${failedCount}`);
    console.log(`👥 Contacts created: ${contactsCount}`);
    console.log(`👔 Team members created: ${teamMembersCount}`);
    console.log(`📰 News updates created: ${newsCount}`);
    console.log('='.repeat(60));
    console.log('\n📁 CSV Backup files generated:');
    console.log(`   • ${path.join(csvDir, 'companies_migration_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'company_contacts_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'company_team_members_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'company_mapping.json')} (for projects migration)`);
    if (failedCount > 0) {
        console.log(`\n📜 Check logs/migration_errors.log for details`);
    }
    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('   • Company UUIDs from Drupal are preserved as Directus IDs');
    console.log('   • Company mapping saved for use in projects migration');
    console.log('   • Taxonomies (countries, regions, sectors) created automatically');
    console.log('   • Run migrate-projects.js next to migrate projects with company relationships');
    console.log('='.repeat(60) + '\n');
}

// Run the migration
migrateCompaniesToDirectus().catch((error) => {
    console.error('\n❌ MIGRATION FAILED:', error.message);
    console.error(error.stack);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync(
        'logs/migration_errors.log',
        `\n\n=== COMPANY MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`
    );
    process.exit(1);
});