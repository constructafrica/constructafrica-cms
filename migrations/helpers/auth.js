require("dotenv").config();
const axios = require("axios");
const https = require("https");

const BASE_URL = process.env.DRUPAL_API_URL;
const DRUPAL_USERNAME = process.env.DRUPAL_USERNAME;
const DRUPAL_PASSWORD = process.env.DRUPAL_PASSWORD;
const DRUPAL_BASE_URL = process.env.DRUPAL_BASE_URL;
const DRUPAL_CAT_API_URL = process.env.DRUPAL_CAT_API_URL;

// Store authentication state
let authClient = null;
let sessionCookie = null;
let cookieExpiry = null;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const REQUEST_TIMEOUT = 60000; // 60 seconds
const COOKIE_LIFETIME = 23 * 24 * 60 * 60 * 1000; // 23 days in milliseconds

/**
 * Create a resilient axios instance with retry logic
 */
function createResilientClient(baseURL, headers = {}) {
  const client = axios.create({
    baseURL,
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      ...headers,
    },
    timeout: REQUEST_TIMEOUT,
    httpsAgent: new https.Agent({
      family: 4,
      rejectUnauthorized: false, // Only for development
      keepAlive: true,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 60000,
      scheduling: 'lifo' // Last In First Out for better performance
    }),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: (status) => status < 500, // Don't reject on 4xx errors
  });

  // Request interceptor to add fresh cookies
  client.interceptors.request.use(
      (config) => {
        // Check if cookie is expired
        // if (sessionCookie && cookieExpiry && Date.now() >= cookieExpiry) {
        //   console.log("⚠️  Session cookie expired, will refresh on next auth");
        //   sessionCookie = null;
        //   authClient = null;
        // }

        // Add cookie to request if available
        if (sessionCookie && !config.headers.Cookie) {
          config.headers.Cookie = sessionCookie;
        }

        return config;
      },
      (error) => Promise.reject(error)
  );

  // Response interceptor for retry logic
  client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;

        // Don't retry if no config
        if (!config) {
          return Promise.reject(error);
        }

        // Initialize retry count if not exists
        config.__retryCount = config.__retryCount || 0;

        // If we already retried the maximum number of times, reject
        if (config.__retryCount >= MAX_RETRIES) {
          console.error(`❌ Max retries (${MAX_RETRIES}) reached for ${config.url}`);
          return Promise.reject(error);
        }

        // Check if we should retry
        if (shouldRetry(error)) {
          config.__retryCount += 1;

          // Exponential backoff
          const delay = RETRY_DELAY * Math.pow(2, config.__retryCount - 1);

          console.log(
              `🔄 Retry attempt ${config.__retryCount}/${MAX_RETRIES} for ${config.url} (delay: ${delay}ms)`
          );

          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, delay));

          // If 401, try to re-authenticate
          if (error.response?.status === 401) {
            console.log("🔑 401 error detected, re-authenticating...");
            try {
              await authenticateDrupal(config.baseURL === DRUPAL_CAT_API_URL);
              // Update the cookie in the failed request config
              config.headers.Cookie = sessionCookie;
            } catch (authError) {
              console.error("❌ Re-authentication failed:", authError.message);
              return Promise.reject(authError);
            }
          }

          // Retry the request
          return client(config);
        }

        return Promise.reject(error);
      }
  );

  return client;
}

/**
 * Determine if a request should be retried
 */
function shouldRetry(error) {
  // Network errors
  if (!error.response) {
    return (
        error.code === "ECONNABORTED" ||
        error.code === "ECONNRESET" ||
        error.code === "ETIMEDOUT" ||
        error.code === "ENOTFOUND" ||
        error.message.includes("timeout") ||
        error.message.includes("network") ||
        error.message.includes("aborted")
    );
  }

  // HTTP status codes that should be retried
  const status = error.response.status;
  return (
      status === 401 || // Unauthorized (maybe expired session)
      status === 408 || // Request Timeout
      status === 429 || // Too Many Requests
      status === 500 || // Internal Server Error
      status === 502 || // Bad Gateway
      status === 503 || // Service Unavailable
      status === 504    // Gateway Timeout
  );
}

/**
 * Check if session is still valid
 */
function isSessionValid() {
  return (
      sessionCookie !== null &&
      cookieExpiry !== null &&
      Date.now() < cookieExpiry &&
      authClient !== null
  );
}

/**
 * Authenticate with Drupal and get session cookie
 */
