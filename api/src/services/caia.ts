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
import dns from 'dns/promises';
import net from 'net';
import {
  getCAIACredentials,
  type CAIACredentials,
} from './secrets-manager.js';
import { isProduction, isRenderProduction } from '../config/runtime.js';
import { errorMessage } from '../utils/route-http.js';

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
  const hasEnvCredentials = !!(
    process.env.CAIA_ISSUER_URL &&
    process.env.CAIA_CLIENT_ID &&
    process.env.CAIA_CLIENT_SECRET
  );

  if (hasEnvCredentials) {
    return true;
  }

  // In local dev or non-AWS deployments, do not require Secrets Manager.
  if (!isProduction() || isRenderProduction()) {
    return false;
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
  const creds = await fetchCredentials();

  try {
    const issuerUrl = await validateCaiaIssuerUrl(creds.issuer_url);
    const config = await client.discovery(
      issuerUrl,
      creds.client_id,
      creds.client_secret,
      undefined,
      { [client.customFetch]: ssrfSafeFetch },
    );
    config[client.customFetch] = ssrfSafeFetch;
    return config;
  } catch (err) {
    console.error('[CAIA] Issuer discovery failed:', errorMessage(err));
    throw err;
  }
}

function isUnsafeIpAddress(address: string): boolean {
  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('::ffff:127.')
      || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.')
      || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
  }

  if (net.isIP(address) !== 4) return true;
  return address === '0.0.0.0'
    || address.startsWith('127.')
    || address.startsWith('10.')
    || address.startsWith('192.168.')
    || address.startsWith('169.254.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
}

function numberToIpv4(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function parseNumericIpv4(hostname: string): string | null {
  const normalized = hostname.toLowerCase();
  if (/^0x[0-9a-f]+$/.test(normalized)) return numberToIpv4(Number.parseInt(normalized.slice(2), 16));
  if (/^0[0-7]+$/.test(normalized)) return numberToIpv4(Number.parseInt(normalized, 8));
  if (/^\d+$/.test(normalized)) return numberToIpv4(Number.parseInt(normalized, 10));
  return null;
}

function validateIssuerUrlShape(rawIssuerUrl: string): URL {
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(rawIssuerUrl);
  } catch {
    throw new Error('CAIA issuer URL is malformed');
  }
  if (issuerUrl.protocol !== 'https:') {
    throw new Error('CAIA issuer URL must use HTTPS');
  }
  if (issuerUrl.username || issuerUrl.password) {
    throw new Error('CAIA issuer URL cannot include credentials');
  }

  const hostname = issuerUrl.hostname.toLowerCase().replace(/\.$/, '');
  const blockedHostnames = new Set(['localhost', 'metadata.google.internal']);
  const numericIpv4 = parseNumericIpv4(hostname);
  if (
    blockedHostnames.has(hostname) ||
    hostname.endsWith('.local') ||
    (net.isIP(hostname) !== 0 && isUnsafeIpAddress(hostname)) ||
    (numericIpv4 !== null && isUnsafeIpAddress(numericIpv4))
  ) {
    throw new Error('CAIA issuer URL cannot target private or metadata hosts');
  }

  return issuerUrl;
}

export async function validateCaiaIssuerUrl(rawIssuerUrl: string): Promise<URL> {
  const issuerUrl = validateIssuerUrlShape(rawIssuerUrl);
  const addresses = await dns.lookup(issuerUrl.hostname, { all: true, verbatim: true });
  if (addresses.some(address => isUnsafeIpAddress(address.address))) {
    throw new Error('CAIA issuer URL resolved to a private or metadata address');
  }
  return issuerUrl;
}

async function ssrfSafeFetch(input: Request | string | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = input instanceof Request ? input.url : input.toString();
  await validateCaiaIssuerUrl(requestUrl);
  const response = await fetch(input, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      await validateCaiaIssuerUrl(new URL(location, requestUrl).toString());
    }
    throw new Error('CAIA issuer URL redirects are not allowed');
  }
  return response;
}

/**
 * Fetch credentials from Secrets Manager (or env vars in dev)
 * @throws Error if credentials not configured
 */
async function fetchCredentials(): Promise<CAIACredentials> {
  const issuer_url = process.env.CAIA_ISSUER_URL;
  const client_id = process.env.CAIA_CLIENT_ID;
  const client_secret = process.env.CAIA_CLIENT_SECRET;

  if (issuer_url && client_id && client_secret) {
    return { issuer_url, client_id, client_secret };
  }

  if (!isProduction() || isRenderProduction()) {
    throw new Error('CAIA not configured: set CAIA_ISSUER_URL, CAIA_CLIENT_ID, CAIA_CLIENT_SECRET');
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
  const config = await discoverIssuer();
  const redirectUri = getRedirectUri();

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', params.state);

  let tokens;
  try {
    tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: params.codeVerifier,
      expectedState: params.state,
      expectedNonce: params.nonce,
      idTokenExpected: true,
    });
  } catch (err) {
    console.error('[CAIA] Token exchange failed:', errorMessage(err));
    throw err;
  }

  const idTokenClaims = tokens.claims();
  if (!idTokenClaims) {
    console.error('[CAIA] No ID token claims in response');
    throw new Error('No ID token claims returned');
  }

  let userInfoClaims: Record<string, unknown> = {};
  try {
    const userInfoResponse = await client.fetchUserInfo(config, tokens.access_token, idTokenClaims.sub);
    userInfoClaims = userInfoResponse;
  } catch (err) {
    console.error('[CAIA] Failed to fetch userinfo:', errorMessage(err));
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
  try {
    const safeIssuerUrl = await validateCaiaIssuerUrl(issuerUrl);
    const config = await client.discovery(
      safeIssuerUrl,
      clientId,
      clientSecret,
      undefined,
      { [client.customFetch]: ssrfSafeFetch },
    );
    config[client.customFetch] = ssrfSafeFetch;

    const issuer = config.serverMetadata().issuer;

    return {
      success: true,
      issuer,
    };
  } catch (err) {
    console.error(`[CAIA] Discovery failed for ${issuerUrl}:`, errorMessage(err));
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
