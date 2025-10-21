require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getDirectus } = require("../helpers/directus-auth");
const { getAuthenticatedApi, resetAuth, makeResilientApiCall } = require("../helpers/auth");
const { uploadImage } = require("../helpers/upload-image");
const {
    escapeCsv,
    fetchMediaEntity,
    loadTaxonomyMapping,
    getUserId,
} = require("../helpers/index");
const {
    readItems,
    createItems,
    updateItems,
    readUsers,
} = require("@directus/sdk");

// Configuration
const PROJECTS_PER_PAGE = 50;
const PROJECTS_PER_JSON_FILE = 100; // Store 100 projects per JSON file
const JSON_DATA_DIR = path.join(process.cwd(), 'data', 'projects');

// Ensure data directory exists
if (!fs.existsSync(JSON_DATA_DIR)) {
    fs.mkdirSync(JSON_DATA_DIR, { recursive: true });
}

// Company relationship fields mapping
const COMPANY_RELATIONSHIP_FIELDS = [
    "field_client_owner",
    "field_developer",
    "field_authority",
    "field_architect",
    "field_design_consultant",
    "field_project_manager",
    "field_civil_engineer",
    "field_structural_engineer",
    "field_mep_engineer",
    "field_electrical_engineer",
    "field_geotechnical_engineer",
    "field_cost_consultants",
    "field_quantity_surveyor",
    "field_landscape_architect",
    "field_legal_adviser",
    "field_transaction_advisor",
    "field_study_consultant",
    "field_funding",
    "field_main_contractor",
    "field_main_contract_bidder",
    "field_main_contract_prequalified",
    "field_mep_subcontractor",
    "field_piling_subcontractor",
    "field_facade_subcontractor",
    "field_lift_subcontractor",
    "field_other_subcontractor",
    "field_operator",
    "field_feed",
];

