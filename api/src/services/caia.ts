/**
 * CAIA OAuth Client Service
 *
 * Provides PIV smartcard authentication via Treasury's CAIA (Customer Authentication
 * & Identity Architecture) OAuth server. Uses openid-client v6 for OIDC flows.
 *
 * Credentials are stored in AWS Secrets Manager and fetched fresh on each auth flow.
 * This ensures credential updates take effect immediately without restart.
 */

import * as client from 'openid-client';
import {
  getCAIACredentials,
  type CAIACredentials,
} from './secrets-manager.js';

/**
 * User information extracted from CAIA ID token
 */
export interface CAIAUserInfo {
  /** Subject identifier (NOT persistent - do not use for permanent storage) */
  sub: string;
  /** Email address (primary identifier) */
  email: string;
  /** Given name (first name) - only available for IAL2+ */
  givenName?: string;
  /** Family name (last name) - only available for IAL2+ */
  familyName?: string;
  /** Credential Service Provider used: 'X509Cert', 'Login.gov', 'ID.me' */
  csp?: string;
  /** Identity Assurance Level */
  ial?: string;
  /** Authentication Assurance Level */
  aal?: string;
  /** Raw ID token claims */
  rawClaims: Record<string, unknown>;
}

/**
 * Authorization URL result
 */
export interface CAIAAuthorizationUrlResult {
  /** Full authorization URL to redirect user to */
  url: string;
  /** State parameter for CSRF protection */
  state: string;
  /** Nonce for replay protection */
  nonce: string;
  /** PKCE code verifier (store in session) */
  codeVerifier: string;
}

/**
 * Callback result with user info
 */
export interface CAIACallbackResult {
  /** Authenticated user information */
  user: CAIAUserInfo;
}

/**
 * Get redirect URI from environment (auto-derived from APP_BASE_URL)
 * Uses /api/auth/piv/callback to match CAIA client registration
 */
function getRedirectUri(): string {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) {
    throw new Error('APP_BASE_URL environment variable is required');
  }
  const redirectUri = `${baseUrl}/api/auth/piv/callback`;
  console.log(`[CAIA] Using redirect_uri: ${redirectUri}`);
  return redirectUri;
}

/**
 * Check if CAIA integration is configured
 * Fetches from Secrets Manager on each call (no caching)
 */
export async function isCAIAConfigured(): Promise<boolean> {
  // In local dev without Secrets Manager, fall back to env vars
  if (process.env.NODE_ENV !== 'production') {
    return !!(
      process.env.CAIA_ISSUER_URL &&
      process.env.CAIA_CLIENT_ID &&
      process.env.CAIA_CLIENT_SECRET
    );
  }

  const result = await getCAIACredentials();
  return result.configured;
}

/**
 * Initialize CAIA client by discovering the issuer
 * Called at startup to validate configuration (optional)
 */
export async function initializeCAIA(): Promise<void> {
  const configured = await isCAIAConfigured();
  if (!configured) {
    console.log('CAIA not configured, skipping initialization');
    return;
  }

  try {
    const config = await discoverIssuer();
    console.log('CAIA issuer discovered:', config.serverMetadata().issuer);
  } catch (err) {
    console.error('Failed to discover CAIA issuer:', err);
    throw err;
  }
}

/**
 * Discover OIDC issuer and create configuration
 * Fetches credentials fresh from Secrets Manager
 */
async function discoverIssuer(): Promise<client.Configuration> {
  console.log('[CAIA] Discovering issuer...');
  const creds = await fetchCredentials();
  console.log(`[CAIA]   Issuer URL: ${creds.issuer_url}`);
  console.log(`[CAIA]   Client ID: ${creds.client_id}`);

  try {
    const config = await client.discovery(
      new URL(creds.issuer_url),
      creds.client_id,
      creds.client_secret,
    );
    const metadata = config.serverMetadata();
    console.log(`[CAIA] Issuer discovered successfully: ${metadata.issuer}`);
    console.log(`[CAIA] Token endpoint: ${metadata.token_endpoint}`);
    console.log(`[CAIA] Supported token auth methods: ${JSON.stringify(metadata.token_endpoint_auth_methods_supported)}`);
    return config;
  } catch (err) {
    const error = err as Error & { cause?: unknown; code?: string };
    console.error(`[CAIA] Discovery failed during auth flow:`);
    console.error(`[CAIA]   Error: ${error.message}`);
    if (error.cause) {
      console.error(`[CAIA]   Cause:`, error.cause);
    }
    throw err;
  }
}

