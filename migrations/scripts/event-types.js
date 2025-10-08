require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const https = require("https");
const path = require("path");

const BASE_URL = process.env.DRUPAL_API_URL;
const DEFAULT_ADMIN_USER = process.env.DEFAULT_ADMIN_USER;

// Axios instance
async function createApiInstance() {
    return axios.create({
        baseURL: BASE_URL,
        headers: {
            Accept: 'application/vnd.api+json',
        },
        timeout: 10000,
        httpsAgent: new https.Agent({ family: 4 }), // Force IPv
    });
}

// Fetch event types from Drupal
async function fetchEventTypes() {
    const api = await createApiInstance();
    try {
        const response = await api.get("/taxonomy_term/events_", {
            params: {
                "fields[taxonomy_term--events_]":
                    "name,description,created,changed,uid,field_event_type_image",
                include: "uid,field_event_type_image",
                "filter[status][value]": 1,
            },
        });

        return response.data;
    } catch (error) {
        console.error("❌ Fetch failed:", error.response?.data || error.message);
        fs.appendFileSync("fetch_errors.log", `Fetch failed: ${error.message}\n`);
        throw error;
    }
}

// Helper: Escape CSV field
function escapeCsv(value) {
    if (!value) return "";
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
}

// Generate CSV from fetched Drupal taxonomy
async function generateEventTypesCsv() {
    const eventTypes = await fetchEventTypes();

    const csvDir = path.join(__dirname, "..", "csv");
    if (!fs.existsSync(csvDir)) {
        fs.mkdirSync(csvDir, { recursive: true });
    }

    const outputPath = path.join(csvDir, "event_types.csv");
    const csv = ["id,name,description,user_created,date_created,date_updated"];

    for (const term of eventTypes.data) {
        // Extract user_created (from relationships.uid)
        const userId = term.relationships?.uid?.data?.id || DEFAULT_ADMIN_USER;

        csv.push(
            [
                term.id,
                escapeCsv(term.attributes.name),
                escapeCsv(term.attributes.description?.processed || ""),
                userId,
                term.attributes.created?.split("+")[0] || "",
                term.attributes.changed?.split("+")[0] || "",
            ].join(",")
        );
    }

    fs.writeFileSync(outputPath, csv.join("\n"), "utf8");
    console.log(`✅ CSV generated: ${outputPath}`);
}

// Run
generateEventTypesCsv().catch((error) => {
    console.error("❌ CSV generation failed:", error.message);
    fs.appendFileSync("logs/csv_errors.log", `CSV generation failed: ${error.message}\n`);
});

