const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DRUPAL_JSON_EVENTS = { /* Paste node--events JSON here */ };
const DRUPAL_JSON_PARTNERS = { /* Paste node--partners JSON here */ };
const IMAGE_MAP = require('./image_map.json');
const DEFAULT_ADMIN_USER = 'admin-user-uuid'; // Replace with actual Directus user UUID

// Helper: Escape CSV field
function escapeCsv(value) {
    if (!value) return '';
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
}

// Generate sponsors_delegates.csv
const sponsorsCsv = ['id,name,type,logo,website,website_title,description,created_by,created_at,updated_at'];
for (const partner of DRUPAL_JSON_PARTNERS.data) {
    const logoId = IMAGE_MAP[partner.relationships.field_partner_logo?.data?.meta.drupal_internal__target_id] || '';
    sponsorsCsv.push([
        partner.id,
        escapeCsv(partner.attributes.title),
        'partner',
        logoId,
        escapeCsv(partner.attributes.field_partner_link?.uri),
        escapeCsv(partner.attributes.field_partner_link?.title),
        '',
        DEFAULT_ADMIN_USER,
        partner.attributes.created.split('+')[0],
        partner.attributes.changed.split('+')[0]
    ].join(','));
}
fs.writeFileSync('sponsors_delegates.csv', sponsorsCsv.join('\n'));

// Process Event Photos and Galleries
for (const event of DRUPAL_JSON_EVENTS.data) {
    // Event Photo
    const photoData = event.relationships.field_event_photo?.data;
    if (photoData) {
        await uploadImage(
            photoData.meta.drupal_internal__target_id,
            `${event.attributes.title}_photo.jpg`,
            'event_photo'
        );
    }

    // Event Gallery (multiple images)
    const galleryData = event.relationships.field_event_gallery?.data || [];
    for (const [index, galleryItem] of galleryData.entries()) {
        await uploadImage(
            galleryItem.meta.drupal_internal__target_id,
            `${event.attributes.title}_gallery_${index + 1}.jpg`,
            'event_gallery'
        );
    }
}


// Generate events.csv
const eventsCsv = ['id,status,title,slug,event_type,start_date,end_date,country,registration_required,is_virtual,body,contact_number,contact_email,event_link_url,event_link_title,venue_city,venue_address,photo,gallery,created_by,created_at,updated_at'];
const eventMap = {}; // { drupal_id: directus_id }
for (const event of DRUPAL_JSON_EVENTS.data) {
    const eventId = uuidv4();
    eventMap[event.id] = eventId;
    const photoId = IMAGE_MAP[event.relationships.field_event_photo?.data?.meta.drupal_internal__target_id] || '';
    const galleryIds = (event.relationships.field_event_gallery?.data || [])
        .map(g => IMAGE_MAP[g.meta.drupal_internal__target_id])
        .filter(id => id)
        .join(';');
    eventsCsv.push([
        eventId,
        event.attributes.status ? 'published' : 'draft',
        escapeCsv(event.attributes.title),
        escapeCsv(event.attributes.title.toLowerCase().replace(/\s+/g, '-')),
        'Expo', // Adjust or map from /taxonomy_term/events_/{id}
        event.attributes.field_event_date?.value?.split('+')[0] || '',
        event.attributes.field_event_date?.end_value?.split('+')[0] || '',
        event.attributes.field_event_venue?.country_code || '',
        event.attributes.field_registration_close_date ? 'true' : 'false',
        event.attributes.field_online_event ? 'true' : 'false',
        escapeCsv(event.attributes.body?.processed),
        escapeCsv(event.attributes.field_contact_number),
        escapeCsv(event.attributes.field_event_email),
        escapeCsv(event.attributes.field_event_link?.uri),
        escapeCsv(event.attributes.field_event_link?.title),
        escapeCsv(event.attributes.field_event_venue?.locality),
        escapeCsv(event.attributes.field_event_venue?.address_line1),
        photoId,
        galleryIds,
        DEFAULT_ADMIN_USER,
        event.attributes.created?.split('+')[0] || '',
        event.attributes.changed?.split('+')[0] || ''
    ].join(','));
}
fs.writeFileSync('events.csv', eventsCsv.join('\n'));

// Generate events_sponsors_delegates.csv
const junctionCsv = ['events_id,sponsors_delegates_id'];
for (const event of DRUPAL_JSON_EVENTS.data) {
    const partners = event.relationships.field_supporting_partners?.data || [];
    for (const partner of partners) {
        if (eventMap[event.id] && DRUPAL_JSON_PARTNERS.data.find(p => p.id === partner.id)) {
            junctionCsv.push([eventMap[event.id], partner.id].join(','));
        }
    }
}
fs.writeFileSync('events_sponsors_delegates.csv', junctionCsv.join('\n'));

console.log('CSVs generated: sponsors_delegates.csv, events.csv, events_sponsors_delegates.csv');