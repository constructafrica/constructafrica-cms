require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDirectus } = require('../helpers/upload-image');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { uploadImage } = require('../helpers/upload-image');
const { escapeCsv, fetchMediaEntity } = require('../helpers/index');
const { readItems, createItems, updateItems } = require('@directus/sdk');

// Company relationship fields mapping
const COMPANY_RELATIONSHIP_FIELDS = [
    'field_client_owner',
    'field_developer',
    'field_authority',
    'field_architect',
    'field_design_consultant',
    'field_project_manager',
    'field_civil_engineer',
    'field_structural_engineer',
    'field_mep_engineer',
    'field_electrical_engineer',
    'field_geotechnical_engineer',
    'field_cost_consultants',
    'field_quantity_surveyor',
    'field_landscape_architect',
    'field_legal_adviser',
    'field_transaction_advisor',
    'field_study_consultant',
    'field_funding',
    'field_main_contractor',
    'field_main_contract_bidder',
    'field_main_contract_prequalified',
    'field_mep_subcontractor',
    'field_piling_subcontractor',
    'field_facade_subcontractor',
    'field_lift_subcontractor',
    'field_other_subcontractor',
    'field_operator',
    'field_feed'
];

// Fetch all projects from Drupal
async function fetchProjects() {
    const api = await getAuthenticatedApi(true);
    let allData = [];
    let includedData = [];
    let nextUrl = '/node/projects?include=field_listing_image,field_gallery_,field_key_contacts,field_news_updates_paragraph,field_stages,' + COMPANY_RELATIONSHIP_FIELDS.join(',');
    let page = 1;

    const params = {
        'page[limit]': 2,
    };

    try {
        console.log('📥 Fetching all projects with relationships...');
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
            console.log(`✅ Page ${page}: ${records.length} projects`);

            // nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
            // page++;
            // await new Promise(resolve => setTimeout(resolve, 300));
        // }
        console.log(`🎉 Fetched ${allData.length} projects across ${page} pages`);
        return { data: allData, included: includedData };
    } catch (error) {
        console.error('❌ Projects fetch failed on page', page, ':', error.response?.status, error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token might be expired, resetting authentication...');
            resetAuth();
        }
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/migration_errors.log', `Projects fetch failed on page ${page}: ${error.message}\n`);
        throw error;
    }
}

// Fetch paragraph data
async function fetchParagraph(paragraphId, paragraphType) {
    const api = await getAuthenticatedApi();
    try {
        const response = await api.get(`/paragraph/${paragraphType}/${paragraphId}?include=field_stage,field_photo,field_key_contact_company`);
        return response.data;
    } catch (error) {
        console.error(`❌ Failed to fetch paragraph ${paragraphId}:`, error.message);
        return null;
    }
}

