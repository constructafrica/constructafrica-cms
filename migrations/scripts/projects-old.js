require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { escapeCsv, formatDateTimeForCsv } = require('../helpers/index');
const { uploadImage } = require('../helpers/upload-image');

// Fetch all projects from Drupal with pagination
async function fetchProjects() {
    const api = await getAuthenticatedApi(true);
    let allData = [];
    let includedData = [];
    let nextUrl = '/node/projects';
    let page = 1;

    const params = {
        'fields[node--projects]': 'drupal_internal__nid,title,body,status,created,changed,moderation_state,field_contract_value_us_m_,field_current_stage,field_pq_document_submission_dat,field_pq_issue_date_eoi_issue_da,field_country,field_region,field_sector,field_type',
        'include': 'field_listing_image,field_gallery_,field_key_contacts,field_news_updates_paragraph,field_stages,field_client_owner,field_developer,field_main_contractor,field_funding,uid',
        'page[limit]': 100,
    };

    try {
        console.log('📥 Fetching all projects...');
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

            const publishedCount = records.filter(r => r.attributes.moderation_state === 'published').length;
            console.log(`✅ Page ${page}: ${records.length} records (${publishedCount} published)`);

            if (response.data.links?.next?.href) {
                nextUrl = response.data.links.next.href.replace(api.defaults.baseURL, '');
                page++;
            } else {
                nextUrl = null;
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log(`🎉 Fetched ${allData.length} projects across ${page - 1} pages`);

        return {
            data: allData,
            included: includedData
        };
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

// Get listing image ID
async function getListingImageId(fileId, included) {
    if (!fileId) return '';
    try {
        const directusFileId = await uploadImage(fileId, 'projects');
        return directusFileId || '';
    } catch (error) {
        console.error(`❌ Failed to upload listing image for file ${fileId}:`, error.message);
        return '';
    }
}

// Get gallery images
async function getGalleryImages(galleryData, included) {
    if (!galleryData || !Array.isArray(galleryData)) return [];

    const galleryImages = [];
    for (const galleryItem of galleryData) {
        const imageId = galleryItem.meta.drupal_internal__target_id;
        const image = included.find(item => item.type === 'media--image' && item.attributes.drupal_internal__mid === imageId);
        if (image) {
            const fileId = image.relationships.field_media_image?.data?.id;
            const directusFileId = await uploadImage(fileId, 'projects_gallery');
            galleryImages.push(directusFileId);
        }
    }
    return galleryImages;
}

// Get company ID (assuming companies migrated with drupal_uuid)
async function getCompanyId(companyId, included) {
    if (!companyId) return '';
    const company = included.find(item => item.type === 'node--company' && item.id === companyId);
    return company ? company.id : ''; // Use Drupal UUID as Directus ID
}

// Get paragraph data
function getParagraphData(paragraphData, included, type) {
    if (!paragraphData || !Array.isArray(paragraphData)) return [];

    const paragraphs = [];
    for (const para of paragraphData) {
        const paraItem = included.find(item => item.type === `paragraph--${type}` && item.id === para.id);
        if (paraItem) {
            paragraphs.push({
                id: uuidv4(),
                project_id: '', // To be set later
                title: paraItem.attributes.field_title || '',
                description: paraItem.attributes.field_description?.processed || '',
                date: paraItem.attributes.field_date || null
            });
        }
    }
    return paragraphs;
}

// Generate CSVs for projects, revisions, updates, stages, contacts
async function generateProjectsCsv() {
    const projectsData = await fetchProjects();

    const csvDir = path.join(__dirname, '../csv');
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    // Projects CSV
    const projectsOutputPath = path.join(csvDir, 'projects.csv');
    const projectsCsvHeaders = [
        'id',
        'drupal_nid',
        'drupal_uuid',
        'title',
        'slug',
        'description',
        'summary',
        'status',
        'moderation_state',
        'featured_image',
        'contract_value_usd',
        'current_stage',
        'pq_document_submission_date',
        'pq_issue_date',
        'country',
        'region',
        'sector',
        'type',
        'created_by',
        'published_by',
        'date_created',
        'date_updated',
        'client_owner_id',

    ];

    // 'gallery',
    // 'developer',
    //         'main_contractor',
    //         'funding',
    const projectsCsv = [projectsCsvHeaders.join(',')];

    // Revisions CSV
    const revisionsOutputPath = path.join(csvDir, 'project_revisions.csv');
    const revisionsCsvHeaders = ['id', 'project_id', 'revision_number', 'moderation_state', 'changed_by', 'date_changed', 'notes'];
    const revisionsCsv = [revisionsCsvHeaders.join(',')];

    // Updates CSV
    const updatesOutputPath = path.join(csvDir, 'project_updates.csv');
    const updatesCsvHeaders = ['id', 'project_id', 'title', 'description', 'date'];
    const updatesCsv = [updatesCsvHeaders.join(',')];

    // Stages CSV
    const stagesOutputPath = path.join(csvDir, 'project_stages.csv');
    const stagesCsvHeaders = ['id', 'project_id', 'stage_name', 'description', 'start_date', 'end_date'];
    const stagesCsv = [stagesCsvHeaders.join(',')];

    // Contacts CSV
    const contactsOutputPath = path.join(csvDir, 'project_contacts.csv');
    const contactsCsvHeaders = ['id', 'project_id', 'name', 'role', 'email', 'phone', 'company'];
    const contactsCsv = [contactsCsvHeaders.join(',')];

    for (const project of projectsData.data) {
        try {
            const attributes = project.attributes || {};
            const relationships = project.relationships || {};

            const directusId = uuidv4();
            const listingImageId = await getListingImageId(relationships.field_listing_image?.data?.id, projectsData.included);
            const galleryImages = await getGalleryImages(relationships.field_gallery_?.data, projectsData.included);
            const clientOwner = getCompanyId(relationships.field_client_owner?.data?.id, projectsData.included);
            const developer = getCompanyId(relationships.field_developer?.data?.id, projectsData.included);
            const mainContractor = getCompanyId(relationships.field_main_contractor?.data?.id, projectsData.included);
            const funding = getCompanyId(relationships.field_funding?.data?.id, projectsData.included);
            const writerId = getUserId(relationships.uid?.data?.id, projectsData.included);
            const publisherId = attributes.moderation_state === 'published' ? DEFAULT_ADMIN_USER : '';
            const slug = attributes.title ? attributes.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : `project-${directusId}`;

            // Projects CSV row
            projectsCsv.push([
                directusId,
                attributes.drupal_internal__nid || '',
                project.id || '',
                escapeCsv(attributes.title || ''),
                escapeCsv(slug),
                escapeCsv(attributes.body?.processed || ''),
                escapeCsv(attributes.body?.summary || ''),
                attributes.status ? 'published' : 'draft',
                escapeCsv(attributes.moderation_state || ''),
                escapeCsv(listingImageId),
                escapeCsv(attributes.field_contract_value_us_m_ || ''),
                escapeCsv(attributes.field_current_stage || ''),
                formatDateTimeForCsv(attributes.field_pq_document_submission_dat || ''),
                formatDateTimeForCsv(attributes.field_pq_issue_date_eoi_issue_da || ''),
                escapeCsv(attributes.field_country?.join(',') || ''),
                escapeCsv(attributes.field_region?.join(',') || ''),
                escapeCsv(attributes.field_sector?.join(',') || ''),
                escapeCsv(attributes.field_type?.join(',') || ''),
                escapeCsv(writerId),
                escapeCsv(publisherId),
                formatDateTimeForCsv(attributes.created || ''),
                formatDateTimeForCsv(attributes.changed || '')
            ].join(','));

            // Revisions CSV
            const revisions = await fetchProjectRevisions(project.id);
            revisions.forEach((revision, index) => {
                revisionsCsv.push([
                    uuidv4(),
                    directusId,
                    index + 1,
                    escapeCsv(revision.attributes.moderation_state || ''),
                    escapeCsv(getUserId(revision.relationships.uid?.data?.id, projectsData.included)),
                    formatDateTimeForCsv(revision.attributes.changed || ''),
                    escapeCsv('') // Notes not available
                ].join(','));
            });

            // Updates CSV
            const updates = getParagraphData(relationships.field_news_updates_paragraph?.data, projectsData.included, 'news_updates');
            updates.forEach(update => {
                update.project_id = directusId;
                updatesCsv.push([
                    uuidv4(),
                    directusId,
                    escapeCsv(update.title),
                    escapeCsv(update.description),
                    formatDateTimeForCsv(update.date)
                ].join(','));
            });

            // Stages CSV
            const stages = getParagraphData(relationships.field_stages?.data, projectsData.included, 'stages');
            stages.forEach(stage => {
                stage.project_id = directusId;
                stagesCsv.push([
                    uuidv4(),
                    directusId,
                    escapeCsv(stage.stage_name),
                    escapeCsv(stage.description),
                    formatDateTimeForCsv(stage.start_date),
                    formatDateTimeForCsv(stage.end_date)
                ].join(','));
            });

            // Contacts CSV
            const contacts = getParagraphData(relationships.field_key_contacts?.data, projectsData.included, 'teams');
            contacts.forEach(contact => {
                contact.project_id = directusId;
                contactsCsv.push([
                    uuidv4(),
                    directusId,
                    escapeCsv(contact.name),
                    escapeCsv(contact.role),
                    escapeCsv(contact.email),
                    escapeCsv(contact.phone),
                    escapeCsv(contact.company)
                ].join(','));
            });
        } catch (error) {
            console.error(`❌ Error processing project ${project.id}:`, error.message);
            fs.appendFileSync('logs/migration_errors.log', `Project ${project.id} processing failed: ${error.message}\n`);
        }
    }

    fs.writeFileSync(projectsOutputPath, projectsCsv.join('\n'), 'utf8');
    fs.writeFileSync(revisionsOutputPath, revisionsCsv.join('\n'), 'utf8');
    fs.writeFileSync(updatesOutputPath, updatesCsv.join('\n'), 'utf8');
    fs.writeFileSync(stagesOutputPath, stagesCsv.join('\n'), 'utf8');
    fs.writeFileSync(contactsOutputPath, contactsCsv.join('\n'), 'utf8');

    const publishedCount = projectsData.data.filter(e => e.attributes.moderation_state === 'published').length;
    console.log(`✅ Projects CSV generated with ${projectsData.data.length} projects (${publishedCount} published): ${projectsOutputPath}`);
    console.log(`✅ Revisions CSV generated: ${revisionsOutputPath}`);
    console.log(`✅ Updates CSV generated: ${updatesOutputPath}`);
    console.log(`✅ Stages CSV generated: ${stagesOutputPath}`);
    console.log(`✅ Contacts CSV generated: ${contactsOutputPath}`);
}

// Run the migration
generateProjectsCsv().catch((error) => {
    console.error('❌ Projects CSV generation failed:', error.message);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync('logs/migration_errors.log', `Projects migration failed: ${error.message}\n`);
    process.exit(1);
});