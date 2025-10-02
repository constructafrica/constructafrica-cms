projects
#	Directus Field	Drupal Source	Directus Type	Relationship	Notes
1	id	(Directus)	Primary Key (Auto)	—	Created automatically by Directus
2	drupal_nid	node.id()	Integer	—	Unique per Drupal project
3	drupal_uuid	node.uuid()	UUID (Text)	—	Recommended to mark as unique
4	title	node.title	String (Text)	—	Required
5	body	node.body.value (HTML stripped)	Text (Long)	—	Use “textarea” interface
6	country_id	field_country.target_id	UUID / Integer	Many-to-One → countries	Each project belongs to 1 country
7	region_id	field_region.target_id	UUID / Integer	Many-to-One → regions	Each project belongs to 1 region
8	sector_id	field_sector.target_id	UUID / Integer	Many-to-One → industry_classification	Links to a classification table
9	type_id	field_type.target_id	UUID / Integer	Many-to-One → industry_classification	Same as above
10	current_stage_id	field_stages.target_id	UUID / Integer	Many-to-One → statuses_stages	Links to stages table
11	estimated_value_usd	field_estimated_project_value_us.value	Decimal (Float)	—	Use Decimal(15,2) or similar
12	revised_budget_value_usd	field_revised_budget_value_us_m_.value	Decimal (Float)	—	
13	contract_value_usd	field_contract_value_us_m_.value	Decimal (Float)	—	
14	email	field_email.value	String (Email)	—	
15	phone	field_phone.value	String (Text)	—	
16	project_manager_id	field_project_manager.target_id	UUID / Integer	Many-to-One → contacts	A project has 1 manager
17	developer_id	field_developer.target_id	UUID / Integer	Many-to-One → companies	
18	main_contractor_id	field_main_contractor.target_id	UUID / Integer	Many-to-One → companies	
19	consultant_id	field_consultant.target_id	UUID / Integer	Many-to-One → companies	
20	client_owner_id	field_client_owner.target_id	UUID / Integer	Many-to-One → companies	
21	location	field_location.value (cleaned)	String (Text)	—	
22	gps_coordinates	field_gps_coordinates.value	JSON / GeoPoint	—	Format likely "lat,long"; may split
23	construction_start	field_construction_start.value	Date	—	
24	construction_completion	field_construction_completion.value	Date	—	
25	estimated_completion	field_estimated_completion.value	Date	—	
26	financial_close	field_financial_close.value	Date	—	
27	project_launch	field_project_launch.value	Date	—	
28	completed	field_completed.value	Boolean	—	1 = completed
29	cancelled	field_cancelled.value	Boolean	—	1 = cancelled



industry_classification
Field (Directus)	Type / Relation	Drupal Source
id	string (PK)	field.storage.node.field_sector → allowed_values.value (e.g. buildings, transportinfrastructure, etc.)
label	string	field.storage.node.field_sector → allowed_values.label (e.g. Buildings, Transport / Infrastructure, etc.)
drupal_field_name	string (optional, for reference)	Always field_sector (lets us trace origin if needed)
created_at	timestamp	Directus auto.
updated_at	timestamp	Directus auto.

Example:
Sector = "Energy"
Subsector = "Solar" (parent = Energy)
Type = "Utility Scale" (parent = Solar)



statuses_stages
Field (Directus)       Type / Relation                Drupal Source
id                     uuid (PK)                     Directus primary key
drupal_pid             int                           paragraphs_item.id
drupal_uuid            uuid                          paragraphs_item.uuid
type                   string                        paragraphs_item.type (= 'stages')
label                  string                        paragraph__field_label.value (if exists)
total_sub_stages_count int                           paragraph__field_total_sub_stages_count.value
created_at             timestamp                     Directus auto
updated_at             timestamp                     Directus auto


contacts
Field (Directus)	Type / Relation	Drupal Source
id	uuid (PK)	Directus primary key. Optionally seed with Drupal UUID or paragraph UUID (paragraphs_item.uuid).
drupal_pid	int	paragraphs_item.id (paragraph item ID).
drupal_uuid	uuid	paragraphs_item.uuid.
name	string	paragraph__field_name.field_name_value.
email	string	paragraph__field_email.field_email_value.
phone	string	paragraph__field_phone.field_phone_value.
role	string	paragraph__field_role.field_role_value.
company_id	uuid → companies.id	paragraph__field_key_contact_company.field_key_contact_company_target_id → map to Directus company UUID.
photo	file	paragraph__field_photo.target_id → file_managed.uri.
facebook	string (URL)	paragraph__field_facebook.uri.
twitter	string (URL)	paragraph__field_twitter.uri.
linkedin	string (URL)	paragraph__field_linkedin.uri.
created_at	timestamp	Directus auto.
updated_at	timestamp	Directus auto.