// Transform project data
function transformProject(drupalProject) {
    const attr = drupalProject.attributes || {};
    const rel = drupalProject.relationships || {};

    return {
        id: drupalProject.id,
        drupal_id: attr.drupal_internal__nid,
        drupal_vid: attr.drupal_internal__vid,
        drupal_uuid: drupalProject.id,
        title: attr.title || '',
        slug: attr.path?.alias?.replace('/project/', '') || '',
        status: attr.status ? 'published' : 'draft',
        body: attr.body?.processed || '',
        summary: attr.body?.summary || '',

        // Financial
        contract_value_usd: attr.field_contract_value_us_m_ ? parseFloat(attr.field_contract_value_us_m_) : null,
        estimated_project_value_usd: attr.field_estimated_project_value_us ? parseFloat(attr.field_estimated_project_value_us) : null,
        revised_budget_value_usd: attr.field_revised_budget_value_us_m_ ? parseFloat(attr.field_revised_budget_value_us_m_) : null,
        value_range: attr.field_value || '',

        // Dates
        project_launch_at: attr.field_project_launch || null,
        pq_issue_date: attr.field_pq_issue_date_eoi_issue_da || null,
        pq_document_submission_date: attr.field_pq_document_submission_dat || null,
        tender_advertised_at: attr.field_tender_advertised || null,
        main_contract_tender_issue_date: attr.field_main_contract_tender_issue || null,
        main_contract_bid_submission_date: attr.field_main_contract_bid_submissi || null,
        prequalification_consultant_date: attr.field_prequalification_of_consul || null,
        prequalification_contractor_date: attr.field_prequalification_of_contra || null,
        consultant_awarded_at: attr.field_consultant_award || null,
        contract_awarded_at: attr.field_contract_awarded || null,
        main_contract_award_date: attr.field_main_contract_award || null,
        financial_close_date: attr.field_financial_close || null,
        design_completion_date: attr.field_design_completion || null,
        construction_start_date: attr.field_construction_start || null,
        construction_completion_date: attr.field_construction_completion || null,
        estimated_completion_date: attr.field_estimated_completion || null,
        study_completion_date: attr.field_study_completion || null,
        commissioning_date: attr.field_commissioning || null,
        handover_date: attr.field_handover || null,
        completed_at: attr.field_completed || null,
        in_operation: attr.field_in_operation || null,
        cancelled_at: attr.field_cancelled || null,

        // Location
        address: attr.field_address || '',
        // location: attr.field_location || '',
        location: attr.field_location_details || '',
        gps_coordinates: attr.field_gps_coordinates || '',
        map_iframe: attr.field_map_iframe?.processed || '',
        latitude: attr.field_location_geo?.[0]?.lat || null,
        longitude: attr.field_location_geo?.[0]?.lng || null,

        // Specifications
        specifications: attr.field_specifications || [],
        gross_floor_area_m2: attr.field_gross_floor_area_m2_ ? parseFloat(attr.field_gross_floor_area_m2_) : null,
        total_built_up_area_m2: attr.field_total_built_up_area_m2_ || [],
        volume_concrete_m3: attr.field_volume_of_concrete_used_m3 ? parseFloat(attr.field_volume_of_concrete_used_m3) : null,
        total_cement_bags: attr.field_total_number_of_cement_bag ? parseInt(attr.field_total_number_of_cement_bag) : null,
        total_steel_weight: attr.field_total_weight_of_steel_rods ? parseFloat(attr.field_total_weight_of_steel_rods) : null,
        total_cement_tonnage: attr.field_total_weight_tonnage_of_ce ? parseFloat(attr.field_total_weight_tonnage_of_ce) : null,
        cost_cement_per_ton: attr.field_cost_of_cement_per_ton_us_ ? parseFloat(attr.field_cost_of_cement_per_ton_us_) : null,
        cost_steel_per_ton: attr.field_cost_of_steel_rods_per_ton ? parseFloat(attr.field_cost_of_steel_rods_per_ton) : null,
        airport_passengers_million: attr.field_airport_million_passengers || [],
        airport_terminal_area_m2: attr.field_airport_terminal_area_m2_ || [],
        pipeline_km: attr.field_pipeline_km_ || [],
        rail_km: attr.field_rail_kilometre_ || [],
        road_km: attr.field_road_kilometre_ || [],
        seaport_water_depth: attr.field_seaport_water_depth_met ? parseFloat(attr.field_seaport_water_depth_met) : null,

        // Status
        current_stage: attr.field_current_stage || '',
        moderation_state: attr.moderation_state || '',
        is_free_project: attr.field_free_projects || false,
        in_planning: attr.field_in_planning || false,
        under_construction: attr.field_under_construction || false,
        bid_evaluation: attr.field_bid_evaluation || '',
        call_for_eoi: attr.field_call_for_expression_of_int || '',

        // Contact
        phone: attr.field_phone || '',
        fax: attr.field_fax || '',
        email: attr.field_email || '',
        website: attr.field_website_project || '',
        facebook: attr.field_facebook || '',
        twitter: attr.field_twitter || '',
        linkedin: attr.field_linkedin || '',

        // Additional
        editor_notes: attr.field_editor?.[0]?.processed || '',
        transport: attr.field_transport || '',
        consultant: attr.field_consultant || '',
        main_contractor_note: attr.field_main_contractor_ || '',

        date_created: attr.created || null,
        date_updated: attr.changed || null,
        user_created: rel.uid.data.id
    };
}