/**
 * Fetch credentials from Secrets Manager (or env vars in dev)
 * @throws Error if credentials not configured
 */
async function fetchCredentials(): Promise<CAIACredentials> {
  // In local dev, use env vars
  if (process.env.NODE_ENV !== 'production') {
    const issuer_url = process.env.CAIA_ISSUER_URL;
    const client_id = process.env.CAIA_CLIENT_ID;
    const client_secret = process.env.CAIA_CLIENT_SECRET;

    if (!issuer_url || !client_id || !client_secret) {
      throw new Error('CAIA not configured: set CAIA_ISSUER_URL, CAIA_CLIENT_ID, CAIA_CLIENT_SECRET');
    }

    return { issuer_url, client_id, client_secret };
  }

  // In production, fetch from Secrets Manager
  const result = await getCAIACredentials();

  if (!result.configured || !result.credentials) {
    if (result.error) {
      throw new Error(`CAIA credentials unavailable: ${result.error}`);
    }
    throw new Error('CAIA not configured: configure credentials in admin settings');
  }

  return result.credentials;
}

/**
 * Get authorization URL for CAIA login
 * Uses PKCE for security (required for public clients, recommended for all)
 */
export async function getAuthorizationUrl(): Promise<CAIAAuthorizationUrlResult> {
  const config = await discoverIssuer();
  const redirectUri = getRedirectUri();

  // Generate PKCE code verifier and challenge
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  // Generate state and nonce for security
  const state = client.randomState();
  const nonce = client.randomNonce();

  // Build authorization URL with all parameters
  const parameters: Record<string, string> = {
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  };

  const authorizationUrl = client.buildAuthorizationUrl(config, parameters);

  return {
    url: authorizationUrl.href,
    state,
    nonce,
    codeVerifier,
  };
}

/**
 * Handle OAuth callback from CAIA
 * Exchanges authorization code for tokens and extracts user info
 */