async function authenticateDrupal(useCatApi = false) {
  console.log("🔐 Authenticating with Drupal...");

  if (!DRUPAL_USERNAME || !DRUPAL_PASSWORD) {
    throw new Error("Missing DRUPAL_USERNAME or DRUPAL_PASSWORD in environment variables");
  }

  if (!DRUPAL_BASE_URL) {
    throw new Error("Missing DRUPAL_BASE_URL in environment variables");
  }

  try {
    // Login to get session cookie
    // const loginResponse = await axios.post(
    //     `${DRUPAL_BASE_URL}/user/login?_format=json`,
    //     {
    //       name: DRUPAL_USERNAME,
    //       pass: DRUPAL_PASSWORD,
    //     },
    //     {
    //       headers: {
    //         "Content-Type": "application/json",
    //       },
    //       timeout: 30000,
    //       httpsAgent: new https.Agent({
    //         family: 4,
    //         rejectUnauthorized: false,
    //       }),
    //     }
    // );
    //
    // // Check if login was successful
    // if (loginResponse.status !== 200) {
    //   throw new Error(`Login failed with status: ${loginResponse.status}`);
    // }
    //
    // // Extract session cookie from response headers
    // const cookies = loginResponse.headers["set-cookie"];
    //
    // if (!cookies || cookies.length === 0) {
    //   throw new Error("No session cookie received from Drupal");
    // }
    //
    // // Find the session cookie (SSESS... or SESS...)
    // const sessionCookies = cookies.filter(cookie =>
    //     cookie.startsWith('SSESS') || cookie.startsWith('SESS')
    // );
    //
    // if (sessionCookies.length === 0) {
    //   throw new Error("Session cookie not found in response");
    // }
    //
    // // Extract cookie value (before first semicolon)
    // sessionCookie = sessionCookies
    //     .map((cookie) => cookie.split(";")[0])
    //     .join("; ");
    //
    // // Set cookie expiry (Drupal default is 23 days)
    // cookieExpiry = Date.now() + COOKIE_LIFETIME;
    //
    // console.log("✅ Successfully obtained session cookie");
    // console.log(`📅 Cookie expires: ${new Date(cookieExpiry).toISOString()}`);
    sessionCookie =
        "SSESSdf1177669cb8a32b235a3680b4807bea=CfEuWAASy1RSzWSaf4x-y8vIPQ2JnNXgyAsE8b0mjCl8u5ie";
    // Determine which API URL to use
    const targetUrl = useCatApi ? DRUPAL_CAT_API_URL : BASE_URL;

    if (!targetUrl) {
      throw new Error(`Missing API URL in environment variables (${useCatApi ? 'DRUPAL_CAT_API_URL' : 'DRUPAL_API_URL'})`);
    }

    console.log("🔗 Creating authenticated API client for:", targetUrl);

    // Create authenticated client
    authClient = createResilientClient(targetUrl, {
      Cookie: sessionCookie,
    });

    // Test the connection with a simple request
    // try {
    //   const testResponse = await authClient.get("/jsonapi", {
    //     timeout: 10000,
    //   });
    //
    //   if (testResponse.status === 200) {
    //     console.log("✅ Successfully authenticated and verified API connection");
    //   } else {
    //     console.warn(`⚠️  API test returned status: ${testResponse.status}`);
    //   }
    // } catch (testError) {
    //   console.warn("⚠️  Could not verify API connection:", testError.message);
    //   // Don't throw here - the authentication might still work for actual endpoints
    // }

    return authClient;
  } catch (error) {
    // Reset auth state on failure
    authClient = null;
    sessionCookie = null;
    cookieExpiry = null;

    console.error("❌ Authentication failed:", error.message);

    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", JSON.stringify(error.response.data, null, 2));
    }

    throw new Error(
        `Drupal authentication failed: ${error.message}. Please check credentials and Drupal configuration.`
    );
  }
}

/**
 * Get authenticated API client (creates one if needed)
 */
async function getAuthenticatedApi(useCatApi = false) {
  // Check if we have a valid session
  // if (isSessionValid()) {
  //   console.log("✅ Using existing valid session");
  //   return authClient;
  // }
  if (!authClient) {
    await authenticateDrupal(useCatApi);
  }

  return authClient;
  // Need to authenticate
  // console.log("🔄 Session invalid or expired, authenticating...");
  // return await authenticateDrupal(useCatApi);
}

/**
 * Reset authentication state
 */
function resetAuth() {
  console.log("🔄 Resetting authentication state");
  authClient = null;
  sessionCookie = null;
  cookieExpiry = null;
}

/**
 * Make a resilient API call with automatic retry and re-authentication
 */
async function makeResilientApiCall(apiCall, context = "API call") {
  if (typeof apiCall !== "function") {
    throw new Error("apiCall must be a function");
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Ensure we have valid authentication
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
  makeResilientApiCall,
  isSessionValid,
};