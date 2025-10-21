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

// Main migration function - updated to use JSON data
async function migrateCompaniesToDirectus(useJsonData = true) {
    console.log("\n🚀 Starting company projects migration process...\n");

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

    const companiesData = await loadCompaniesFromJson();

    if (
        !companiesData ||
        !companiesData.data ||
        companiesData.data.length === 0
    ) {
        console.error("❌ No company data available for migration");
        process.exit(1);
    }

    console.log("\n🏢 Processing companies...");
    let createdCount = 0;
    let failedCount = 0;

    for (const company of companiesData.data) {

        try {
            const attr = company.attributes || {};
            const rel = company.relationships || {};

            // company projects
            if (rel.field_projects.data && Array.isArray(rel.field_projects.data)) {
                for (const project of rel.field_projects.data) {
                    try {
                        await directus.request(
                            createItem('companies_projects', {
                                companies_id: company.id,
                                projects_id: project.id
                            } )
                        );
                        createdCount++
                        console.log('project created for', attr.title || '')
                    } catch (error) {
                        console.error(`  ⚠️  Failed to create company project:`, error);
                    }
                }
            }

        } catch (error) {
            console.error(
                `❌ Error processing company ${company.id}:`,
                error.message,
            );
            failedCount++;

            if (!fs.existsSync("logs")) fs.mkdirSync("logs");
            fs.appendFileSync(
                "logs/migration_errors.log",
                `Company ${company.id} (${attr.title}) processing failed: ${error.message}\n${error.stack}\n`,
            );
        }
    }


    // Generate migration summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 COMPANY PROJECTS MIGRATION SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Company Projects created: ${createdCount}`);

    if (failedCount > 0) {
        console.log(`\n📜 Check logs/migration_errors.log for details`);
    }

    console.log("=".repeat(60) + "\n");
}

// Export functions for individual use
module.exports = {
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