export async function handleCallback(
  code: string,
  params: { state: string; nonce: string; codeVerifier: string }
): Promise<CAIACallbackResult> {
  console.log('[CAIA] Handling OAuth callback...');
  console.log(`[CAIA]   Code: ${code.substring(0, 10)}...`);
  console.log(`[CAIA]   State: ${params.state}`);

  const config = await discoverIssuer();
  const redirectUri = getRedirectUri();
  console.log(`[CAIA]   Redirect URI: ${redirectUri}`);

  // Build the callback URL that was called (with code and state)
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', params.state);

  // Exchange code for tokens using openid-client v6 API
  console.log('[CAIA] Exchanging authorization code for tokens...');
  const metadata = config.serverMetadata();
  console.log(`[CAIA]   Token endpoint: ${metadata.token_endpoint}`);
  console.log(`[CAIA]   Supported auth methods: ${JSON.stringify(metadata.token_endpoint_auth_methods_supported)}`);

  let tokens;
  try {
    tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: params.codeVerifier,
      expectedState: params.state,
      expectedNonce: params.nonce,
      idTokenExpected: true,
    });
    console.log('[CAIA] Token exchange successful');
  } catch (err) {
    const error = err as Error & {
      cause?: unknown;
      code?: string;
      status?: number;
      response?: Response;
      error?: string;
      error_description?: string;
    };
    console.error('[CAIA] Token exchange FAILED:');
    console.error(`[CAIA]   Error name: ${error.name}`);
    console.error(`[CAIA]   Error message: ${error.message}`);
    if (error.status) {
      console.error(`[CAIA]   HTTP Status: ${error.status}`);
    }
    if (error.error) {
      console.error(`[CAIA]   OAuth Error: ${error.error}`);
    }
    if (error.error_description) {
      console.error(`[CAIA]   OAuth Error Description: ${error.error_description}`);
    }
    if (error.cause) {
      console.error('[CAIA]   Error cause:', error.cause);
    }
    console.error('[CAIA]   Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    throw err;
  }

  // Get claims from ID token (may only have sub)
  const idTokenClaims = tokens.claims();
  if (!idTokenClaims) {
    console.error('[CAIA] No ID token claims in response');
    throw new Error('No ID token claims returned');
  }
  console.log('[CAIA] ID token claims received:', {
    sub: idTokenClaims.sub,
    email: idTokenClaims.email,
    csp: idTokenClaims.csp,
  });

  // Fetch additional user info from userinfo endpoint
  // CAIA puts user attributes (email, name) in userinfo, not ID token
  console.log('[CAIA] Fetching userinfo from endpoint...');
  let userInfoClaims: Record<string, unknown> = {};
  try {
    const userInfoResponse = await client.fetchUserInfo(config, tokens.access_token, idTokenClaims.sub);
    userInfoClaims = userInfoResponse;
    console.log('[CAIA] Userinfo received:', {
      sub: userInfoClaims.sub,
      email: userInfoClaims.email,
      given_name: userInfoClaims.given_name,
      family_name: userInfoClaims.family_name,
      csp: userInfoClaims.csp,
    });
  } catch (err) {
    console.error('[CAIA] Failed to fetch userinfo:', err);
    // Continue with ID token claims only - some flows may not have userinfo
  }

  // Merge claims: prefer userinfo over ID token
  const claims = { ...idTokenClaims, ...userInfoClaims };

  // Type-safe claim extraction with validation
  const sub = idTokenClaims.sub; // sub always from ID token
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  const givenName = typeof claims.given_name === 'string' ? claims.given_name : undefined;
  const familyName = typeof claims.family_name === 'string' ? claims.family_name : undefined;
  const csp = typeof claims.csp === 'string' ? claims.csp : undefined;
  const ial = claims.ial !== undefined ? String(claims.ial) : undefined;
  const aal = claims.aal !== undefined ? String(claims.aal) : undefined;

  const user: CAIAUserInfo = {
    sub,
    email: email || '',
    givenName,
    familyName,
    csp,
    ial,
    aal,
    rawClaims: claims,
  };

  return { user };
}

/**
 * Validate CAIA issuer URL by attempting discovery
 * Used by admin UI to validate credentials before saving
 *
 * @returns true if discovery succeeds, throws on failure
 */
export async function validateIssuerDiscovery(
  issuerUrl: string,
  clientId: string,
  clientSecret: string
): Promise<{ success: true; issuer: string }> {
  const discoveryUrl = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  console.log(`[CAIA] Validating issuer discovery:`);
  console.log(`[CAIA]   Issuer URL: ${issuerUrl}`);
  console.log(`[CAIA]   Discovery URL: ${discoveryUrl}`);
  console.log(`[CAIA]   Client ID: ${clientId}`);
  console.log(`[CAIA]   Client Secret: ${clientSecret ? '[REDACTED - ' + clientSecret.length + ' chars]' : '[EMPTY]'}`);

  try {
    const config = await client.discovery(
      new URL(issuerUrl),
      clientId,
      clientSecret,
    );

    const issuer = config.serverMetadata().issuer;
    console.log(`[CAIA] Discovery successful! Issuer: ${issuer}`);

    return {
      success: true,
      issuer,
    };
  } catch (err) {
    const error = err as Error & { cause?: unknown; code?: string };
    console.error(`[CAIA] Discovery FAILED for ${issuerUrl}:`);
    console.error(`[CAIA]   Error message: ${error.message}`);
    console.error(`[CAIA]   Error name: ${error.name}`);
    if (error.code) {
      console.error(`[CAIA]   Error code: ${error.code}`);
    }
    if (error.cause) {
      console.error(`[CAIA]   Error cause:`, error.cause);
    }
    console.error(`[CAIA]   Full error:`, error);
    throw err;
  }
}

/**
 * Reset the CAIA configuration singleton (for testing)
 * With per-request credential fetching, this is now a no-op
 * but kept for API compatibility
 */
export function resetCAIAClient(): void {
  // No-op - credentials are fetched fresh each request
}
