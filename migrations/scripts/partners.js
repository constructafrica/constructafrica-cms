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
