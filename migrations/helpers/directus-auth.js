require('dotenv').config();
const { createDirectus, rest, authentication, staticToken } = require('@directus/sdk');

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://localhost:8055';
const DIRECTUS_EMAIL = process.env.DIRECTUS_EMAIL;
const DIRECTUS_PASSWORD = process.env.DIRECTUS_PASSWORD;
const DIRECTUS_STATIC_TOKEN = process.env.DIRECTUS_STATIC_TOKEN;

let directusInstance = null;
let refreshTimer = null;
let isRefreshing = false;

// Token refresh configuration
const TOKEN_REFRESH_BUFFER = 10 * 60 * 1000; // Refresh 10 minutes before expiry
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

/**
 * Initialize Directus client with automatic token refresh
 */
async function getDirectus() {
    // if (directusInstance && !isTokenExpired()) {
    //     return directusInstance;
    // }

    if (directusInstance) {
        return directusInstance;
    }

    try {
        // Try static token first (recommended for migrations)
        if (DIRECTUS_STATIC_TOKEN) {
            console.log('🔐 Using static token authentication');
            directusInstance = createDirectus(DIRECTUS_URL)
                .with(staticToken(DIRECTUS_STATIC_TOKEN))
                .with(rest());

            // Test the connection
            // await directusInstance.request(readItems('directus_users', { limit: 1 }));
            console.log('✅ Static token authentication successful');
            return directusInstance;
        }

        // Fall back to email/password authentication with auto-refresh
        console.log('🔐 Using email/password authentication');
        directusInstance = createDirectus(DIRECTUS_URL)
            .with(authentication('json'))
            .with(rest());

        await loginWithRefresh();
        setupTokenRefresh();

        return directusInstance;
    } catch (error) {
        console.error('❌ Directus authentication failed:', error.message);
        directusInstance = null;
        throw error;
    }
}

/**
 * Login and set up automatic token refresh
 */
async function loginWithRefresh() {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await directusInstance.login({
                email: DIRECTUS_EMAIL,
                password: DIRECTUS_PASSWORD
            });

            console.log('✅ Logged into Directus successfully');
            return;
        } catch (error) {
            lastError = error;
            console.log(`❌ Login attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);

            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAY * attempt;
                console.log(`⏳ Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

/**
 * Check if token is expired or about to expire
 */
function isTokenExpired() {
    if (!directusInstance?.auth?.token) return true;

    try {
        const token = directusInstance.auth.token;
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        const expiryTime = payload.exp * 1000; // Convert to milliseconds
        const currentTime = Date.now();
        const timeUntilExpiry = expiryTime - currentTime;

        // Consider token expired if it expires in less than 10 minutes
        return timeUntilExpiry < TOKEN_REFRESH_BUFFER;
    } catch (error) {
        console.log('⚠️ Could not parse token, assuming expired');
        return true;
    }
}

/**
 * Set up automatic token refresh
 */
function setupTokenRefresh() {
    // Clear existing timer
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    if (!directusInstance?.auth?.token) {
        console.log('⚠️ No token available for refresh scheduling');
        return;
    }

    try {
        const token = directusInstance.auth.token;
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        const expiryTime = payload.exp * 1000;
        const currentTime = Date.now();
        const timeUntilExpiry = expiryTime - currentTime;

        // Schedule refresh 10 minutes before expiry
        const refreshTime = Math.max(timeUntilExpiry - TOKEN_REFRESH_BUFFER, 30000); // At least 30 seconds

        console.log(`🔄 Token refresh scheduled in ${Math.round(refreshTime / 1000 / 60)} minutes`);

        refreshTimer = setTimeout(async () => {
            if (isRefreshing) {
                console.log('🔄 Token refresh already in progress...');
                return;
            }

            isRefreshing = true;
            try {
                console.log('🔄 Refreshing Directus token...');
                await directusInstance.refresh();
                console.log('✅ Token refreshed successfully');
                setupTokenRefresh(); // Reset the timer for next refresh
            } catch (error) {
                console.error('❌ Token refresh failed:', error.message);
                console.log('🔄 Attempting to re-login...');
                try {
                    await loginWithRefresh();
                    setupTokenRefresh();
                } catch (loginError) {
                    console.error('❌ Re-login failed:', loginError.message);
                }
            } finally {
                isRefreshing = false;
            }
        }, refreshTime);
    } catch (error) {
        console.error('❌ Error setting up token refresh:', error.message);
    }
}

/**
 * Make a resilient API call with automatic token refresh
 */
async function makeResilientDirectusCall(apiCall, context = 'Directus API call') {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const directus = await getDirectus();
            return await apiCall(directus);
        } catch (error) {
            lastError = error;

            // Check if it's an authentication error
            const isAuthError = error.message?.includes('Token expired') ||
                error.message?.includes('Unauthorized') ||
                error.response?.status === 401;

            console.log(`❌ ${context} attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);

            if (attempt < MAX_RETRIES) {
                if (isAuthError) {
                    console.log('🔄 Authentication error detected, resetting client...');
                    directusInstance = null;
                    if (refreshTimer) {
                        clearTimeout(refreshTimer);
                        refreshTimer = null;
                    }
                }

                const delay = RETRY_DELAY * attempt;
                console.log(`⏳ Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

/**
 * Reset the Directus client (useful for testing or error recovery)
 */
function resetDirectus() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    directusInstance = null;
    isRefreshing = false;
    console.log('🔄 Directus client reset');
}

/**
 * Logout and cleanup
 */
async function logout() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }

    if (directusInstance) {
        try {
            await directusInstance.logout();
            console.log('✅ Logged out from Directus');
        } catch (error) {
            console.log('⚠️ Logout failed:', error.message);
        }
    }

    directusInstance = null;
    isRefreshing = false;
}

module.exports = {
    getDirectus,
    makeResilientDirectusCall,
    resetDirectus,
    logout
};