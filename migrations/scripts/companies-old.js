require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { escapeCsv, formatDateTimeForCsv } = require('../helpers/index');
const { uploadImage } = require('../helpers/upload-image');

// Fetch all companies from Drupal with pagination
async function fetchCompanies() {
    const api = await getAuthenticatedApi();
    let allData = [];
    let includedData = [];
    let nextUrl = '/jsonapi/node/company';
    let page = 1;

    const params = {
        'fields[node--company]': 'drupal_internal__nid,title,body,moderation_state,status,created,changed,field_email,field_phone,field_location_details,field_website,field_linkedin,field_country,field_region,field_sector,field_type,field_headquater,field_free_company',
        'include': 'field_logo,field_gallery,field_key_contacts_companies,field_team,field_projects,uid',
        'page[limit]': 100,
    };

    try {
        console.log('📥 Fetching all companies...');
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

        console.log(`🎉 Fetched ${allData.length} companies across ${page - 1} pages`);

        return {
            data: allData,
            included: includedData
        };
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

// Fetch revisions for a company
async function fetchCompanyRevisions(companyId) {
    const api = await getAuthenticatedApi();
    let allRevisions = [];
    let nextUrl = `/node/company/${companyId}/revisions`;
    let page = 1;

    try {
        while (nextUrl) {
            const response = await api.get(nextUrl, {
                params: { 'page[limit]': 100 }
            });

            allRevisions = allRevisions.concat(response.data.data || []);
            nextUrl = response.data.links?.next?.href?.replace(api.defaults.baseURL, '') || null;
            page++;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return allRevisions;
    } catch (error) {
        console.error(`❌ Failed to fetch revisions for company ${companyId}:`, error.message);
        return [];
    }
}

// Get logo image ID
async function getLogoImageId(fileId, included) {
    if (!fileId) return '';
    try {
        const directusFileId = await uploadImage(fileId, 'companies');
        return directusFileId || '';
    } catch (error) {
        console.error(`❌ Failed to upload logo image for file ${fileId}:`, error.message);
        return '';
    }
}

// Get gallery images
async function getGalleryImages(galleryData, included) {
    if (!galleryData || !galleryData.id) return [];

    const galleryImages = [];
    const gallery = included.find(item => item.type === 'media--gallery' && item.id === galleryData.id);
    if (gallery) {
        const fileId = gallery.relationships.field_media_image?.data?.id;
        if (fileId) {
            const directusFileId = await uploadImage(fileId, 'company_galleries');
            galleryImages.push(directusFileId);
        }
    }
    return galleryImages;
}

// Get project IDs
function getProjectIds(projectData, included) {
    if (!projectData || !Array.isArray(projectData)) return [];

    const projectIds = [];
    for (const project of projectData) {
        const projectItem = included.find(item => item.type === 'node--projects' && item.id === project.id);
        if (projectItem) {
            projectIds.push(projectItem.id); // Use Drupal UUID as Directus ID
        }
    }
    return projectIds;
}

// Get paragraph data for contacts
function getParagraphData(paragraphData, included, type) {
    if (!paragraphData || !Array.isArray(paragraphData)) return [];

    const paragraphs = [];
    for (const para of paragraphData) {
        const paraItem = included.find(item => item.type === `paragraph--${type}` && item.id === para.id);
        if (paraItem) {
            paragraphs.push({
                id: uuidv4(),
                company_id: '', // To be set later
                name: paraItem.attributes.field_name || '',
                role: paraItem.attributes.field_role || '',
                email: paraItem.attributes.field_email || '',
                phone: paraItem.attributes.field_phone || ''
            });
        }
    }
    return paragraphs;
}

// Generate CSVs for companies, revisions, contacts, galleries
async function generateCompaniesCsv() {
    const companiesData = await fetchCompanies();

    const csvDir = path.join(__dirname, '../csv');
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    // Companies CSV
    const companiesOutputPath = path.join(csvDir, 'companies.csv');
    const companiesCsvHeaders = [
        'id',
        'drupal_nid',
        'drupal_uuid',
        'title',
        'slug',
        'description',
        'status',
        'moderation_state',
        'logo',
        'email',
        'phone',
        'location_details',
        'website',
        'linkedin',
        'country',
        'region',
        'sector',
        'type',
        'headquarters',
        'free_company',
        'writer_id',
        'publisher_id',
        'date_created',
        'date_updated'
    ];
    const companiesCsv = [companiesCsvHeaders.join(',')];

    // Revisions CSV
    const revisionsOutputPath = path.join(csvDir, 'company_revisions.csv');
    const revisionsCsvHeaders = ['id', 'company_id', 'revision_number', 'moderation_state', 'changed_by', 'date_changed', 'notes'];
    const revisionsCsv = [revisionsCsvHeaders.join(',')];

    // Contacts CSV
    const contactsOutputPath = path.join(csvDir, 'company_contacts.csv');
    const contactsCsvHeaders = ['id', 'company_id', 'name', 'role', 'email', 'phone'];
    const contactsCsv = [contactsCsvHeaders.join(',')];

    // Galleries CSV
    const galleriesOutputPath = path.join(csvDir, 'company_galleries.csv');
    const galleriesCsvHeaders = ['id', 'company_id', 'file_id'];
    const galleriesCsv = [galleriesCsvHeaders.join(',')];

    for (const company of companiesData.data) {
        try {
            const attributes = company.attributes || {};
            const relationships = company.relationships || {};

            const directusId = uuidv4();
            const logoImageId = await getLogoImageId(relationships.field_logo?.data?.id, companiesData.included);
            const galleryImages = await getGalleryImages(relationships.field_gallery?.data, companiesData.included);
            const projectIds = getProjectIds(relationships.field_projects?.data, companiesData.included);
            const writerId = relationships.uid?.data?.id || '';
            const publisherId = attributes.moderation_state === 'published' ? DEFAULT_ADMIN_USER : '';
            const slug = attributes.title ? attributes.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : `company-${directusId}`;

            // Companies CSV row
            companiesCsv.push([
                directusId,
                attributes.drupal_internal__nid || '',
                company.id || '',
                escapeCsv(attributes.title || ''),
                escapeCsv(slug),
                escapeCsv(attributes.body?.processed || ''),
                attributes.status ? 'published' : 'draft',
                escapeCsv(attributes.moderation_state || ''),
                escapeCsv(logoImageId),
                escapeCsv(attributes.field_email || ''),
                escapeCsv(attributes.field_phone || ''),
                escapeCsv(attributes.field_location_details?.processed || ''),
                escapeCsv(attributes.field_website || ''),
                escapeCsv(attributes.field_linkedin || ''),
                escapeCsv(attributes.field_country?.join(',') || ''),
                escapeCsv(attributes.field_region?.join(',') || ''),
                escapeCsv(attributes.field_sector?.join(',') || ''),
                escapeCsv(attributes.field_type?.join(',') || ''),
                escapeCsv(attributes.field_headquater || ''),
                attributes.field_free_company ? 'true' : 'false',
                escapeCsv(writerId),
                escapeCsv(publisherId),
                formatDateTimeForCsv(attributes.created || ''),
                formatDateTimeForCsv(attributes.changed || '')
            ].join(','));

            // Revisions CSV
            const revisions = await fetchCompanyRevisions(company.id);
            revisions.forEach((revision, index) => {
                revisionsCsv.push([
                    uuidv4(),
                    directusId,
                    index + 1,
                    escapeCsv(revision.attributes.moderation_state || ''),
                    escapeCsv(revision.relationships.uid?.data?.id || ''),
                    formatDateTimeForCsv(revision.attributes.changed || ''),
                    escapeCsv('') // Notes not available
                ].join(','));
            });

            // Contacts CSV (merge field_key_contacts_companies and field_team)
            const keyContacts = getParagraphData(relationships.field_key_contacts_companies?.data, companiesData.included, 'teams');
            const teamContacts = getParagraphData(relationships.field_team?.data, companiesData.included, 'teams');
            const allContacts = [...keyContacts, ...teamContacts];
            allContacts.forEach(contact => {
                contact.company_id = directusId;
                contactsCsv.push([
                    uuidv4(),
                    directusId,
                    escapeCsv(contact.name),
                    escapeCsv(contact.role),
                    escapeCsv(contact.email),
                    escapeCsv(contact.phone)
                ].join(','));
            });

            // Galleries CSV
            galleryImages.forEach(fileId => {
                galleriesCsv.push([
                    uuidv4(),
                    directusId,
                    fileId
                ].join(','));
            });

        } catch (error) {
            console.error(`❌ Error processing company ${company.id}:`, error.message);
            fs.appendFileSync('logs/migration_errors.log', `Company ${company.id} processing failed: ${error.message}\n`);
        }
    }

    fs.writeFileSync(companiesOutputPath, companiesCsv.join('\n'), 'utf8');
    fs.writeFileSync(revisionsOutputPath, revisionsCsv.join('\n'), 'utf8');
    fs.writeFileSync(contactsOutputPath, contactsCsv.join('\n'), 'utf8');
    fs.writeFileSync(galleriesOutputPath, galleriesCsv.join('\n'), 'utf8');

    const publishedCount = companiesData.data.filter(e => e.attributes.moderation_state === 'published').length;
    console.log(`✅ Companies CSV generated with ${companiesData.data.length} companies (${publishedCount} published): ${companiesOutputPath}`);
    console.log(`✅ Revisions CSV generated: ${revisionsOutputPath}`);
    console.log(`✅ Contacts CSV generated: ${contactsOutputPath}`);
    console.log(`✅ Galleries CSV generated: ${galleriesOutputPath}`);
}

// Run the migration
generateCompaniesCsv().catch((error) => {
    console.error('❌ Companies CSV generation failed:', error.message);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync('logs/migration_errors.log', `Companies migration failed: ${error.message}\n`);
    process.exit(1);
});