// Fetch all projects from Drupal and save to JSON files
async function fetchAndSaveProjects() {
    const api = await getAuthenticatedApi(true);
    let allData = [];
    let includedData = [];
    let nextUrl =
        "/node/projects?sort=-created&include=field_listing_image,field_gallery_,field_key_contacts,field_news_updates_paragraph,field_stages," +
        COMPANY_RELATIONSHIP_FIELDS.join(",");
    let page = 1;
    let jsonFileIndex = 1;
    let projectsInCurrentFile = 0;
    let currentFileData = { data: [], included: [] };

    const params = {
        "page[limit]": PROJECTS_PER_PAGE,
    };

    try {
        console.log("📥 Fetching all projects with relationships and saving to JSON files...");

        while (nextUrl) {
            console.log(`📄 Fetching page ${page}...`);

            let response;
            try {
                response = await makeResilientApiCall(
                    () => api.get(nextUrl, {
                        params: page === 1 ? params : {},
                        timeout: 120000 // 2 minutes timeout for large requests
                    }),
                    `Fetching projects page ${page}`
                );
            } catch (error) {
                console.error(`❌ Failed to fetch page ${page} after retries:`, error.message);

                // Save whatever we have so far
                if (currentFileData.data.length > 0) {
                    const filename = `projects_page_${jsonFileIndex}_partial.json`;
                    const filepath = path.join(JSON_DATA_DIR, filename);
                    fs.writeFileSync(filepath, JSON.stringify(currentFileData, null, 2), 'utf8');
                    console.log(`💾 Saved partial data (${currentFileData.data.length} projects) to ${filename}`);
                }

                throw error;
            }

            const records = response.data.data || [];

            if (!records || records.length === 0) {
                console.log(`⚠️ No records found on page ${page}, stopping pagination`);
                break;
            }

            allData = allData.concat(records);

            if (response.data.included) {
                includedData = includedData.concat(response.data.included);
                currentFileData.included = currentFileData.included.concat(response.data.included);
            }

            // Add records to current file
            currentFileData.data = currentFileData.data.concat(records);
            projectsInCurrentFile += records.length;

            console.log(`✅ Page ${page}: ${records.length} projects`);

            // Save to JSON file when we reach the limit or this is the last page
            const isLastPage = !response.data.links?.next?.href;
            if (projectsInCurrentFile >= PROJECTS_PER_JSON_FILE || isLastPage) {
                const filename = `projects_page_${jsonFileIndex}.json`;
                const filepath = path.join(JSON_DATA_DIR, filename);

                fs.writeFileSync(filepath, JSON.stringify(currentFileData, null, 2), 'utf8');
                console.log(`💾 Saved ${projectsInCurrentFile} projects to ${filename}`);

                // Reset for next file
                jsonFileIndex++;
                projectsInCurrentFile = 0;
                currentFileData = { data: [], included: [] };
            }

            nextUrl =
                response.data.links?.next?.href?.replace(api.defaults.baseURL, "") ||
                null;
            page++;

            // Add progressive delay to avoid overwhelming the server
            const delay = Math.min(500 + (page * 100), 5000); // Progressive delay up to 5 seconds
            console.log(`⏳ Waiting ${delay}ms before next page...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        console.log(`🎉 Fetched ${allData.length} projects across ${page} pages and saved to ${jsonFileIndex-1} JSON files`);
        return { data: allData, included: includedData };
    } catch (error) {
        console.error(
            "❌ Projects fetch failed on page",
            page,
            ":",
            error.response?.status,
            error.response?.data || error.message,
        );

        // Save partial progress
        if (currentFileData.data.length > 0) {
            const filename = `projects_page_${jsonFileIndex}_partial.json`;
            const filepath = path.join(JSON_DATA_DIR, filename);
            fs.writeFileSync(filepath, JSON.stringify(currentFileData, null, 2), 'utf8');
            console.log(`💾 Saved partial progress (${currentFileData.data.length} projects) to ${filename}`);
        }

        if (error.response?.status === 401) {
            console.log("🔄 Token might be expired, resetting authentication...");
            resetAuth();
        }

        if (!fs.existsSync("logs")) fs.mkdirSync("logs");
        fs.appendFileSync(
            "logs/migration_errors.log",
            `Projects fetch failed on page ${page}: ${error.message}\n`,
        );
        throw error;
    }
}

// Load projects from JSON files
async function loadProjectsFromJson() {
    try {
        console.log('📂 Loading projects from JSON files...');

        const files = fs.readdirSync(JSON_DATA_DIR)
            .filter(file => file.startsWith('projects_page_') && file.endsWith('.json') && !file.includes('_partial'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/projects_page_(\d+)\.json/)[1]);
                const numB = parseInt(b.match(/projects_page_(\d+)\.json/)[1]);
                return numA - numB;
            });

        if (files.length === 0) {
            console.log('❌ No JSON files found. Please run fetchAndSaveProjects() first.');
            return null;
        }

        let allData = [];
        let allIncluded = [];
        let totalProjects = 0;

        for (const file of files) {
            const filepath = path.join(JSON_DATA_DIR, file);
            const fileData = JSON.parse(fs.readFileSync(filepath, 'utf8'));

            allData = allData.concat(fileData.data || []);
            allIncluded = allIncluded.concat(fileData.included || []);
            totalProjects += (fileData.data || []).length;

            console.log(`✅ Loaded ${(fileData.data || []).length} projects from ${file}`);
        }

        console.log(`🎉 Loaded ${totalProjects} projects from ${files.length} JSON files`);
        return { data: allData, included: allIncluded };
    } catch (error) {
        console.error('❌ Error loading projects from JSON files:', error.message);
        throw error;
    }
}

// Check if JSON data exists and is complete
function hasJsonData() {
    if (!fs.existsSync(JSON_DATA_DIR)) {
        return false;
    }

    const files = fs.readdirSync(JSON_DATA_DIR)
        .filter(file => file.startsWith('projects_page_') && file.endsWith('.json'));

    return files.length > 0;
}

// Resume function to continue from where it left off
async function resumeFetchAndSaveProjects() {
    console.log('🔄 Attempting to resume project fetch...');

    // Find the last successfully saved file
    const files = fs.readdirSync(JSON_DATA_DIR)
        .filter(file => file.startsWith('projects_page_') && file.endsWith('.json') && !file.includes('_partial'))
        .sort((a, b) => {
            const numA = parseInt(a.match(/projects_page_(\d+)\.json/)[1]);
            const numB = parseInt(b.match(/projects_page_(\d+)\.json/)[1]);
            return numB - numA; // Get the highest number
        });

    if (files.length === 0) {
        console.log('📥 No previous files found, starting fresh...');
        return await fetchAndSaveProjects();
    }

    const lastFile = files[0];
    const lastFileNumber = parseInt(lastFile.match(/projects_page_(\d+)\.json/)[1]);
    console.log(`📂 Found previous files, last file: ${lastFile}`);

    // Check if there are any partial files that need to be recovered
    const partialFiles = fs.readdirSync(JSON_DATA_DIR)
        .filter(file => file.startsWith('projects_page_') && file.includes('_partial'));

    if (partialFiles.length > 0) {
        console.log(`⚠️ Found ${partialFiles.length} partial files that need recovery`);
        // You could implement recovery logic here
    }

    console.log(`🔄 Resuming from where we left off...`);
    return await fetchAndSaveProjects();
}

// Fetch paragraph data
async function fetchParagraph(paragraphId, paragraphType) {
    const api = await getAuthenticatedApi();
    try {
        const response = await makeResilientApiCall(
            () => api.get(`/paragraph/${paragraphType}/${paragraphId}`),
            `Fetching paragraph ${paragraphId}`
        );
        return response.data;
    } catch (error) {
        console.error(`❌ Failed to fetch paragraph ${paragraphId}:`, error);
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
        drupal_uuid: drupalProject.id,
        title: attr.title || "",
        slug: attr.path?.alias?.replace("/project/", "") || "",
        status: attr.status ? "published" : "draft",
        body: attr.body?.processed || "",
        summary: attr.body?.summary || "",

        // Financial
        contract_value_usd: attr.field_contract_value_us_m_
            ? parseFloat(attr.field_contract_value_us_m_)
            : null,
        estimated_project_value_usd: attr.field_estimated_project_value_us
            ? parseFloat(attr.field_estimated_project_value_us)
            : null,
        revised_budget_value_usd: attr.field_revised_budget_value_us_m_
            ? parseFloat(attr.field_revised_budget_value_us_m_)
            : null,
        value_range: attr.field_value || "",

        // Dates
        project_launch_at: attr.field_project_launch || null,
        pq_issue_date: attr.field_pq_issue_date_eoi_issue_da || null,
        pq_document_submission_date: attr.field_pq_document_submission_dat || null,
        tender_advertised_at: attr.field_tender_advertised || null,
        main_contract_tender_issue_date:
            attr.field_main_contract_tender_issue || null,
        main_contract_bid_submission_date:
            attr.field_main_contract_bid_submissi || null,
        prequalification_consultant_date:
            attr.field_prequalification_of_consul || null,
        prequalification_contractor_date:
            attr.field_prequalification_of_contra || null,
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
        address: attr.field_address || "",
        location: attr.field_location_details || "",
        gps_coordinates: attr.field_gps_coordinates || "",
        map_iframe: attr.field_map_iframe?.processed || "",
        latitude: attr.field_location_geo?.[0]?.lat || null,
        longitude: attr.field_location_geo?.[0]?.lng || null,

        // Specifications
        specifications: attr.field_specifications || [],
        gross_floor_area_m2: attr.field_gross_floor_area_m2_
            ? parseFloat(attr.field_gross_floor_area_m2_)
            : null,
        total_built_up_area_m2: attr.field_total_built_up_area_m2_ || [],
        volume_concrete_m3: attr.field_volume_of_concrete_used_m3
            ? parseFloat(attr.field_volume_of_concrete_used_m3)
            : null,
        total_cement_bags: attr.field_total_number_of_cement_bag
            ? parseInt(attr.field_total_number_of_cement_bag)
            : null,
        total_steel_weight: attr.field_total_weight_of_steel_rods
            ? parseFloat(attr.field_total_weight_of_steel_rods)
            : null,
        total_cement_tonnage: attr.field_total_weight_tonnage_of_ce
            ? parseFloat(attr.field_total_weight_tonnage_of_ce)
            : null,
        cost_cement_per_ton: attr.field_cost_of_cement_per_ton_us_
            ? parseFloat(attr.field_cost_of_cement_per_ton_us_)
            : null,
        cost_steel_per_ton: attr.field_cost_of_steel_rods_per_ton
            ? parseFloat(attr.field_cost_of_steel_rods_per_ton)
            : null,
        airport_passengers_million: attr.field_airport_million_passengers || [],
        airport_terminal_area_m2: attr.field_airport_terminal_area_m2_ || [],
        pipeline_km: attr.field_pipeline_km_ || [],
        rail_km: attr.field_rail_kilometre_ || [],
        road_km: attr.field_road_kilometre_ || [],
        seaport_water_depth: attr.field_seaport_water_depth_met
            ? parseFloat(attr.field_seaport_water_depth_met)
            : null,

        // Status
        current_stage: attr.field_current_stage || "",
        moderation_state: attr.moderation_state || "",
        is_free_project: attr.field_free_projects || false,
        in_planning: attr.field_in_planning || false,
        under_construction: attr.field_under_construction || false,
        bid_evaluation: attr.field_bid_evaluation || "",
        call_for_eoi: attr.field_call_for_expression_of_int || "",

        // Contact
        phone: attr.field_phone || "",
        fax: attr.field_fax || "",
        email: attr.field_email || "",
        website: attr.field_website_project || "",
        facebook: attr.field_facebook || "",
        twitter: attr.field_twitter || "",
        linkedin: attr.field_linkedin || "",

        // Additional
        editor_notes: attr.field_editor?.[0]?.processed || "",
        transport: attr.field_transport || "",
        consultant: attr.field_consultant || "",
        main_contractor_note: attr.field_main_contractor_ || "",
        keywords: attr.metatag[2]?.attributes.content || "",
        meta_description: attr.metatag[1]?.attributes.content || "",

        date_created: attr.created || null,
        date_updated: attr.changed || null,
    };
}

// Create or update project in Directus
async function createOrUpdateProject(directus, projectData) {
    try {
        // Check if project exists by drupal_id
        const existingProjects = await directus.request(
            readItems("projects", {
                filter: { drupal_id: { _eq: projectData.drupal_id } },
                limit: 1,
            }),
        );

        if (existingProjects && existingProjects.length > 0) {
            console.log(
                `🔄 Project already exists: ${projectData.title} (ID: ${projectData.drupal_id})`,
            );
            return {
                success: true,
                action: "skipped",
                projectId: existingProjects[0].id,
            };
        } else {
            // Create new project
            const newProject = await directus.request(
                createItems("projects", projectData),
            );
            console.log(`✅ Created project: ${projectData.title}`);
            return { success: true, action: "created", projectId: newProject.id };
        }
    } catch (error) {
        const errorMessage = error.message || error;
        console.error(
            `❌ Error creating project ${projectData.title}: ${errorMessage}`,
        );
        fs.appendFileSync(
            "logs/migration_errors.log",
            `${new Date().toISOString()} - Project ${projectData.title} failed: ${errorMessage}\n`,
        );
        return { success: false, error: errorMessage };
    }
}

// Create project contacts
async function createProjectContacts(
    directus,
    drupalContacts,
    projectId,
    companyMapping,
) {
    const contacts = [];

    console.log("Creating project contact");

    if (!drupalContacts || drupalContacts.length === 0) return [];

    for (const contactRef of drupalContacts) {
        try {
            const contactResponse = await fetchParagraph(contactRef.id, "teams");
            if (!contactResponse) continue;

            const contactData = contactResponse.data;
            const attr = contactData.attributes || {};
            const rel = contactData.relationships || {};

            // Upload photo if exists
            let photoId = null;
            if (rel.field_photo?.data?.id) {
                photoId = await uploadImage(rel.field_photo.data.id, "contacts", true);
            }

            const contact = {
                id: contactData.id,
                drupal_id: attr.drupal_internal__id,
                drupal_uuid: contactData.id,
                name: attr.field_name || "",
                role: attr.field_role || "",
                email: attr.field_email || "",
                phone: attr.field_phone || "",
                facebook: attr.field_facebook || "",
                twitter: attr.field_twitter || "",
                linkedin: attr.field_linkedin || "",
                photo: photoId,
                project: projectId,
                status: "published",
            };

            const newContact = await directus.request(
                createItems("contacts", contact),
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
            const stageResponse = await fetchParagraph(stageRef.id, "stages");
            if (!stageResponse) continue;

            const stageData = stageResponse.data;
            const attr = stageData.attributes || {};
            const rel = stageData.relationships || {};

            const stage = {
                id: stageData.id,
                drupal_id: attr.drupal_internal__id,
                drupal_uuid: stageData.id,
                name: attr.field_stage_title || "",
                total_sub_stages: attr.field_total_sub_stages_count || 0,
                project: projectId,
                // status: 'published'
            };

            const newStage = await directus.request(
                createItems("project_stages", stage),
            );
            stages.push(newStage);
            console.log(`  ✅ Created stage: ${stage.title || "Untitled"}`);

            // Create stage details
            if (rel.field_stage?.data && Array.isArray(rel.field_stage.data)) {
                for (const detailRef of rel.field_stage.data) {
                    try {
                        const detailResponse = await fetchParagraph(detailRef.id, "stage");
                        if (!detailResponse) continue;

                        const detailData = detailResponse.data;
                        const detailAttr = detailData.attributes || {};

                        const detail = {
                            id: detailData.id,
                            drupal_id: detailAttr.drupal_internal__id,
                            drupal_uuid: detailData.id,
                            date: detailAttr.field_stage_date || null,
                            info: detailAttr.field_stage_info || "",
                            project_stage: newStage.id,
                            // status: 'published'
                        };

                        await directus.request(createItems("stages", detail));
                        console.log(`    ✅ Created stage detail`);
                    } catch (error) {
                        console.error(
                            `    ❌ Failed to create stage detail:`,
                            error.message,
                        );
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
            const newsResponse = await fetchParagraph(newsRef.id, "news_updates");
            if (!newsResponse) continue;

            const newsData = newsResponse.data;
            const attr = newsData.attributes || {};

            const news = {
                id: newsData.id,
                drupal_id: attr.drupal_internal__id,
                drupal_uuid: newsData.id,
                title: attr.field_event_type || "",
                content: attr.field_news?.processed || "",
                author: attr.field_author_new || "",
                date: attr.field_news_date || null,
                project: projectId,
                status: "published",
            };

            const newNews = await directus.request(createItems("news_updates", news));
            newsUpdates.push(newNews);
            console.log(`  ✅ Created news update: ${news.title}`);
        } catch (error) {
            console.error(`  ❌ Failed to create news update:`, error.message);
        }
    }

    return newsUpdates;
}

// Create project gallery
async function createProjectGallery(directus, drupalGallery, projectId) {
    const galleryItems = [];

    if (!drupalGallery || drupalGallery.length === 0) return [];

    let sortOrder = 1;
    for (const mediaRef of drupalGallery) {
        try {
            // Fetch the media entity to get the actual file reference
            const mediaEntity = await fetchMediaEntity(mediaRef.id, "image");
            if (!mediaEntity) {
                console.log(`  ⚠️  Could not fetch media entity: ${mediaRef.id}`);
                continue;
            }

            // Extract the file reference from field_media_image
            const fileRef = mediaEntity.relationships?.field_media_image?.data;
            if (!fileRef) {
                console.log(
                    `  ⚠️  No file reference found in media entity: ${mediaRef.id}`,
                );
                continue;
            }

            // Upload the actual file
            const imageId = await uploadImage(fileRef.id, "project_gallery", true);
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
                type: "image",
                name: mediaAttr.name || "",
                caption: fileMeta.title || "",
                alt_text: fileMeta.alt || "",
                file: imageId,
                project: projectId,
                sort: sortOrder++,
                status: "published",
            };

            const newMedia = await directus.request(
                createItems("media_gallery", mediaItem),
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
async function createCompanyRelationships(
    directus,
    project,
    relationships,
    companyMapping,
) {
    const createdRelations = [];

    for (const fieldName of COMPANY_RELATIONSHIP_FIELDS) {
        const relationshipData = relationships[fieldName]?.data;
        if (!relationshipData || relationshipData.length === 0) continue;

        let directusFieldName = fieldName.replace("field_", "");

        const junctionTable = `projects_${directusFieldName}`;

        for (const companyRef of relationshipData) {
            try {
                const relationData = {
                    projects_id: project.id,
                    companies_id: companyId,
                };

                await directus.request(createItems(junctionTable, relationData));
                createdRelations.push({ field: directusFieldName, companyId });
                console.log(`  ✅ Created ${directusFieldName} relationship`);
            } catch (error) {
                console.error(
                    `  ❌ Failed to create ${junctionTable} relationship:`,
                    error,
                );
            }
        }
    }

    return createdRelations;
}

// Create taxonomy relationships
async function createTaxonomyRelationships(
    directus,
    projectId,
    attr,
    taxonomyMapping,
) {
    const taxonomyRelations = [];

    // Countries
    if (attr.field_country && Array.isArray(attr.field_country)) {
        for (const countryCode of attr.field_country) {
            const countryId = taxonomyMapping.countries[countryCode];
            if (countryId) {
                taxonomyRelations.push({
                    collection: "projects_countries",
                    data: {
                        projects_id: projectId,
                        countries_id: countryId,
                    },
                });
            }
        }
    }

    // Regions
    if (attr.field_region && Array.isArray(attr.field_region)) {
        for (const regionCode of attr.field_region) {
            const regionId = taxonomyMapping.regions[regionCode];
            if (regionId) {
                taxonomyRelations.push({
                    collection: "projects_regions",
                    data: {
                        projects_id: projectId,
                        regions_id: regionId,
                    },
                });
            }
        }
    }

    // Sectors
    if (attr.field_sector && Array.isArray(attr.field_sector)) {
        for (const sectorCode of attr.field_sector) {
            const sectorId = taxonomyMapping.sectors[sectorCode];
            if (sectorId) {
                taxonomyRelations.push({
                    collection: "projects_sectors",
                    data: {
                        projects_id: projectId,
                        sectors_id: sectorId,
                    },
                });
            }
        }
    }

    // Project Types
    if (attr.field_type && Array.isArray(attr.field_type)) {
        for (const typeCode of attr.field_type) {
            const typeId = taxonomyMapping.projectTypes[typeCode];
            if (typeId) {
                taxonomyRelations.push({
                    collection: "projects_types",
                    data: {
                        projects_id: projectId,
                        types_id: typeId,
                    },
                });
            }
        }
    }

    for (const relation of taxonomyRelations) {
        try {
            await directus.request(createItems(relation.collection, relation.data));
        } catch (error) {
            console.error(`  ⚠️  Failed to create taxonomy relation:`, error);
        }
    }

    return taxonomyRelations;
}

// Main migration function - updated to use JSON data
async function migrateProjectsToDirectus(useJsonData = true) {
    console.log("\n🚀 Starting project migration process...\n");

    // Initialize Directus client
    let directus;
    try {
        directus = await getDirectus();
        console.log('✅ Directus client initialized');
    } catch (error) {
        console.error("❌ Failed to initialize Directus client:", error.message);
        fs.appendFileSync(
            "logs/migration_errors.log",
            `${new Date().toISOString()} - Directus initialization failed: ${error}\n`,
        );
        process.exit(1);
    }

    // Load company mapping
    const csvDir = path.join(__dirname, "../csv");
    let companyMapping = {};
    try {
        const mappingPath = path.join(csvDir, "company_mapping.json");
        if (fs.existsSync(mappingPath)) {
            companyMapping = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
            console.log(
                `✅ Loaded company mapping: ${Object.keys(companyMapping).length} companies`,
            );
        } else {
            console.warn(
                "⚠️  Company mapping not found. Run migrate-companies.js first!",
            );
            process.exit(1);
        }
    } catch (error) {
        console.error("❌ Failed to load company mapping:", error.message);
        process.exit(1);
    }

    // Load taxonomy mapping
    const taxonomyMapping = loadTaxonomyMapping();

    let projectsData;

    // Load data from JSON files or fetch from Drupal
    if (useJsonData && hasJsonData()) {
        console.log('📂 Using existing JSON data files...');
        projectsData = await loadProjectsFromJson();
        if (!projectsData) {
            console.log('❌ No JSON data found. Falling back to fetching from Drupal...');
            projectsData = await fetchAndSaveProjects();
        }
    } else {
        console.log('🌐 Fetching fresh data from Drupal...');
        projectsData = await fetchAndSaveProjects();
    }

    if (!projectsData || !projectsData.data || projectsData.data.length === 0) {
        console.error('❌ No project data available for migration');
        process.exit(1);
    }

    // Updated CSV headers to match ALL fields being saved to Directus
    const projectsCsvHeaders = [
        "id",
        "drupal_id",
        "drupal_uuid",
        "title",
        "slug",
        "status",
        "body",
        "summary",
        "contract_value_usd",
        "estimated_project_value_usd",
        "revised_budget_value_usd",
        "value_range",
        "project_launch_at",
        "pq_issue_date",
        "pq_document_submission_date",
        "tender_advertised_at",
        "main_contract_tender_issue_date",
        "main_contract_bid_submission_date",
        "prequalification_consultant_date",
        "prequalification_contractor_date",
        "consultant_awarded_at",
        "contract_awarded_at",
        "main_contract_award_date",
        "financial_close_date",
        "design_completion_date",
        "construction_start_date",
        "construction_completion_date",
        "estimated_completion_date",
        "study_completion_date",
        "commissioning_date",
        "handover_date",
        "completed_at",
        "in_operation",
        "cancelled_at",
        "address",
        "location",
        "gps_coordinates",
        "map_iframe",
        "latitude",
        "longitude",
        "specifications",
        "gross_floor_area_m2",
        "total_built_up_area_m2",
        "volume_concrete_m3",
        "total_cement_bags",
        "total_steel_weight",
        "total_cement_tonnage",
        "cost_cement_per_ton",
        "cost_steel_per_ton",
        "airport_passengers_million",
        "airport_terminal_area_m2",
        "pipeline_km",
        "rail_km",
        "road_km",
        "seaport_water_depth",
        "current_stage",
        "moderation_state",
        "is_free_project",
        "in_planning",
        "under_construction",
        "bid_evaluation",
        "call_for_eoi",
        "phone",
        "fax",
        "email",
        "website",
        "facebook",
        "twitter",
        "linkedin",
        "editor_notes",
        "transport",
        "consultant",
        "main_contractor_note",
        "date_created",
        "date_updated",
        "user_created",
        "published_by",
        "featured_image",
        "keywords",
        "meta_description",
        "migration_status",
        "migration_action",
    ];
    const projectsCsv = [projectsCsvHeaders.join(",")];

    const contactsCsvHeaders = [
        "id",
        "drupal_id",
        "drupal_uuid",
        "name",
        "role",
        "email",
        "phone",
        "facebook",
        "twitter",
        "linkedin",
        "photo",
        "project_id",
        "status",
        "migration_status",
    ];
    const contactsCsv = [contactsCsvHeaders.join(",")];

    const stagesCsvHeaders = [
        "id",
        "drupal_id",
        "drupal_uuid",
        "name",
        "total_sub_stages",
        "project_id",
        "migration_status",
    ];
    const stagesCsv = [stagesCsvHeaders.join(",")];

    const stageDetailsCsvHeaders = [
        "id",
        "drupal_id",
        "drupal_uuid",
        "date",
        "info",
        "project_stage_id",
        "migration_status",
    ];
    const stageDetailsCsv = [stageDetailsCsvHeaders.join(",")];

    const newsCsvHeaders = [
        "id",
        "drupal_id",
        "drupal_uuid",
        "title",
        "content",
        "author",
        "date",
        "project_id",
        "status",
        "migration_status",
    ];
    const newsCsv = [newsCsvHeaders.join(",")];

    const galleryCsvHeaders = [
        "id",
        "drupal_uuid",
        "type",
        "name",
        "caption",
        "alt_text",
        "file",
        "project",
        "sort",
        "status",
        "migration_status",
    ];
    const galleryCsv = [galleryCsvHeaders.join(",")];

    const relationshipsCsvHeaders = [
        "project_id",
        "field_name",
        "company_id",
        "migration_status",
    ];
    const relationshipsCsv = [relationshipsCsvHeaders.join(",")];

    console.log("\n🏗️  Processing projects...");
    let projectCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    let failedCount = 0;
    let contactsCount = 0;
    let stagesCount = 0;
    let stageDetailsCount = 0;
    let newsCount = 0;
    let galleryCount = 0;
    let relationshipsCount = 0;

    for (const project of projectsData.data) {
        let migrationStatus = "failed";
        let migrationAction = "none";
        let featuredImageId = null;

        try {
            const attr = project.attributes || {};
            const rel = project.relationships || {};

            // Transform project data
            const projectData = transformProject(project);

            // Upload listing image if exists
            if (rel.field_listing_image?.data?.id) {
                try {
                    featuredImageId = await uploadImage(
                        rel.field_listing_image.data.id,
                        "projects",
                        true,
                    );
                    projectData.featured_image = featuredImageId;
                } catch (error) {
                    console.error(`  ⚠️  Failed to upload listing image:`, error.message);
                }
            }



            const userId = await getUserId(directus, rel.uid?.data?.id);

            projectData.published_by = userId;
            projectData.user_created = userId;

            // Create or update project
            const result = await createOrUpdateProject(directus, projectData);

            if (result.success) {
                if (result.action === 'created') {
                    projectCount++;
                    createdCount++;
                    migrationStatus = "success";
                    migrationAction = "created";

                    // Create contacts
                    const contacts = await createProjectContacts(
                        directus,
                        rel.field_key_contacts?.data,
                        result.projectId,
                    );
                    contactsCount += contacts.length;

                    // Add contacts to CSV
                    for (const contact of contacts) {
                        contactsCsv.push(
                            [
                                contact.id,
                                contact.drupal_id || "",
                                contact.drupal_uuid || "",
                                escapeCsv(contact.name),
                                escapeCsv(contact.role),
                                escapeCsv(contact.email),
                                escapeCsv(contact.phone),
                                escapeCsv(contact.facebook),
                                escapeCsv(contact.twitter),
                                escapeCsv(contact.linkedin),
                                contact.photo || "",
                                result.projectId,
                                contact.status,
                                "success",
                            ].join(","),
                        );
                    }

                    // Create stages
                    const stages = await createProjectStages(
                        directus,
                        rel.field_stages?.data,
                        result.projectId,
                    );
                    stagesCount += stages.length;

                    // Add stages to CSV and track stage details
                    for (const stage of stages) {
                        stagesCsv.push(
                            [
                                stage.id,
                                stage.drupal_id || "",
                                stage.drupal_uuid || "",
                                escapeCsv(stage.name),
                                stage.total_sub_stages || 0,
                                result.projectId,
                                "success",
                            ].join(","),
                        );

                        // Note: Stage details are created within createProjectStages function
                        // You would need to modify createProjectStages to return stage details
                        // for proper CSV tracking
                    }

                    // Create news updates
                    const news = await createProjectNewsUpdates(
                        directus,
                        rel.field_news_updates_paragraph?.data,
                        result.projectId,
                    );
                    newsCount += news.length;

                    // Add news to CSV
                    for (const newsItem of news) {
                        newsCsv.push(
                            [
                                newsItem.id,
                                newsItem.drupal_id || "",
                                newsItem.drupal_uuid || "",
                                escapeCsv(newsItem.title),
                                escapeCsv(newsItem.content?.substring(0, 200) || ""),
                                escapeCsv(newsItem.author),
                                newsItem.date || "",
                                result.projectId,
                                newsItem.status,
                                "success",
                            ].join(","),
                        );
                    }

                    // Create gallery
                    const gallery = await createProjectGallery(
                        directus,
                        rel.field_gallery_?.data,
                        result.projectId,
                    );
                    galleryCount += gallery.length;

                    // Add gallery to CSV
                    for (const galleryItem of gallery) {
                        galleryCsv.push(
                            [
                                galleryItem.id,
                                galleryItem.drupal_uuid || "",
                                galleryItem.type,
                                escapeCsv(galleryItem.name),
                                escapeCsv(galleryItem.caption),
                                escapeCsv(galleryItem.alt_text),
                                galleryItem.file || "",
                                result.projectId,
                                galleryItem.sort || "",
                                galleryItem.status,
                                "success",
                            ].join(","),
                        );
                    }

                    // Create company relationships
                    const companyRelations = await createCompanyRelationships(
                        directus,
                        { id: result.projectId },
                        rel,
                        companyMapping,
                    );
                    relationshipsCount += companyRelations.length;

                    // Add relationships to CSV
                    for (const relation of companyRelations) {
                        relationshipsCsv.push(
                            [
                                result.projectId,
                                relation.field,
                                relation.companyId,
                                "success",
                            ].join(","),
                        );
                    }

                    // Create taxonomy relationships
                    await createTaxonomyRelationships(
                        directus,
                        result.projectId,
                        attr,
                        taxonomyMapping,
                    );

                } else if (result.action === 'skipped') {
                    skippedCount++;
                    migrationStatus = 'skipped';
                    migrationAction = 'skipped';
                }
            } else {
                failedCount++;
                migrationStatus = "failed";
                migrationAction = "error";
            }

            // Add to CSV backup - include ALL fields from transformProject
            projectsCsv.push(
                [
                    project.id,
                    projectData.drupal_id || "",
                    escapeCsv(projectData.drupal_uuid),
                    escapeCsv(projectData.title),
                    escapeCsv(projectData.slug),
                    projectData.status,
                    escapeCsv(projectData.body || ""),
                    escapeCsv(projectData.summary || ""),
                    projectData.contract_value_usd || "",
                    projectData.estimated_project_value_usd || "",
                    projectData.revised_budget_value_usd || "",
                    escapeCsv(projectData.value_range),
                    projectData.project_launch_at || "",
                    projectData.pq_issue_date || "",
                    projectData.pq_document_submission_date || "",
                    projectData.tender_advertised_at || "",
                    projectData.main_contract_tender_issue_date || "",
                    projectData.main_contract_bid_submission_date || "",
                    projectData.prequalification_consultant_date || "",
                    projectData.prequalification_contractor_date || "",
                    projectData.consultant_awarded_at || "",
                    projectData.contract_awarded_at || "",
                    projectData.main_contract_award_date || "",
                    projectData.financial_close_date || "",
                    projectData.design_completion_date || "",
                    projectData.construction_start_date || "",
                    projectData.construction_completion_date || "",
                    projectData.estimated_completion_date || "",
                    projectData.study_completion_date || "",
                    projectData.commissioning_date || "",
                    projectData.handover_date || "",
                    projectData.completed_at || "",
                    projectData.in_operation || "",
                    projectData.cancelled_at || "",
                    escapeCsv(projectData.address),
                    escapeCsv(projectData.location || ""),
                    escapeCsv(projectData.gps_coordinates),
                    escapeCsv(projectData.map_iframe || ""),
                    projectData.latitude || "",
                    projectData.longitude || "",
                    escapeCsv(JSON.stringify(projectData.specifications)),
                    projectData.gross_floor_area_m2 || "",
                    escapeCsv(JSON.stringify(projectData.total_built_up_area_m2)),
                    projectData.volume_concrete_m3 || "",
                    projectData.total_cement_bags || "",
                    projectData.total_steel_weight || "",
                    projectData.total_cement_tonnage || "",
                    projectData.cost_cement_per_ton || "",
                    projectData.cost_steel_per_ton || "",
                    escapeCsv(JSON.stringify(projectData.airport_passengers_million)),
                    escapeCsv(JSON.stringify(projectData.airport_terminal_area_m2)),
                    escapeCsv(JSON.stringify(projectData.pipeline_km)),
                    escapeCsv(JSON.stringify(projectData.rail_km)),
                    escapeCsv(JSON.stringify(projectData.road_km)),
                    projectData.seaport_water_depth || "",
                    escapeCsv(projectData.current_stage),
                    escapeCsv(projectData.moderation_state),
                    projectData.is_free_project ? "true" : "false",
                    projectData.in_planning ? "true" : "false",
                    projectData.under_construction ? "true" : "false",
                    escapeCsv(projectData.bid_evaluation),
                    escapeCsv(projectData.call_for_eoi),
                    escapeCsv(projectData.phone),
                    escapeCsv(projectData.fax),
                    escapeCsv(projectData.email),
                    escapeCsv(projectData.website),
                    escapeCsv(projectData.facebook),
                    escapeCsv(projectData.twitter),
                    escapeCsv(projectData.linkedin),
                    escapeCsv(projectData.editor_notes || ""),
                    escapeCsv(projectData.transport),
                    escapeCsv(projectData.consultant),
                    escapeCsv(projectData.main_contractor_note),
                    projectData.date_created || "",
                    projectData.date_updated || "",
                    projectData.user_created || "",
                    projectData.published_by || "",
                    featuredImageId || "",
                    projectData.keywords || "",
                    projectData.meta_description || "",
                    migrationStatus,
                    migrationAction,
                ].join(","),
            );

            if (projectCount % 20 === 0 && projectCount > 0) {
                console.log(`  Processed ${projectCount} projects...`);
            }
        } catch (error) {
            console.error(
                `❌ Error processing project ${project.id}:`,
                error.message,
            );
            failedCount++;

            const attr = project.attributes || {};
            projectsCsv.push(
                [
                    project.id,
                    attr.drupal_internal__nid || "",
                    escapeCsv(project.id),
                    escapeCsv(attr.title || ""),
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "failed",
                    "exception",
                ].join(","),
            );

            if (!fs.existsSync("logs")) fs.mkdirSync("logs");
            fs.appendFileSync(
                "logs/migration_errors.log",
                `Project ${project.id} (${attr.title}) processing failed: ${error.message}\n${error.stack}\n`,
            );
        }
    }

    // Write CSV files
    console.log("\n💾 Writing CSV backup files...");
    fs.writeFileSync(
        path.join(csvDir, "projects_migration_backup.csv"),
        projectsCsv.join("\n"),
        "utf8",
    );
    fs.writeFileSync(
        path.join(csvDir, "project_contacts_backup.csv"),
        contactsCsv.join("\n"),
        "utf8",
    );
    fs.writeFileSync(
        path.join(csvDir, "project_stages_backup.csv"),
        stagesCsv.join("\n"),
        "utf8",
    );
    fs.writeFileSync(
        path.join(csvDir, "project_stage_details_backup.csv"),
        stageDetailsCsv.join("\n"),
        "utf8",
    );
    fs.writeFileSync(
        path.join(csvDir, "project_news_backup.csv"),
        newsCsv.join("\n"),
        "utf8",
    );
    fs.writeFileSync(
        path.join(csvDir, "project_gallery_backup.csv"),
        galleryCsv.join("\n"),
        "utf8",
    );
    fs.writeFileSync(
        path.join(csvDir, "project_company_relationships_backup.csv"),
        relationshipsCsv.join("\n"),
        "utf8",
    );

    // Generate migration summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 PROJECT MIGRATION SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Projects created: ${createdCount}`);
    console.log(`⏭️  Projects skipped: ${skippedCount}`);
    console.log(`❌ Projects failed: ${failedCount}`);
    console.log(`👥 Contacts created: ${contactsCount}`);
    console.log(`📅 Stages created: ${stagesCount}`);
    console.log(`📋 Stage details created: ${stageDetailsCount}`);
    console.log(`📰 News updates created: ${newsCount}`);
    console.log(`🖼️  Gallery items created: ${galleryCount}`);
    console.log(`🔗 Company relationships created: ${relationshipsCount}`);
    console.log("=".repeat(60));
    console.log("\n📁 Backup files generated:");
    console.log(`   • JSON data files in: ${JSON_DATA_DIR}`);
    console.log(`   • CSV files in: ${csvDir}`);
    if (failedCount > 0) {
        console.log(`\n📜 Check logs/migration_errors.log for details`);
    }
    console.log("\n⚠️  IMPORTANT NOTES:");
    console.log("   • Project data saved to JSON files for future migrations");
    console.log("   • Run with useJsonData=false to fetch fresh data from Drupal");
    console.log("   • Project UUIDs from Drupal are preserved as Directus IDs");
    console.log("   • All company relationships have been created in junction tables");
    console.log("   • Project stages and stage details have been migrated");
    console.log("   • Gallery images have been uploaded and linked");
    console.log("   • Taxonomy relationships (countries, regions, sectors) created");
    console.log("   • This script must be run AFTER migrate-companies.js");
    console.log("   • All CSV fields now match Directus database fields");
    console.log("=".repeat(60) + "\n");
}

// Export functions for individual use
module.exports = {
    fetchAndSaveProjects,
    loadProjectsFromJson,
    hasJsonData,
    resumeFetchAndSaveProjects,
    migrateProjectsToDirectus
};

// Run the migration if called directly
if (require.main === module) {
    const useJsonData = process.argv.includes('--use-json') || process.argv.includes('-j');

    migrateProjectsToDirectus(useJsonData).catch((error) => {
        console.error("\n❌ MIGRATION FAILED:", error.message);
        console.error(error.stack);
        if (!fs.existsSync("logs")) fs.mkdirSync("logs");
        fs.appendFileSync(
            "logs/migration_errors.log",
            `\n\n=== PROJECT MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`,
        );
        process.exit(1);
    });
}
