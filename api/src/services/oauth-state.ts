/**
 * Shared OAuth State Management
 *
 * Provides secure storage and retrieval of OAuth state parameters.
 * Used by both PIV (FPKI) and CAIA authentication flows.
 *
 * Security features:
 * - Cryptographically secure state generation
 * - Database storage (survives server restarts)
 * - One-time use (consumed on retrieval)
 * - Automatic expiration (10 minutes)
 * - State format validation
 */

import crypto from 'crypto';
import { pool } from '../db/client.js';

// OAuth state expiry (10 minutes - OAuth flows should complete quickly)
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type OAuthStateRow = {
  nonce: string;
  code_verifier: string;
};

/**
 * Validate that a state string is safe and reasonable
 *
 * Accepts multiple formats since different SDKs generate states differently:
 * - 64-char hex (our internal format, crypto.randomBytes)
 * - base64url (OIDC standard, openid-client/generators.state())
 * - UUID format (some OAuth libraries)
 *
 * Security is provided by:
 * - Cryptographic randomness (SDK responsibility)
 * - One-time use (consumed on retrieval)
 * - 10-minute expiration
 * - Server-side storage (not in cookies)
 */
export function isValidStateFormat(state: string): boolean {
  // Minimum 16 chars, maximum 256 chars
  // Allow alphanumeric, dash, underscore (covers hex, base64url, UUID)
  return state.length >= 16 && state.length <= 256 && /^[a-zA-Z0-9_-]+$/.test(state);
}

/**
 * Generate cryptographically secure session ID
 */
export function generateSecureSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Store OAuth state in database (survives server restarts)
 *
 * @throws Error if state format is invalid
 */
export async function storeOAuthState(
  state: string,
  nonce: string,
  codeVerifier: string
): Promise<void> {
  // Validate state format (defense in depth)
  if (!isValidStateFormat(state)) {
    throw new Error('Invalid state format');
  }

  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

  // Clean up expired states opportunistically (every ~10th request)
  if (Math.random() < 0.1) {
    await pool.query('DELETE FROM oauth_state WHERE expires_at < NOW()').catch(() => {});
  }

  await pool.query(
    'INSERT INTO oauth_state (state_id, nonce, code_verifier, expires_at) VALUES ($1, $2, $3, $4)',
    [state, nonce, codeVerifier, expiresAt]
  );
}

/**
 * Retrieve and delete OAuth state from database (one-time use)
 *
 * @returns State data if valid and not expired, null otherwise
 */
export async function consumeOAuthState(
  state: string
): Promise<{ nonce: string; codeVerifier: string } | null> {
  // Validate state format before database query
  if (!isValidStateFormat(state)) {
    return null;
  }

  const result = await pool.query<OAuthStateRow>(
    'DELETE FROM oauth_state WHERE state_id = $1 AND expires_at > NOW() RETURNING nonce, code_verifier',
    [state]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    nonce: row.nonce,
    codeVerifier: row.code_verifier,
  };
}