companies
Field (Directus)	Type / Relation	Drupal Source
id	uuid (PK)	Directus primary key. Optionally seed with Drupal UUID (node_field_data.uuid).
drupal_nid	int	node_field_data.nid
drupal_uuid	uuid	node_field_data.uuid
title	string	node_field_data.title
body	text	node__body.value
activities	text	node__field_activities.value
address	string	node__field_address.value
awards	text[]	node__field_awards.value / node__field_awards_companies.value
certifications	text[]	node__field_certifications.value / node__field_certifications_companies.value
comments	text	node__field_comments_.value
company_email	string	node__field_company_email.value
company_role	string	node__field_company_role.value
country_id	uuid → countries.id	node__field_country.target_id
region_id	uuid → regions.id	node__field_region.target_id
sector_id	uuid → industry_classification.id	node__field_sector.target_id
type_id	uuid → industry_classification.id	node__field_type.target_id
email	string	node__field_email.value
employees	int	node__field_employees.value
fax	string	node__field_fax.value
gallery	file[]	node__field_gallery.target_id → file_managed.uri
headquarter	string	node__field_headquater.value
key_contacts	uuid[] → contacts.id	node__field_key_contacts_companies.target_id
location_details	string	node__field_location_details.value
location_geo	point/json	node__field_location_geo.value
logo	file	node__field_logo.target_id → file_managed.uri
map_iframe	string	node__field_map_iframe.value
news	node[] → news.id	node__field_news.target_id
news_updates	paragraph[]	node__field_news_updates_paragraph_com.target_id
ongoing_projects	uuid[] → projects.id	node__field_on_going_projects.target_id
completed_projects	uuid[] → projects.id	node__field_projects_completed.target_id
projects	uuid[] → projects.id	node__field_projects.target_id
phone	string	node__field_phone.value
tags	taxonomy[]	node__field_tags_company.target_id
team	paragraph[]	node__field_team.target_id
website	string	node__field_website.uri / .value





countries, regions, industry_classification, statuses_stages, companies, contacts



(
echo "drupal_nid,drupal_uuid,title,body,country,region,sector,type,current_stage,estimated_value_usd,website,email,phone,listing_image_fid,project_manager_uid,created_at,updated_at"
terminus drush catracker.dev -- sqlq "
SELECT n.nid AS drupal_nid,
       n.uuid AS drupal_uuid,
       nfd.title AS title,
       b.body_value AS body,
       c.field_country_value AS country,
       r.field_region_value AS region,
       s.field_sector_value AS sector,
       t.field_type_value AS type,
       st.field_current_stage_value AS current_stage,
       v.field_estimated_project_value_us AS estimated_value_usd,
       w.field_website_value AS website,
       e.field_email_value AS email,
       ph.field_phone_value AS phone,
       li.field_listing_image_target_id AS listing_image_fid,
       pm.field_project_manager_target_id AS project_manager_uid,
       FROM_UNIXTIME(nfd.created) AS created_at,
       FROM_UNIXTIME(nfd.changed) AS updated_at
FROM node n
JOIN node_field_data nfd ON n.nid = nfd.nid
LEFT JOIN node__body b ON n.nid = b.entity_id
LEFT JOIN node__field_country c ON n.nid = c.entity_id
LEFT JOIN node__field_region r ON n.nid = r.entity_id
LEFT JOIN node__field_sector s ON n.nid = s.entity_id
LEFT JOIN node__field_type t ON n.nid = t.entity_id
LEFT JOIN node__field_current_stage st ON n.nid = st.entity_id
LEFT JOIN node__estimated_project_value_us v ON n.nid = v.entity_id
LEFT JOIN node__field_website w ON n.nid = w.entity_id
LEFT JOIN node__field_email e ON n.nid = e.entity_id
LEFT JOIN node__field_phone ph ON n.nid = ph.entity_id
LEFT JOIN node__field_listing_image li ON n.nid = li.entity_id
LEFT JOIN node__field_project_manager pm ON n.nid = pm.entity_id
WHERE nfd.type = 'projects';
"
) | tr '\t' ',' > projects.csv
