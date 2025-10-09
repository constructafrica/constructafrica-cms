require('dotenv').config();
const axios = require('axios');
const https = require('https');

const BASE_URL = process.env.DRUPAL_API_URL;
const DRUPAL_USERNAME = process.env.DRUPAL_USERNAME;
const DRUPAL_PASSWORD = process.env.DRUPAL_PASSWORD;

let authClient = null;

// Authenticate with Drupal and get API client
async function getAuthenticatedApi() {
    if (!authClient) {
        await authenticateDrupal();
    }
    return authClient;
}

// Try multiple authentication methods
async function authenticateDrupal() {
    console.log('🔐 Attempting to authenticate with Drupal...');

    // Method 1: Try Basic Auth first (most reliable)
    const credentials = btoa(`${DRUPAL_USERNAME}:${DRUPAL_PASSWORD}`);
    try {
        console.log('🔄 Trying Basic Authentication...');
        authClient = axios.create({
            baseURL: BASE_URL,
            headers: {
                'Accept': 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
                'Authorization': `Basic ${credentials}`,
            },
            auth: {
                username: DRUPAL_USERNAME,
                password: DRUPAL_PASSWORD
            },
            timeout: 30000,
            httpsAgent: new https.Agent({
                family: 4,
                rejectUnauthorized: false // For dev environments
            }),
        });

        // Test the authentication with a simple request
        const testResponse = await authClient.get('/node/events?page[limit]=1');
        console.log('✅ Successfully authenticated with Basic Auth');
        return;

    } catch (basicAuthError) {
        console.log('❌ Basic Auth failed:', basicAuthError.message);
    }

    // Method 2: Try OAuth if credentials are provided
    if (process.env.DRUPAL_CLIENT_ID && process.env.DRUPAL_CLIENT_SECRET) {
        try {
            console.log('🔄 Trying OAuth Authentication...');

            // Create a temporary client for OAuth token request
            const tempClient = axios.create({
                baseURL: process.env.DRUPAL_BASE_URL, // Use base URL without jsonapi
                timeout: 30000,
                httpsAgent: new https.Agent({
                    family: 4,
                    rejectUnauthorized: false
                }),
            });

            const authResponse = await tempClient.post('/oauth/token', {
                grant_type: 'password',
                client_id: 'rshmbrO5f920Bd4AW_asOgs6v9ILaVbLl7YHU80lA78',
                client_secret: 'mrprotocoll',
                username: DRUPAL_USERNAME,
                password: DRUPAL_PASSWORD,
                scope: 'rest'
            });

            const authToken = authResponse.data.access_token;

            authClient = axios.create({
                baseURL: BASE_URL,
                headers: {
                    'Accept': 'application/vnd.api+json',
                    'Content-Type': 'application/vnd.api+json',
                    'Authorization': `Bearer ${authToken}`,
                },
                timeout: 30000,
                httpsAgent: new https.Agent({
                    family: 4,
                    rejectUnauthorized: false
                }),
            });

            // Test the authentication
            await authClient.get('/node/events?page[limit]=1');
            console.log('✅ Successfully authenticated with OAuth');
            return;

        } catch (oauthError) {
            console.log('❌ OAuth failed:', oauthError.response?.data || oauthError.message);
        }
    }

    // Method 3: Try Cookie-based session authentication
    try {
        console.log('🔄 Trying Cookie-based Authentication...');

        const tempClient = axios.create({
            baseURL: BASE_URL, // Use base Drupal URL
            timeout: 30000,
            httpsAgent: new https.Agent({
                family: 4,
                rejectUnauthorized: false
            }),
            withCredentials: true, // Important for cookies
        });

        // Login to Drupal to get session cookie
        const loginResponse = await tempClient.post('/user/login', {
            name: DRUPAL_USERNAME,
            pass: DRUPAL_PASSWORD,
            form_id: 'user_login_form'
        });

        // Use the same client for JSON:API requests
        authClient = tempClient;
        authClient.defaults.baseURL = BASE_URL; // Switch back to JSON:API base URL

        console.log('✅ Successfully authenticated with Cookie session');
        return;

    } catch (cookieError) {
        console.log('❌ Cookie authentication failed:', cookieError.response?.data || cookieError.message);
    }

    throw new Error('All authentication methods failed. Please check your credentials and Drupal configuration.');
}

// Reset authentication
function resetAuth() {
    authClient = null;
}

module.exports = {
    getAuthenticatedApi,
    resetAuth
};