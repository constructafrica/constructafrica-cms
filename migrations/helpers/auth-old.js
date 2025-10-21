require("dotenv").config();
const axios = require("axios");
const https = require("https");

const BASE_URL = process.env.DRUPAL_API_URL;
const DRUPAL_USERNAME = process.env.DRUPAL_USERNAME;
const DRUPAL_PASSWORD = process.env.DRUPAL_PASSWORD;

let authClient = null;

// Authenticate with Drupal and get API client
async function getAuthenticatedApi(cat = false) {
  if (!authClient) {
    await authenticateDrupal(cat);
  }
  return authClient;
}

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Try multiple authentication methods
async function authenticateDrupal(cat = false) {
  console.log("🔐 Attempting to authenticate with Drupal...");

  // const loginResponse = await axios.post(
  //     `${process.env.DRUPAL_BASE_URL}/user/login?_format=json`,
  //     {
  //         name: process.env.DRUPAL_USERNAME,
  //         pass: process.env.DRUPAL_PASSWORD
  //     },
  //     {
  //         headers: { 'Content-Type': 'application/json' },
  //         withCredentials: true
  //     }
  // );
  //
  // // 2. Extract session cookie
  // const cookies = loginResponse.headers['set-cookie'];
  // const sessionCookie = cookies.map(cookie => cookie.split(';')[0]).join('; ');
  // console.log('Got session cookie:', sessionCookie);

  const sessionCookie =
    "SSESSdf1177669cb8a32b235a3680b4807bea=CfEuWAASy1RSzWSaf4x-y8vIPQ2JnNXgyAsE8b0mjCl8u5ie";
  const url = cat ? process.env.DRUPAL_CAT_API_URL : BASE_URL;
  console.log("URL", url);
  try {
    console.log("🔄 Trying Basic Authentication...");
    authClient = axios.create({
      baseURL: url,
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        // 'Authorization': `Basic ${credentials}`,
        Cookie: sessionCookie,
      },
      timeout: 30000,
      httpsAgent: new https.Agent({
        family: 4,
        rejectUnauthorized: false, // For dev environments
      }),
    });

    // Test the authentication with a simple request
    // const testResponse = await authClient.get('/node/events?page[limit]=1');
    console.log("✅ Successfully authenticated with Basic Auth:", url);
    return;
  } catch (basicAuthError) {
    console.log("❌ Basic Auth failed:", basicAuthError.message);
  }

  throw new Error(
    "Authentication methods failed. Please check your credentials and Drupal configuration.",
  );
}

// Reset authentication
function resetAuth() {
  authClient = null;
}

async function makeResilientApiCall(apiCall, context = "API call") {
  if (typeof apiCall !== "function") {
    throw new Error("apiCall must be a function");
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // // Ensure we have valid authentication
      // if (!isSessionValid()) {
      //   console.log("🔑 Session invalid, authenticating before API call...");
      //   await getAuthenticatedApi();
      // }

      // Make the API call
      const result = await apiCall();

      // Success!
      if (attempt > 1) {
        console.log(`✅ ${context} succeeded on attempt ${attempt}`);
      }

      return result;
    } catch (error) {
      lastError = error;

      console.error(
          `❌ ${context} - Attempt ${attempt}/${MAX_RETRIES} failed:`,
          error.message
      );

      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   URL: ${error.config?.url}`);
      }

      // Don't retry on certain errors
      if (error.response?.status === 404 || error.response?.status === 403) {
        console.error("❌ Not retrying - resource not found or forbidden");
        throw error;
      }

      // Last attempt - don't wait
      if (attempt === MAX_RETRIES) {
        console.error(`❌ ${context} - All ${MAX_RETRIES} attempts failed`);
        break;
      }

      // Calculate delay with exponential backoff
      const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Reset auth on 401 errors
      if (error.response?.status === 401) {
        console.log("🔄 401 error - resetting authentication");
        resetAuth();
      }
    }
  }

  throw lastError;
}

module.exports = {
  getAuthenticatedApi,
  resetAuth,
  makeResilientApiCall
};
