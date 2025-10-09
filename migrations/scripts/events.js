require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getAuthenticatedApi, resetAuth } = require('../helpers/auth');
const { escapeCsv, formatDateTimeForCsv } = require('../helpers/index');
const {uploadImage} = require("../helpers/upload-image");

const DEFAULT_ADMIN_USER = process.env.DEFAULT_ADMIN_USER;

// Fetch ALL events from Drupal with pagination
async function fetchEvents() {
    const api = await getAuthenticatedApi();
    let allData = [];
    let includedData = [];
    let nextUrl = "/node/events";
    let page = 1;

    const params = {
        "page[limit]": 100,
    };

    try {
        console.log("📥 Fetching ALL events (including unpublished)...");
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

            const publishedCount = records.filter(r => r.attributes.status).length;
            const unpublishedCount = records.length - publishedCount;
            console.log(`✅ Page ${page}: ${records.length} records (${publishedCount} published, ${unpublishedCount} unpublished)`);

            if (response.data.links?.next?.href) {
                nextUrl = response.data.links.next.href.replace(api.defaults.baseURL, '');
                page++;
            } else {
                nextUrl = null;
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        const totalPublished = allData.filter(r => r.attributes.status).length;
        const totalUnpublished = allData.length - totalPublished;
        console.log(`🎉 Fetched all ${allData.length} events: ${totalPublished} published, ${totalUnpublished} unpublished across ${page} pages`);

        return {
            data: allData,
            included: includedData
        };
    } catch (error) {
        console.error("❌ Fetch failed on page", page, ":", error.response?.status, error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token might be expired, resetting authentication...');
            resetAuth();
        }
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync("logs/fetch_errors.log", `Events fetch failed on page ${page}: ${error.message}\n`);
        throw error;
    }
}

// Map Drupal file ID to Directus file ID (placeholder for now)
async function getFeaturedImageId(fileUuid) {
    if (!fileUuid) return '';
    console.log("file: ", fileUuid)
    let imageId = '';
    imageId = await uploadImage(fileUuid, 'events');
    return imageId || '';
}

// Generate CSV from fetched Drupal events
async function generateEventsCsv() {
    const eventsData = await fetchEvents();

    const csvDir = path.join(__dirname, "..", "csv");
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    const outputPath = path.join(csvDir, "events.csv");

    const csvHeaders = [
        "id",
        "drupal_nid",
        "status",
        "title",
        "slug",
        "description",
        "summary",
        "event_type",
        "start_date",
        "end_date",
        "country",
        "city",
        "state",
        "venue_address",
        "registration_required",
        "registration_deadline",
        "is_online",
        "contact_number",
        "contact_email",
        "event_website",
        "event_website_label",
        "featured_image",
        "created_by",
        "date_created",
        "date_updated",
        "moderation_state",
        "drupal_path"
    ];

    const csv = [csvHeaders.join(',')];

    for (const event of eventsData.data) {
        try {
            const attributes = event.attributes || {};
            const relationships = event.relationships || {};

            const directusId = uuidv4();
            const featuredImageId = await getFeaturedImageId(relationships.field_event_photo?.data?.id);
            const eventTypeId = relationships.field_event_type?.data?.id;
            const registrationRequired = attributes.field_registration_close_date ? 'true' : 'false';
            const slug = attributes.title ? attributes.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : 'event-' + directusId;

            csv.push([
                event.id,
                attributes.drupal_internal__nid || '',
                attributes.status ? 'published' : 'draft',
                escapeCsv(attributes.title || ''),
                escapeCsv(slug),
                escapeCsv(attributes.body?.processed || ''),
                escapeCsv(attributes.body?.summary || ''),
                escapeCsv(eventTypeId),
                formatDateTimeForCsv(attributes.field_event_date?.value || ''),
                formatDateTimeForCsv(attributes.field_event_date?.end_value || ''),
                escapeCsv(attributes.field_event_venue?.country_code || ''),
                escapeCsv(attributes.field_event_venue?.locality || ''),
                escapeCsv(attributes.field_event_venue?.administrative_area || ''),
                escapeCsv(attributes.field_event_venue?.address_line1 || ''),
                registrationRequired,
                formatDateTimeForCsv(attributes.field_registration_close_date || ''),
                attributes.field_online_event ? 'true' : 'false',
                escapeCsv(attributes.field_contact_number || ''),
                escapeCsv(attributes.field_event_email || ''),
                escapeCsv(attributes.field_event_link?.uri || ''),
                escapeCsv(attributes.field_event_link?.title || ''),
                escapeCsv(featuredImageId),
                escapeCsv(relationships?.uid?.data?.id || DEFAULT_ADMIN_USER || ''),
                formatDateTimeForCsv(attributes.created || ''),
                formatDateTimeForCsv(attributes.changed || ''),
                escapeCsv(attributes.moderation_state || ''),
                escapeCsv(attributes.path?.alias || '')
            ].join(','));
        } catch (error) {
            console.error(`❌ Error processing event ${event.id}:`, error.message);
            if (!fs.existsSync('logs')) fs.mkdirSync('logs');
            fs.appendFileSync('logs/migration_errors.log', `Event ${event.id} processing failed: ${error.message}\n`);
        }
    }

    fs.writeFileSync(outputPath, csv.join('\n'), 'utf8');

    const publishedCount = eventsData.data.filter(e => e.attributes.status).length;
    const unpublishedCount = eventsData.data.length - publishedCount;
    console.log(`✅ CSV generated with ${eventsData.data.length} events (${publishedCount} published, ${unpublishedCount} unpublished): ${outputPath}`);

    // Run the migration
    generateEventSponsorsDelegatesCsv(eventsData).catch((error) => {
        console.error('❌ Event sponsors/delegates CSV generation failed:', error.message);
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/migration_errors.log', `Event sponsors/delegates migration failed: ${error.message}\n`);
        process.exit(1);
    });
}

// Run the migration
generateEventsCsv().catch((error) => {
    console.error('❌ Events CSV generation failed:', error.message);
    if (!fs.existsSync('logs')) fs.mkdirSync('logs');
    fs.appendFileSync('logs/migration_errors.log', `Events migration failed: ${error.message}\n`);
    process.exit(1);
});

async function generateEventSponsorsDelegatesCsv(eventsData) {

    console.log("Event sponsor migrating started")
    const csvDir = path.join(__dirname, "..", "csv");
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    const outputPath = path.join(csvDir, "events_sponsors_delegates.csv");

    // CSV headers for Directus junction table
    const csvHeaders = [
        "id",
        "event_id",
        "sponsor_id"
    ];

    const csv = [csvHeaders.join(',')];

    for (const event of eventsData.data) {
        try {
            const attributes = event.attributes || {};
            const relationships = event.relationships || {};
            const eventUuid = event.id; // Drupal UUID, maps to events.drupal_uuid



            // Handle field_show_sponsors_delegates (array of references)
            const sponsorDelegateRefs = relationships.field_sponsors?.data || [];
            const delegates = relationships.field_delegates?.data || [];
            const partners = relationships.field_supporting_partners?.data || [];

            for (const ref of sponsorDelegateRefs) {
                const directusId = uuidv4();
                const sponsorDelegateUuid = ref.id; // Drupal UUID of sponsor/delegate

                csv.push([
                    directusId,
                    escapeCsv(eventUuid),
                    escapeCsv(sponsorDelegateUuid)
                ].join(','));
            }

            for (const ref of delegates) {
                const directusId = uuidv4();
                const sponsorDelegateUuid = ref.id; // Drupal UUID of sponsor/delegate

                csv.push([
                    directusId,
                    escapeCsv(eventUuid),
                    escapeCsv(sponsorDelegateUuid)
                ].join(','));
            }

            for (const ref of partners) {
                const directusId = uuidv4();
                const sponsorDelegateUuid = ref.id; // Drupal UUID of sponsor/delegate

                csv.push([
                    directusId,
                    escapeCsv(eventUuid),
                    escapeCsv(sponsorDelegateUuid)
                ].join(','));
            }
        } catch (error) {
            console.error(`❌ Error processing event ${event.id}:`, error.message);
            if (!fs.existsSync('logs')) fs.mkdirSync('logs');
            fs.appendFileSync('logs/migration_errors.log', `Event sponsors/delegates ${event.id} processing failed: ${error.message}\n`);
        }
    }

    fs.writeFileSync(outputPath, csv.join('\n'), 'utf8');
    console.log(`✅ CSV generated with ${csv.length - 1} event-sponsor/delegate relationships: ${outputPath}`);
}