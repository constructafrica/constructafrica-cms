require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getDirectus } = require("../helpers/upload-image");
const { getAuthenticatedApi, resetAuth, makeResilientApiCall } = require("../helpers/auth");
const { uploadImage } = require("../helpers/upload-image");
const {
  escapeCsv,
  fetchMediaEntity,
  fetchParagraph,
  galleryImageExists,
  csvDir,
} = require("../helpers/index");
const {
  readItems,
  createItems,
  updateItems,
  readItem,
  createItem,
} = require("@directus/sdk");
const { loadTaxonomyMapping } = require("../helpers");

// Configuration
const COMPANIES_PER_PAGE = 50;
const COMPANIES_PER_JSON_FILE = 100; // Store 100 companies per JSON file
const JSON_DATA_DIR = path.join(process.cwd(), "data", "companies");

// Ensure data directory exists
if (!fs.existsSync(JSON_DATA_DIR)) {
  fs.mkdirSync(JSON_DATA_DIR, { recursive: true });
}

const MAX_RETRIES = 2;
// Fetch all companies from Drupal and save to JSON files
async function fetchAndSaveCompanies() {
  const api = await getAuthenticatedApi(true);
  let allData = [];
  let includedData = [];
  let nextUrl = "/node/company";
  let page = 15;
  let jsonFileIndex = 8;
  let companiesInCurrentFile = 0;
  let currentFileData = { data: [], included: [] };

  const params = {
    "page[limit]": COMPANIES_PER_PAGE,
  };

  try {
    console.log(
        "📥 Fetching all companies with relationships and saving to JSON files...",
    );

    while (nextUrl) {
      console.log(`📄 Fetching page ${page}...`);

      let response;
      try {
        response = await makeResilientApiCall(
            () =>
                api.get(nextUrl, {
                  params: page === 1 ? params : {},
                  timeout: 120000, // 2 minutes timeout for large requests
                }),
            `Fetching companies page ${page}`,
        );
      } catch (error) {
        console.error(
            `❌ Failed to fetch page ${page} after ${MAX_RETRIES} attempts:`,
            error.message,
        );

        // Save whatever we have so far
        if (currentFileData.data.length > 0) {
          const filename = `companies_page_${jsonFileIndex}_partial.json`;
          const filepath = path.join(JSON_DATA_DIR, filename);
          fs.writeFileSync(
              filepath,
              JSON.stringify(currentFileData, null, 2),
              "utf8",
          );
          console.log(
              `💾 Saved partial data (${currentFileData.data.length} companies) to ${filename}`,
          );
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
        currentFileData.included = currentFileData.included.concat(
            response.data.included,
        );
      }

      // Add records to current file
      currentFileData.data = currentFileData.data.concat(records);
      companiesInCurrentFile += records.length;

      console.log(`✅ Page ${page}: ${records.length} companies`);

      // Save to JSON file when we reach the limit or this is the last page
      const isLastPage = !response.data.links?.next?.href;
      if (companiesInCurrentFile >= COMPANIES_PER_JSON_FILE || isLastPage) {
        const filename = `companies_page_${jsonFileIndex}.json`;
        const filepath = path.join(JSON_DATA_DIR, filename);

        fs.writeFileSync(
            filepath,
            JSON.stringify(currentFileData, null, 2),
            "utf8",
        );
        console.log(
            `💾 Saved ${companiesInCurrentFile} companies to ${filename}`,
        );

        // Reset for next file
        jsonFileIndex++;
        companiesInCurrentFile = 0;
        currentFileData = { data: [], included: [] };
      }

      nextUrl =
          response.data.links?.next?.href?.replace(api.defaults.baseURL, "") ||
          null;
      page++;

      // Add progressive delay to avoid overwhelming the server
      const delay = Math.min(500 + page * 100, 5000); // Progressive delay up to 5 seconds
      console.log(`⏳ Waiting ${delay}ms before next page...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    console.log(
        `🎉 Fetched ${allData.length} companies across ${page} pages and saved to ${jsonFileIndex - 1} JSON files`,
    );
    return { data: allData, included: includedData };
  } catch (error) {
    console.error(
        "❌ Companies fetch failed on page",
        page,
        ":",
        error.response?.status,
        error.response?.data || error.message,
    );

    // Save partial progress
    if (currentFileData.data.length > 0) {
      const filename = `companies_page_${jsonFileIndex}_partial.json`;
      const filepath = path.join(JSON_DATA_DIR, filename);
      fs.writeFileSync(
          filepath,
          JSON.stringify(currentFileData, null, 2),
          "utf8",
      );
      console.log(
          `💾 Saved partial progress (${currentFileData.data.length} companies) to ${filename}`,
      );
    }

    if (error.response?.status === 401) {
      console.log("🔄 Token might be expired, resetting authentication...");
      resetAuth();
    }

    if (!fs.existsSync("logs")) fs.mkdirSync("logs");
    fs.appendFileSync(
        "logs/migration_errors.log",
        `Companies fetch failed on page ${page}: ${error.message}\n`,
    );
    throw error;
  }
}

// Resume function to continue from where it left off
async function resumeFetchAndSaveCompanies() {
  console.log("🔄 Attempting to resume company fetch...");

  // Find the last successfully saved file
  const files = fs
      .readdirSync(JSON_DATA_DIR)
      .filter(
          (file) =>
              file.startsWith("companies_page_") &&
              file.endsWith(".json") &&
              !file.includes("_partial"),
      )
      .sort((a, b) => {
        const numA = parseInt(a.match(/companies_page_(\d+)\.json/)[1]);
        const numB = parseInt(b.match(/companies_page_(\d+)\.json/)[1]);
        return numB - numA; // Get the highest number
      });

  if (files.length === 0) {
    console.log("📥 No previous files found, starting fresh...");
    return await fetchAndSaveCompanies();
  }

  const lastFile = files[0];
  const lastFileNumber = parseInt(
      lastFile.match(/companies_page_(\d+)\.json/)[1],
  );
  console.log(`📂 Found previous files, last file: ${lastFile}`);

  // Check if there are any partial files that need to be recovered
  const partialFiles = fs
      .readdirSync(JSON_DATA_DIR)
      .filter(
          (file) => file.startsWith("companies_page_") && file.includes("_partial"),
      );

  if (partialFiles.length > 0) {
    console.log(
        `⚠️ Found ${partialFiles.length} partial files that need recovery`,
    );
    // You could implement recovery logic here
  }

  console.log(`🔄 Resuming from where we left off...`);
  return await fetchAndSaveCompanies();
}

// Load companies from JSON files
async function loadCompaniesFromJson() {
  try {
    console.log("📂 Loading companies from JSON files...");

    const files = fs
        .readdirSync(JSON_DATA_DIR)
        .filter(
            (file) => file.startsWith("companies_page_") && file.endsWith(".json"),
        )
        .sort((a, b) => {
          const numA = parseInt(a.match(/companies_page_(\d+)\.json/)[1]);
          const numB = parseInt(b.match(/companies_page_(\d+)\.json/)[1]);
          return numA - numB;
        });

    if (files.length === 0) {
      console.log(
          "❌ No JSON files found. Please run fetchAndSaveCompanies() first.",
      );
      return null;
    }

    let allData = [];
    let allIncluded = [];
    let totalCompanies = 0;

    for (const file of files) {
      const filepath = path.join(JSON_DATA_DIR, file);
      const fileData = JSON.parse(fs.readFileSync(filepath, "utf8"));

      allData = allData.concat(fileData.data || []);
      allIncluded = allIncluded.concat(fileData.included || []);
      totalCompanies += (fileData.data || []).length;

      console.log(
          `✅ Loaded ${(fileData.data || []).length} companies from ${file}`,
      );
    }

    console.log(
        `🎉 Loaded ${totalCompanies} companies from ${files.length} JSON files`,
    );
    return { data: allData, included: allIncluded };
  } catch (error) {
    console.error("❌ Error loading companies from JSON files:", error.message);
    throw error;
  }
}

// Check if JSON data exists and is complete
function hasJsonData() {
  if (!fs.existsSync(JSON_DATA_DIR)) {
    return false;
  }

  const files = fs
      .readdirSync(JSON_DATA_DIR)
      .filter(
          (file) => file.startsWith("companies_page_") && file.endsWith(".json"),
      );

  return files.length > 0;
}

// Create company gallery (unchanged)
async function createCompanyGallery(directus, drupalGallery, companyId) {
  const galleryItems = [];

  if (!drupalGallery || !drupalGallery.id) {
    console.log("No gallery found for the company", companyId);
    return [];
  }

  try {
    // Fetch the gallery media entity
    const galleryEntity = await fetchMediaEntity(drupalGallery.id, "gallery");
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
        imageId = await uploadImage(mainImageRef.id, "company_gallery", true);

        if (imageId) {
          // Prevent duplicates
          const exists = await galleryImageExists(
              directus,
              imageId,
              companyId,
              "company",
          );
          if (exists) {
            console.log(
                `⚠️ Skipping duplicate featured image for company ${companyId}`,
            );
          } else {
            const mediaItem = {
              id: uuidv4(),
              drupal_id: galleryAttr.drupal_internal__mid,
              drupal_uuid: galleryEntity.id,
              type: "image",
              name: galleryAttr.name || "Featured Image",
              caption: mainImageRef.meta?.title || "",
              alt_text: mainImageRef.meta?.alt || "",
              file: imageId,
              company: companyId,
              sort: 1,
            };

            const newMedia = await directus.request(
                createItems("media_gallery", mediaItem),
            );
            galleryItems.push(newMedia);
            console.log(`    ✅ Created featured image`);
          }
        }
      } catch (error) {
        console.error(
            `    ❌ Failed to create featured image: ${companyId} imageID ${imageId}`,
            error,
        );
        fs.appendFileSync(
            "logs/migration_errors.log",
            `${new Date().toISOString()} - Featured image creation failed: ${error}\n`,
        );
      }
    }

    // Get all gallery images (field_gallery_images)
    const galleryImagesRef = galleryRel.field_gallery_images?.data;
    if (galleryImagesRef && Array.isArray(galleryImagesRef)) {
      let sortOrder = 2; // Start after featured image

      for (const imageRef of galleryImagesRef) {
        try {
          const imageId = await uploadImage(
              imageRef.id,
              "company_gallery",
              true,
          );
          if (!imageId) continue;

          const exists = await galleryImageExists(
              directus,
              imageId,
              companyId,
              "company",
          );
          if (exists) {
            console.log(
                `⚠️ Skipping duplicate featured image for company ${companyId}`,
            );
          } else {
            const mediaItem = {
              id: uuidv4(),
              drupal_id: imageRef.meta?.drupal_internal__target_id,
              drupal_uuid: imageRef.id,
              type: "image",
              name: `${galleryAttr.name} - Image ${sortOrder - 1}`,
              caption: imageRef.meta?.title || "",
              alt_text: imageRef.meta?.alt || "",
              file: imageId,
              company: companyId,
              sort: sortOrder++,
              status: "published",
            };

            const newMedia = await directus.request(
                createItems("media_gallery", mediaItem),
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

// Transform company data (unchanged)
function transformCompany(drupalCompany) {
  const attr = drupalCompany.attributes || {};
  const rel = drupalCompany.relationships || {};

  return {
    id: drupalCompany.id,
    drupal_id: attr.drupal_internal__nid,
    drupal_uuid: drupalCompany.id,
    name: attr.title || "",
    slug: attr.path?.alias?.replace("/company/", "") || "",
    status: attr.status ? "published" : "draft",
    description: attr.body?.processed || "",
    activities: attr.field_activities || "",
    company_role: attr.field_company_role || "",
    headquarters: attr.field_headquater || "",
    employees: attr.field_employees ? parseInt(attr.field_employees) : null,
    projects_completed: attr.field_projects_completed
        ? parseInt(attr.field_projects_completed)
        : null,
    ongoing_projects: attr.field_on_going_projects
        ? parseInt(attr.field_on_going_projects)
        : null,
    address: attr.field_address || "",
    location_details: attr.field_location_details?.processed || "",
    latitude: attr.field_location_geo?.[0]?.lat || null,
    longitude: attr.field_location_geo?.[0]?.lng || null,
    map_iframe: attr.field_map_iframe?.processed || "",
    phone: attr.field_phone || "",
    fax: attr.field_fax || "",
    email: attr.field_email || "",
    company_email: attr.field_company_email || "",
    website: attr.field_website || "",
    facebook: attr.field_facebook || "",
    twitter: attr.field_twitter || "",
    linkedin: attr.field_linkedin || "",
    awards: attr.field_awards || "",
    certifications: attr.field_certifications || "",
    is_free_company: attr.field_free_company || false,
    date_created: attr.created || null,
    date_updated: attr.changed || null,
    user_created: rel.uid.data.id,
  };
}

// Create or update company in Directus (unchanged)
async function createOrUpdateCompany(directus, companyData) {
  try {
    // Check if company exists by drupal_id
    const existingCompanies = await directus.request(
        readItems("companies", {
          filter: { drupal_uuid: { _eq: companyData.drupal_uuid } },
          limit: 1,
        }),
    );

    if (existingCompanies && existingCompanies.length > 0) {
      console.log(
          `🔄 Company already exists: ${companyData.name} (ID: ${companyData.drupal_id})`,
      );
      return {
        success: true,
        action: "skipped",
        companyId: existingCompanies[0].id,
      };
    } else {
      // Create new company
      const newCompany = await directus.request(
          createItems("companies", companyData),
      );
      console.log(`✅ Created company: ${companyData.name}`);
      return { success: true, action: "created", companyId: newCompany.id };
    }
  } catch (error) {
    const errorMessage = error.message || error;
    console.error(
        `❌ Error processing company ${companyData.name}: ${errorMessage}`,
    );
    fs.appendFileSync(
        "logs/migration_errors.log",
        `${new Date().toISOString()} - Company ${companyData.name} failed: ${errorMessage}\n`,
    );
    return { success: false, error: errorMessage };
  }
}

// Create company awards and certifications (unchanged)
async function createCompanyAwardsAndCertifications(
    directus,
    drupalKey,
    drupalValue,
    companyId,
) {
  const awardUpdates = [];
  console.log("creating company ", drupalKey);

  if (!drupalValue || drupalValue.length === 0) return [];

  for (const award of drupalValue) {
    try {
      const data = await fetchParagraph(award.id, "image_with_link");
      if (!data) continue;

      const attr = data.attributes || {};
      const rel = data.relationships || {};

      // Upload photo if exists
      let photoId = null;
      if (rel.field_logo?.data?.id) {
        photoId = await uploadImage(
            rel.field_logo.data.id,
            "company_awards_certifications",
            true,
        );
      }

      const awards = {
        id: data.id,
        drupal_id: attr.drupal_internal__id,
        drupal_uuid: data.id,
        name: attr.relationships?.field_logo?.data?.meta?.alt || "",
        link: attr.field_link?.uri || null,
        type: drupalKey,
        company: companyId,
        logo: photoId,
        status: attr.status ? "published" : "draft",
      };

      const newAward = await directus.request(
          createItems("company_awards", awards),
      );
      awardUpdates.push(newAward);
      console.log(`  ✅ Created award update: ${awards.name}`);
    } catch (error) {
      console.error(`  ❌ Failed to create award update:`, error.message);
    }
  }

  return awardUpdates;
}

// Create company contacts (unchanged)
async function createCompanyContacts(
    directus,
    drupalContacts,
    companyId,
    includedData,
) {
  const contacts = [];

  console.log("creating company contacts ==");
  if (!drupalContacts || drupalContacts.length === 0) return [];

  for (const contactRef of drupalContacts) {
    try {
      const contactData = await fetchParagraph(contactRef.id, "teams");
      if (!contactData) continue;

      const attr = contactData.attributes || {};
      const rel = contactData.relationships || {};

      // Upload photo if exists
      let photoId = null;
      if (rel.field_photo?.data?.id) {
        photoId = await uploadImage(
            rel.field_photo.data.id,
            "company_contacts",
            true,
        );
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
        company: companyId,
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

// Create company team members (unchanged)
async function createCompanyTeamMembers(
    directus,
    drupalTeam,
    companyId,
    includedData,
) {
  const teamMembers = [];

  if (!drupalTeam || drupalTeam.length === 0) return [];

  for (const memberRef of drupalTeam) {
    try {
      const memberData = await fetchParagraph(memberRef.id, "teams");
      if (!memberData) continue;

      const attr = memberData.attributes || {};
      const rel = memberData.relationships || {};

      // Upload photo if exists
      let photoId = null;
      if (rel.field_photo?.data?.id) {
        photoId = await uploadImage(
            rel.field_photo.data.id,
            "company_team",
            true,
        );
      }

      const member = {
        id: memberData.id,
        drupal_id: attr.drupal_internal__id,
        drupal_uuid: memberData.id,
        name: attr.field_name || "",
        role: attr.field_role || "",
        email: attr.field_email || "",
        phone: attr.field_phone || "",
        facebook: attr.field_facebook || "",
        twitter: attr.field_twitter || "",
        linkedin: attr.field_linkedin || "",
        photo: photoId,
        company_team: companyId,
        status: "published",
      };

      const newMember = await directus.request(createItems("contacts", member));
      teamMembers.push(newMember);
      console.log(`  ✅ Created team member: ${member.name}`);
    } catch (error) {
      console.error(`  ❌ Failed to create team member:`, error.message);
    }
  }

  return teamMembers;
}

// Create company news updates (unchanged)
async function createCompanyNewsUpdates(directus, drupalNews, companyId) {
  const newsUpdates = [];
  console.log("creating company news and updates");

  if (!drupalNews || drupalNews.length === 0) return [];

  for (const newsRef of drupalNews) {
    try {
      const newsData = await fetchParagraph(newsRef.id, "news_updates");
      if (!newsData) continue;

      const attr = newsData.attributes || {};

      const news = {
        id: newsData.id,
        drupal_id: attr.drupal_internal__id,
        drupal_uuid: newsData.id,
        title: attr.field_event_type || "",
        content: attr.field_news?.processed || "",
        author: attr.field_author_new || "",
        date: attr.field_news_date || null,
        company: companyId,
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

// Main migration function - updated to use JSON data
async function migrateCompaniesToDirectus(useJsonData = true) {
  console.log("\n🚀 Starting company migration process...\n");

  // Initialize Directus client
  let directus;
  try {
    directus = await getDirectus();
  } catch (error) {
    console.error("❌ Failed to initialize Directus client:", error.message);
    fs.appendFileSync(
        "logs/migration_errors.log",
        `${new Date().toISOString()} - Directus initialization failed: ${error}\n`,
    );
    process.exit(1);
  }

  let companiesData;

  // Load data from JSON files or fetch from Drupal
  if (useJsonData && hasJsonData()) {
    console.log("📂 Using existing JSON data files...");
    companiesData = await loadCompaniesFromJson();
    if (!companiesData) {
      console.log(
          "❌ No JSON data found. Falling back to fetching from Drupal...",
      );
      companiesData = await fetchAndSaveCompanies();
    }
  } else {
    console.log("🌐 Fetching fresh data from Drupal...");
    companiesData = await fetchAndSaveCompanies();
  }

  if (
      !companiesData ||
      !companiesData.data ||
      companiesData.data.length === 0
  ) {
    console.error("❌ No company data available for migration");
    process.exit(1);
  }

  // Fetch taxonomies from Drupal
  console.log("\n📚 Fetching taxonomies...");
  const taxonomyMapping = loadTaxonomyMapping();

  // Updated CSV headers to match ALL fields being saved to Directus
  const companiesCsvHeaders = [
    "id",
    "drupal_id",
    "drupal_uuid",
    "name",
    "slug",
    "status",
    "description",
    "activities",
    "company_role",
    "headquarters",
    "employees",
    "projects_completed",
    "ongoing_projects",
    "address",
    "location_details",
    "latitude",
    "longitude",
    "map_iframe",
    "phone",
    "fax",
    "email",
    "company_email",
    "website",
    "facebook",
    "twitter",
    "linkedin",
    "awards",
    "certifications",
    "is_free_company",
    "date_created",
    "date_updated",
    "user_created",
    "logo",
    "migration_status",
    "migration_action",
  ];
  const companiesCsv = [companiesCsvHeaders.join(",")];

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
    "company_id",
    "status",
    "migration_status",
  ];
  const contactsCsv = [contactsCsvHeaders.join(",")];

  const teamMembersCsvHeaders = [
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
    "company_team",
    "status",
    "migration_status",
  ];
  const teamMembersCsv = [teamMembersCsvHeaders.join(",")];

  const awardsCsvHeaders = [
    "id",
    "drupal_id",
    "drupal_uuid",
    "name",
    "link",
    "type",
    "company",
    "logo",
    "status",
    "migration_status",
  ];
  const awardsCsv = [awardsCsvHeaders.join(",")];

  const galleryCsvHeaders = [
    "id",
    "drupal_id",
    "drupal_uuid",
    "type",
    "name",
    "caption",
    "alt_text",
    "file",
    "company",
    "sort",
    "status",
    "migration_status",
  ];
  const galleryCsv = [galleryCsvHeaders.join(",")];

  const newsCsvHeaders = [
    "id",
    "drupal_id",
    "drupal_uuid",
    "title",
    "content",
    "author",
    "date",
    "company",
    "status",
    "migration_status",
  ];
  const newsCsv = [newsCsvHeaders.join(",")];

  console.log("\n🏢 Processing companies...");
  let companyCount = 0;
  let skippedCount = 0;
  let createdCount = 0;
  let failedCount = 0;
  let contactsCount = 0;
  let teamMembersCount = 0;
  let newsCount = 0;
  let galleryCount = 0;
  let awardCount = 0;
  let certificationCount = 0;

  const companyMapping = {}; // Store drupal UUID to Directus ID mapping

  for (const company of companiesData.data) {
    let migrationStatus = "failed";
    let migrationAction = "none";
    let logoId = null;

    try {
      const attr = company.attributes || {};
      const rel = company.relationships || {};

      // Transform company data
      const companyData = transformCompany(company);

      // Upload logo if exists
      if (rel.field_logo?.data?.id) {
        try {
          logoId = await uploadImage(
              rel.field_logo.data.id,
              "company_logos",
              true,
          );
          companyData.logo = logoId;
        } catch (error) {
          console.error(`  ⚠️  Failed to upload logo:`, error.message);
        }
      }

      // Create or update company
      const result = await createOrUpdateCompany(directus, companyData);

      if (result.success) {
        companyMapping[company.id] = result.companyId;

        if (result.action === "created") {
          companyCount++;
          createdCount++;
          migrationStatus = "success";
          migrationAction = "created";

          // Create contacts
          const contacts = await createCompanyContacts(
              directus,
              rel.field_key_contacts_companies?.data,
              result.companyId,
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
                  result.companyId,
                  contact.status,
                  "success",
                ].join(","),
            );
          }

          // Create team members
          const teamMembers = await createCompanyTeamMembers(
              directus,
              rel.field_team?.data,
              result.companyId,
              companiesData.included,
          );
          teamMembersCount += teamMembers.length;

          // Add team members to CSV
          for (const member of teamMembers) {
            teamMembersCsv.push(
                [
                  member.id,
                  member.drupal_id || "",
                  member.drupal_uuid || "",
                  escapeCsv(member.name),
                  escapeCsv(member.role),
                  escapeCsv(member.email),
                  escapeCsv(member.phone),
                  escapeCsv(member.facebook),
                  escapeCsv(member.twitter),
                  escapeCsv(member.linkedin),
                  member.photo || "",
                  result.companyId,
                  member.status,
                  "success",
                ].join(","),
            );
          }

          // Create news updates
          const news = await createCompanyNewsUpdates(
              directus,
              rel.field_news_updates_paragraph_com?.data,
              result.companyId,
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
                  result.companyId,
                  newsItem.status,
                  "success",
                ].join(","),
            );
          }

          // Create awards
          const awards = await createCompanyAwardsAndCertifications(
              directus,
              "award",
              rel.field_awards_companies?.data,
              result.companyId,
          );

          awardCount += awards.length;

          // Add awards to CSV
          for (const award of awards) {
            awardsCsv.push(
                [
                  award.id,
                  award.drupal_id || "",
                  award.drupal_uuid || "",
                  escapeCsv(award.name),
                  escapeCsv(award.link),
                  award.type,
                  result.companyId,
                  award.logo || "",
                  award.status,
                  "success",
                ].join(","),
            );
          }

          // Create certifications
          const certifications = await createCompanyAwardsAndCertifications(
              directus,
              "certification",
              rel.field_certifications_companies?.data,
              result.companyId,
          );

          certificationCount += certifications.length;

          // Add certifications to CSV
          for (const certification of certifications) {
            awardsCsv.push(
                [
                  certification.id,
                  certification.drupal_id || "",
                  certification.drupal_uuid || "",
                  escapeCsv(certification.name),
                  escapeCsv(certification.link),
                  certification.type,
                  result.companyId,
                  certification.logo || "",
                  certification.status,
                  "success",
                ].join(","),
            );
          }

          // Create gallery
          const gallery = await createCompanyGallery(
              directus,
              rel.field_gallery?.data,
              result.companyId,
          );
          galleryCount += gallery.length;

          // Add gallery to CSV
          for (const galleryItem of gallery) {
            galleryCsv.push(
                [
                  galleryItem.id,
                  galleryItem.drupal_id || "",
                  galleryItem.drupal_uuid || "",
                  galleryItem.type,
                  escapeCsv(galleryItem.name),
                  escapeCsv(galleryItem.caption),
                  escapeCsv(galleryItem.alt_text),
                  galleryItem.file || "",
                  result.companyId,
                  galleryItem.sort || "",
                  galleryItem.status,
                  "success",
                ].join(","),
            );
          }

          // Handle taxonomy relationships
          const taxonomyRelations = [];

          // Countries
          if (attr.field_country && Array.isArray(attr.field_country)) {
            for (const countryCode of attr.field_country) {
              const countryId = taxonomyMapping.countries[countryCode];
              if (countryId) {
                taxonomyRelations.push({
                  collection: "companies_countries",
                  data: {
                    companies_id: result.companyId,
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
                  collection: "companies_regions",
                  data: {
                    companies_id: result.companyId,
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
                  collection: "companies_sectors",
                  data: {
                    companies_id: result.companyId,
                    sectors_id: sectorId,
                  },
                });
              }
            }
          }

          // Company Types
          if (attr.field_type && Array.isArray(attr.field_type)) {
            for (const typeCode of attr.field_type) {
              const typeId = taxonomyMapping.projectTypes[typeCode];
              if (typeId) {
                taxonomyRelations.push({
                  collection: "companies_types",
                  data: {
                    companies_id: result.companyId,
                    types_id: typeId,
                  },
                });
              }
            }
          }

          // Create all taxonomy relations
          for (const relation of taxonomyRelations) {
            try {
              await directus.request(
                  createItems(relation.collection, relation.data),
              );
            } catch (error) {
              console.error(
                  `  ⚠️  Failed to create taxonomy relation:`,
                  error.message,
              );
            }
          }
        } else if (result.action === "skipped") {
          skippedCount++;
          migrationStatus = "skipped";
          migrationAction = "skipped";
        }
      } else {
        failedCount++;
        migrationStatus = "failed";
        migrationAction = "error";
      }

      // Add to CSV backup - include ALL fields from transformCompany
      companiesCsv.push(
          [
            company.id,
            companyData.drupal_id || "",
            escapeCsv(companyData.drupal_uuid),
            escapeCsv(companyData.name),
            escapeCsv(companyData.slug),
            companyData.status,
            escapeCsv(companyData.description?.substring(0, 500) || ""),
            escapeCsv(companyData.activities),
            escapeCsv(companyData.company_role),
            escapeCsv(companyData.headquarters),
            companyData.employees || "",
            companyData.projects_completed || "",
            companyData.ongoing_projects || "",
            escapeCsv(companyData.address),
            escapeCsv(companyData.location_details?.substring(0, 200) || ""),
            companyData.latitude || "",
            companyData.longitude || "",
            escapeCsv(companyData.map_iframe?.substring(0, 200) || ""),
            escapeCsv(companyData.phone),
            escapeCsv(companyData.fax),
            escapeCsv(companyData.email),
            escapeCsv(companyData.company_email),
            escapeCsv(companyData.website),
            escapeCsv(companyData.facebook),
            escapeCsv(companyData.twitter),
            escapeCsv(companyData.linkedin),
            escapeCsv(companyData.awards),
            escapeCsv(companyData.certifications),
            companyData.is_free_company ? "true" : "false",
            companyData.date_created || "",
            companyData.date_updated || "",
            companyData.user_created || "",
            logoId || "",
            migrationStatus,
            migrationAction,
          ].join(","),
      );

      if (companyCount % 20 === 0 && companyCount > 0) {
        console.log(`  Processed ${companyCount} companies...`);
      }
    } catch (error) {
      console.error(
          `❌ Error processing company ${company.id}:`,
          error.message,
      );
      failedCount++;

      const attr = company.attributes || {};
      companiesCsv.push(
          [
            company.id,
            attr.drupal_internal__nid || "",
            escapeCsv(company.id),
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
            "failed",
            "exception",
          ].join(","),
      );

      if (!fs.existsSync("logs")) fs.mkdirSync("logs");
      fs.appendFileSync(
          "logs/migration_errors.log",
          `Company ${company.id} (${attr.title}) processing failed: ${error.message}\n${error.stack}\n`,
      );
    }
  }

  // Write CSV files
  console.log("\n💾 Writing CSV backup files...");
  fs.writeFileSync(
      path.join(csvDir, "companies_migration_backup.csv"),
      companiesCsv.join("\n"),
      "utf8",
  );
  fs.writeFileSync(
      path.join(csvDir, "company_contacts_backup.csv"),
      contactsCsv.join("\n"),
      "utf8",
  );
  fs.writeFileSync(
      path.join(csvDir, "company_team_members_backup.csv"),
      teamMembersCsv.join("\n"),
      "utf8",
  );
  fs.writeFileSync(
      path.join(csvDir, "company_awards_certifications_backup.csv"),
      awardsCsv.join("\n"),
      "utf8",
  );
  fs.writeFileSync(
      path.join(csvDir, "company_gallery_backup.csv"),
      galleryCsv.join("\n"),
      "utf8",
  );
  fs.writeFileSync(
      path.join(csvDir, "company_news_backup.csv"),
      newsCsv.join("\n"),
      "utf8",
  );

  // Save company mapping for projects migration
  fs.writeFileSync(
      path.join(csvDir, "company_mapping.json"),
      JSON.stringify(companyMapping, null, 2),
      "utf8",
  );

  // Generate migration summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 COMPANY MIGRATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`✅ Companies created: ${createdCount}`);
  console.log(`⏭️  Companies skipped: ${skippedCount}`);
  console.log(`❌ Companies failed: ${failedCount}`);
  console.log(`👥 Contacts created: ${contactsCount}`);
  console.log(`👔 Team members created: ${teamMembersCount}`);
  console.log(`📰 News updates created: ${newsCount}`);
  console.log(`🖼️  Gallery items created: ${galleryCount}`);
  console.log(`🏆 Awards created: ${awardCount}`);
  console.log(`📜 Certifications created: ${certificationCount}`);
  console.log("=".repeat(60));
  console.log("\n📁 Backup files generated:");
  console.log(`   • JSON data files in: ${JSON_DATA_DIR}`);
  console.log(`   • CSV files in: ${csvDir}`);
  console.log(
      `   • Company mapping: ${path.join(csvDir, "company_mapping.json")}`,
  );
  if (failedCount > 0) {
    console.log(`\n📜 Check logs/migration_errors.log for details`);
  }
  console.log("\n⚠️  IMPORTANT NOTES:");
  console.log("   • Company data saved to JSON files for future migrations");
  console.log(
      "   • Run with useJsonData=false to fetch fresh data from Drupal",
  );
  console.log("   • Company mapping saved for use in projects migration");
  console.log("   • All CSV fields now match Directus database fields");
  console.log("=".repeat(60) + "\n");
}

// Export functions for individual use
module.exports = {
  fetchAndSaveCompanies,
  loadCompaniesFromJson,
  hasJsonData,
  migrateCompaniesToDirectus,
};

// Run the migration if called directly
if (require.main === module) {
  const useJsonData =
      process.argv.includes("--use-json") || process.argv.includes("-j");

  migrateCompaniesToDirectus(useJsonData).catch((error) => {
    console.error("\n❌ MIGRATION FAILED:", error.message);
    console.error(error.stack);
    if (!fs.existsSync("logs")) fs.mkdirSync("logs");
    fs.appendFileSync(
        "logs/migration_errors.log",
        `\n\n=== COMPANY MIGRATION FAILED ===\n${new Date().toISOString()}\n${error.message}\n${error.stack}\n`,
    );
    process.exit(1);
  });
}