// Create or update project in Directus
async function createOrUpdateProject(directus, projectData) {
    try {
        // Check if project exists by drupal_id
        const existingProjects = await directus.request(
            readItems('projects', {
                filter: { drupal_id: { _eq: projectData.drupal_id } },
                limit: 1
            })
        );

        if (existingProjects && existingProjects.length > 0) {
            console.log(`🔄 Project already exists: ${projectData.title} (ID: ${projectData.drupal_id})`);
            return { success: true, action: 'skipped', projectId: existingProjects[0].id };
        } else {
            // Create new project
            const newProject = await directus.request(
                createItems('projects', projectData)
            );
            console.log(`✅ Created project: ${projectData.title}`);
            return { success: true, action: 'created', projectId: newProject.id };
        }
    } catch (error) {
        const errorMessage = error.message || error;
        console.error(`❌ Error processing project ${projectData.title}: ${errorMessage}`);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Project ${projectData.title} failed: ${errorMessage}\n`);
        return { success: false, error: errorMessage };
    }
}

// Create project contacts
async function createProjectContacts(directus, drupalContacts, projectId, companyMapping) {
    const contacts = [];

    if (!drupalContacts || drupalContacts.length === 0) return [];

    for (const contactRef of drupalContacts) {
        try {
            const contactResponse = await fetchParagraph(contactRef.id, 'teams');
            if (!contactResponse) continue;

            const contactData = contactResponse.data;
            const attr = contactData.attributes || {};
            const rel = contactData.relationships || {};

            // Upload photo if exists
            let photoId = null;
            if (rel.field_photo?.data?.id) {
                photoId = await uploadImage(rel.field_photo.data.id, 'project_contacts', true);
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
                project: projectId,
                status: 'published'
            };

            const newContact = await directus.request(
                createItems('project_contacts', contact)
            );
            contacts.push(newContact);
            console.log(`  ✅ Created contact: ${contact.name}`);
        } catch (error) {
            console.error(`  ❌ Failed to create contact:`, error.message);
        }
    }

    return contacts;
}

// Create project stages
async function createProjectStages(directus, drupalStages, projectId) {
    const stages = [];

    if (!drupalStages || drupalStages.length === 0) return [];

    for (const stageRef of drupalStages) {
        try {
            const stageResponse = await fetchParagraph(stageRef.id, 'stages');
            if (!stageResponse) continue;

            const stageData = stageResponse.data;
            const attr = stageData.attributes || {};
            const rel = stageData.relationships || {};

            const stage = {
                id: stageData.id,
                drupal_id: attr.drupal_internal__id,
                drupal_uuid: stageData.id,
                name: attr.field_stage_title || '',
                total_sub_stages: attr.field_total_sub_stages_count || 0,
                project: projectId,
                // status: 'published'
            };

            const newStage = await directus.request(
                createItems('project_stages', stage)
            );
            stages.push(newStage);
            console.log(`  ✅ Created stage: ${stage.title || 'Untitled'}`);

            // Create stage details
            if (rel.field_stage?.data && Array.isArray(rel.field_stage.data)) {
                for (const detailRef of rel.field_stage.data) {
                    try {
                        const detailResponse = await fetchParagraph(detailRef.id, 'stage');
                        if (!detailResponse) continue;

                        const detailData = detailResponse.data;
                        const detailAttr = detailData.attributes || {};

                        const detail = {
                            id: detailData.id,
                            drupal_id: detailAttr.drupal_internal__id,
                            drupal_uuid: detailData.id,
                            date: detailAttr.field_stage_date || null,
                            info: detailAttr.field_stage_info || '',
                            project_stage: newStage.id,
                            // status: 'published'
                        };

                        await directus.request(
                            createItems('stages', detail)
                        );
                        console.log(`    ✅ Created stage detail`);
                    } catch (error) {
                        console.error(`    ❌ Failed to create stage detail:`, error.message);
                    }
                }
            }
        } catch (error) {
            console.error(`  ❌ Failed to create stage:`, error.message);
        }
    }

    return stages;
}

// Create project news updates
async function createProjectNewsUpdates(directus, drupalNews, projectId) {
    const newsUpdates = [];

    if (!drupalNews || drupalNews.length === 0) return [];

    for (const newsRef of drupalNews) {
        try {
            const newsResponse = await fetchParagraph(newsRef.id, 'news_updates');
            if (!newsResponse) continue;

            const newsData = newsResponse.data;
            const attr = newsData.attributes || {};

            const news = {
                id: newsData.id,
                drupal_id: attr.drupal_internal__id,
                drupal_uuid: newsData.id,
                title: attr.field_event_type || '',
                content: attr.field_news?.processed || '',
                author: attr.field_author_new || '',
                date: attr.field_news_date || null,
                project: projectId,
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

// Create project gallery
async function createProjectGalleryOld(directus, drupalGallery, projectId) {
    const galleryItems = [];

    if (!drupalGallery || drupalGallery.length === 0) return [];

    let sortOrder = 1;
    for (const mediaRef of drupalGallery) {
        try {
            // Upload image
            const imageId = await uploadImage(mediaRef.id, 'project_gallery', true);
            if (!imageId) continue;

            const mediaItem = {
                id: uuidv4(),
                drupal_id: mediaRef.meta?.drupal_internal__target_id,
                drupal_uuid: mediaRef.id,
                type: 'image',
                file: imageId,
                project: projectId,
                sort: sortOrder++,
                status: 'published'
            };

            const newMedia = await directus.request(
                createItems('media_gallery', mediaItem)
            );
            galleryItems.push(newMedia);
            console.log(`  ✅ Created gallery item`);
        } catch (error) {
            console.error(`  ❌ Failed to create gallery item:`, error.message);
        }
    }

    return galleryItems;
}

// Create project gallery
async function createProjectGallery(directus, drupalGallery, projectId) {
    const galleryItems = [];

    if (!drupalGallery || drupalGallery.length === 0) return [];

    let sortOrder = 1;
    for (const mediaRef of drupalGallery) {
        try {
            // Fetch the media entity to get the actual file reference
            const mediaEntity = await fetchMediaEntity(mediaRef.id, 'image');
            if (!mediaEntity) {
                console.log(`  ⚠️  Could not fetch media entity: ${mediaRef.id}`);
                continue;
            }

            // Extract the file reference from field_media_image
            const fileRef = mediaEntity.relationships?.field_media_image?.data;
            if (!fileRef) {
                console.log(`  ⚠️  No file reference found in media entity: ${mediaRef.id}`);
                continue;
            }

            // Upload the actual file
            const imageId = await uploadImage(fileRef.id, 'project_gallery', true);
            if (!imageId) {
                console.log(`  ⚠️  Failed to upload file: ${fileRef.id}`);
                continue;
            }

            // Extract metadata
            const mediaAttr = mediaEntity.attributes || {};
            const fileMeta = fileRef.meta || {};

            const mediaItem = {
                id: mediaEntity.id,
                drupal_uuid: mediaEntity.id,
                type: 'image',
                name: mediaAttr.name || '',
                caption: fileMeta.title || '',
                alt_text: fileMeta.alt || '',
                file: imageId,
                project: projectId,
                sort: sortOrder++,
                status: 'published'
            };

            const newMedia = await directus.request(
                createItems('media_gallery', mediaItem)
            );
            galleryItems.push(newMedia);
            console.log(`  ✅ Created gallery item: ${mediaAttr.name}`);
        } catch (error) {
            console.error(`  ❌ Failed to create gallery item:`, error.message);
        }
    }

    return galleryItems;
}

// Create company relationships
async function createCompanyRelationships(directus, project, relationships, companyMapping) {
    const createdRelations = [];

    for (const fieldName of COMPANY_RELATIONSHIP_FIELDS) {
        const relationshipData = relationships[fieldName]?.data;
        if (!relationshipData || relationshipData.length === 0) continue;

        const directusFieldName = fieldName.replace('field_', '');
        const junctionTable = `projects_companies_${directusFieldName}`;

        for (const companyRef of relationshipData) {
            try {
                const companyId = companyMapping[companyRef.id];
                if (!companyId) {
                    console.log(`  ⚠️  Company not found in mapping: ${companyRef.id}`);
                    continue;
                }

                const relationData = {
                    id: uuidv4(),
                    projects_id: project.id,
                    companies_id: companyId
                };

                await directus.request(
                    createItems(junctionTable, relationData)
                );
                createdRelations.push({ field: directusFieldName, companyId });
            } catch (error) {
                console.error(`  ❌ Failed to create ${directusFieldName} relationship:`, error.message);
            }
        }
    }

    return createdRelations;
}

// Create taxonomy relationships
async function createTaxonomyRelationships(directus, projectId, attr, taxonomyMapping) {
    const relations = [];

    // Countries
    // if (attr.field_country && Array.isArray(attr.field_country) && attr.field_country.length > 0) {
    //     const countryCode = attr.field_country[0]; // Take first country only
    //     const countryId = taxonomyMapping.countries[countryCode];
    //     if (countryId) {
    //         try {
    //             // Update the project directly with the country ID (O2M relationship)
    //             await directus.request(
    //                 updateItems('projects', projectId, {
    //                     country: countryId
    //                 })
    //             );
    //             relations.push({ type: 'country', id: countryId });
    //             console.log(`  ✅ Linked country: ${countryCode}`);
    //
    //             // Warn if multiple countries exist
    //             if (attr.field_country.length > 1) {
    //                 console.log(`  ⚠️  Multiple countries found, using first: ${countryCode} (Others: ${attr.field_country.slice(1).join(', ')})`);
    //             }
    //         } catch (error) {
    //             console.error(`  ❌ Failed to link country:`, error.message);
    //         }
    //     }
    // }

    // Region (O2M - Single value)
    // if (attr.field_region && Array.isArray(attr.field_region) && attr.field_region.length > 0) {
    //     const regionCode = attr.field_region[0]; // Take first region only
    //     const regionId = taxonomyMapping.regions[regionCode];
    //     if (regionId) {
    //         try {
    //             // Update the project directly with the region ID (O2M relationship)
    //             await directus.request(
    //                 updateItems('projects', projectId, {
    //                     region: regionId
    //                 })
    //             );
    //             relations.push({ type: 'region', id: regionId });
    //             console.log(`  ✅ Linked region: ${regionCode}`);
    //
    //             // Warn if multiple regions exist
    //             if (attr.field_region.length > 1) {
    //                 console.log(`  ⚠️  Multiple regions found, using first: ${regionCode} (Others: ${attr.field_region.slice(1).join(', ')})`);
    //             }
    //         } catch (error) {
    //             console.error(`  ❌ Failed to link region:`, error.message);
    //         }
    //     }
    // }

    // Sector (O2M - Single value)
    // if (attr.field_sector && Array.isArray(attr.field_sector) && attr.field_sector.length > 0) {
    //     const sectorCode = attr.field_sector[0]; // Take first sector only
    //     const sectorId = taxonomyMapping.sectors[sectorCode];
    //     if (sectorId) {
    //         try {
    //             // Update the project directly with the sector ID (O2M relationship)
    //             await directus.request(
    //                 updateItems('projects', projectId, {
    //                     sector: sectorId
    //                 })
    //             );
    //             relations.push({ type: 'sector', id: sectorId });
    //             console.log(`  ✅ Linked sector: ${sectorCode}`);
    //
    //             // Warn if multiple sectors exist
    //             if (attr.field_sector.length > 1) {
    //                 console.log(`  ⚠️  Multiple sectors found, using first: ${sectorCode} (Others: ${attr.field_sector.slice(1).join(', ')})`);
    //             }
    //         } catch (error) {
    //             console.error(`  ❌ Failed to link sector:`, error.message);
    //         }
    //     }
    // }

    // Project Types
    if (attr.field_type && Array.isArray(attr.field_type)) {
        for (const typeCode of attr.field_type) {
            const typeId = taxonomyMapping.projectTypes[typeCode];
            if (typeId) {
                try {
                    await directus.request(
                        updateItems('projects', projectId, {
                            types: typeId
                        })
                    );
                    relations.push({ type: 'project_type', id: typeId });
                } catch (error) {
                    console.error(`  ⚠️  Failed to link project type:`, error.message);
                }
            }
        }
    }

    return relations;
}

// Load taxonomy mapping
function loadTaxonomyMapping() {
    const csvDir = path.join(__dirname, '../csv');
    try {
        const countries = JSON.parse(fs.readFileSync(path.join(csvDir, 'countries_mapping.json'), 'utf8'));
        const regions = JSON.parse(fs.readFileSync(path.join(csvDir, 'regions_mapping.json'), 'utf8'));
        const sectors = JSON.parse(fs.readFileSync(path.join(csvDir, 'sectors_mapping.json'), 'utf8'));
        const projectTypes = JSON.parse(fs.readFileSync(path.join(csvDir, 'project_types_mapping.json'), 'utf8'));

        return { countries, regions, sectors, projectTypes };
    } catch (error) {
        console.error('⚠️  Could not load taxonomy mapping, taxonomies will not be linked');
        return { countries: {}, regions: {}, sectors: {}, projectTypes: {} };
    }
}

// Main migration function
async function migrateProjectsToDirectus() {
    console.log('\n🚀 Starting project migration process...\n');

    // Initialize Directus client
    let directus;
    try {
        directus = await getDirectus();
    } catch (error) {
        console.error('❌ Failed to initialize Directus client:', error.message);
        fs.appendFileSync('logs/migration_errors.log', `${new Date().toISOString()} - Directus initialization failed: ${error}\n`);
        process.exit(1);
    }

    // Load company mapping
    const csvDir = path.join(__dirname, '../csv');
    let companyMapping = {};
    try {
        const mappingPath = path.join(csvDir, 'company_mapping.json');
        if (fs.existsSync(mappingPath)) {
            companyMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
            console.log(`✅ Loaded company mapping: ${Object.keys(companyMapping).length} companies`);
        } else {
            console.warn('⚠️  Company mapping not found. Run migrate-companies.js first!');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Failed to load company mapping:', error.message);
        process.exit(1);
    }

    // Load taxonomy mapping
    const taxonomyMapping = loadTaxonomyMapping();

    // Fetch projects from Drupal
    const projectsData = await fetchProjects();

    // Setup CSV files
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    const projectsCsvHeaders = [
        'id', 'drupal_id', 'drupal_uuid', 'title', 'slug', 'status',
        'contract_value_usd', 'current_stage', 'location', 'migration_status', 'migration_action'
    ];
    const projectsCsv = [projectsCsvHeaders.join(',')];

    const contactsCsvHeaders = ['id', 'drupal_id', 'name', 'role', 'email', 'project_id', 'company_id', 'migration_status'];
    const contactsCsv = [contactsCsvHeaders.join(',')];

    const stagesCsvHeaders = ['id', 'drupal_id', 'title', 'project_id', 'sub_stages_count', 'migration_status'];
    const stagesCsv = [stagesCsvHeaders.join(',')];

    const relationshipsCsvHeaders = ['project_id', 'field_name', 'company_id', 'migration_status'];
    const relationshipsCsv = [relationshipsCsvHeaders.join(',')];

    console.log('\n🏗️  Processing projects...');
    let projectCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    let failedCount = 0;
    let contactsCount = 0;
    let stagesCount = 0;
    let newsCount = 0;
    let galleryCount = 0;
    let relationshipsCount = 0;

    for (const project of projectsData.data) {
        let migrationStatus = 'failed';
        let migrationAction = 'none';

        try {
            const attr = project.attributes || {};
            const rel = project.relationships || {};

            // Transform project data
            const projectData = transformProject(project);

            // Upload listing image if exists
            if (rel.field_listing_image?.data?.id) {
                try {
                    projectData.faetured_image = await uploadImage(rel.field_listing_image.data.id, 'projects', true);
                } catch (error) {
                    console.error(`  ⚠️  Failed to upload listing image:`, error.message);
                }
            }

            // Create or update project
            const result = await createOrUpdateProject(directus, projectData);

            if (result.success) {
                if (result.action === 'created') {
                    projectCount++;
                    createdCount++;
                    migrationStatus = 'success';
                    migrationAction = 'created';

                    // Create contacts
                    const contacts = await createProjectContacts(
                        directus,
                        rel.field_key_contacts?.data,
                        result.projectId,
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
                            result.projectId,
                            contact.company || '',
                            'success'
                        ].join(','));
                    }

                    // Create stages
                    const stages = await createProjectStages(
                        directus,
                        rel.field_stages?.data,
                        result.projectId
                    );
                    stagesCount += stages.length;

                    // Add stages to CSV
                    for (const stage of stages) {
                        stagesCsv.push([
                            stage.id,
                            stage.drupal_id || '',
                            escapeCsv(stage.title),
                            result.projectId,
                            stage.total_sub_stages || 0,
                            'success'
                        ].join(','));
                    }

                    // Create news updates
                    // const news = await createProjectNewsUpdates(
                    //     directus,
                    //     rel.field_news_updates_paragraph?.data,
                    //     result.projectId
                    // );
                    // newsCount += news.length;

                    // Create gallery
                    const gallery = await createProjectGallery(
                        directus,
                        rel.field_gallery_?.data,
                        result.projectId
                    );
                    galleryCount += gallery.length;

                    // Create company relationships
                    const companyRelations = await createCompanyRelationships(
                        directus,
                        { id: result.projectId },
                        rel,
                        companyMapping
                    );
                    relationshipsCount += companyRelations.length;

                    // Add relationships to CSV
                    for (const relation of companyRelations) {
                        relationshipsCsv.push([
                            result.projectId,
                            relation.field,
                            relation.companyId,
                            'success'
                        ].join(','));
                    }

                    // Create taxonomy relationships
                    await createTaxonomyRelationships(
                        directus,
                        result.projectId,
                        attr,
                        taxonomyMapping
                    );

                } else if (result.action === 'skipped') {
                    skippedCount++;
                    migrationStatus = 'skipped';
                    migrationAction = 'skipped';
                }
            } else {
                failedCount++;
                migrationStatus = 'failed';
                migrationAction = 'error';
            }

            // Add to CSV backup
            projectsCsv.push([
                project.id,
                projectData.drupal_id || '',
                escapeCsv(projectData.drupal_uuid),
                escapeCsv(projectData.title),
                escapeCsv(projectData.slug),
                projectData.status,
                projectData.contract_value_usd || '',
                escapeCsv(projectData.current_stage),
                escapeCsv(projectData.location),
                migrationStatus,
                migrationAction
            ].join(','));

            if (projectCount % 20 === 0 && projectCount > 0) {
                console.log(`  Processed ${projectCount} projects...`);
            }

        } catch (error) {
            console.error(`❌ Error processing project ${project.id}:`, error.message);
            failedCount++;

            const attr = project.attributes || {};
            projectsCsv.push([
                project.id,
                attr.drupal_internal__nid || '',
                escapeCsv(project.id),
                escapeCsv(attr.title || ''),
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
                `Project ${project.id} (${attr.title}) processing failed: ${error.message}\n${error.stack}\n`
            );
        }
    }

    // Write CSV files
    console.log('\n💾 Writing CSV backup files...');
    fs.writeFileSync(path.join(csvDir, 'projects_migration_backup.csv'), projectsCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'project_contacts_backup.csv'), contactsCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'project_stages_backup.csv'), stagesCsv.join('\n'), 'utf8');
    fs.writeFileSync(path.join(csvDir, 'project_company_relationships_backup.csv'), relationshipsCsv.join('\n'), 'utf8');

    // Generate migration summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 PROJECT MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Projects created: ${createdCount}`);
    console.log(`⏭️  Projects skipped: ${skippedCount}`);
    console.log(`❌ Projects failed: ${failedCount}`);
    console.log(`👥 Contacts created: ${contactsCount}`);
    console.log(`📅 Stages created: ${stagesCount}`);
    console.log(`📰 News updates created: ${newsCount}`);
    console.log(`🖼️  Gallery items created: ${galleryCount}`);
    console.log(`🔗 Company relationships created: ${relationshipsCount}`);
    console.log('='.repeat(60));
    console.log('\n📁 CSV Backup files generated:');
    console.log(`   • ${path.join(csvDir, 'projects_migration_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'project_contacts_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'project_stages_backup.csv')}`);
    console.log(`   • ${path.join(csvDir, 'project_company_relationships_backup.csv')}`);
    if (failedCount > 0) {
        console.log(`\n📜 Check logs/migration_errors.log for details`);
    }
    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('   • Project UUIDs from Drupal are preserved as Directus IDs');
    console.log('   • All company relationships have been created in junction tables');
    console.log('   • Project stages and stage details have been migrated');
    console.log('   • Gallery images have been uploaded and linked');
    console.log('   • Taxonomy relationships (countries, regions, sectors) created');
    console.log('   • This script must be run AFTER migrate-companies.js');
    console.log('='.repeat(60) + '\n');
}

// Run the migration
migrateProjectsToDirectus().catch((error) => {
    console.error('\n❌ MIGRATION FAILED:', error.message);
    console.error(error.stack);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync(
        'logs/migration_errors.log',
        `\n\n=== PROJECT MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`
    );
    process.exit(1);
});