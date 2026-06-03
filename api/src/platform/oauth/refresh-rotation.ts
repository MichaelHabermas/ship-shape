// OAuth refresh rotation and initial token-pair issuance for code and device grants.
import type { PoolClient } from 'pg';
import type { OAuthTokenResponse } from '@ship/shared';
import { pool } from '../../db/client.js';
import { isValidPkceVerifier, pkceVerifierMatchesChallenge } from './pkce.js';
import { generateRefreshToken, hashOAuthSecret } from './secrets.js';
import { normalizeScopes } from './scopes.js';
import { createOAuthAccessToken } from './tokens.js';
import {
  ACCESS_TOKEN_TTL_MS,
  OAuthProviderError,
  REFRESH_TOKEN_FAMILY_TTL_MS,
  type AuthorizationCodeRow,
  type RefreshTokenRow,
  type TokenPairInput,
} from './types.js';

export function isAuthorizationCodeUsable(row: AuthorizationCodeRow): boolean {
  return !row.consumed_at && new Date(row.expires_at) > new Date();
}

function isRefreshTokenUsable(row: RefreshTokenRow): boolean {
  return Boolean(
    row.app_active &&
    !row.used_at &&
    !row.revoked_at &&
    !row.invalidated_at &&
    new Date(row.token_expires_at) > new Date() &&
    new Date(row.family_expires_at) > new Date()
  );
}

export async function invalidateRefreshTokenFamily(
  familyId: string,
  reason: string,
  db: PoolClient
): Promise<void> {
  await db.query(
    `UPDATE oauth_refresh_token_families
     SET invalidated_at = COALESCE(invalidated_at, NOW()),
         invalidated_reason = COALESCE(invalidated_reason, $2)
     WHERE id = $1`,
    [familyId, reason]
  );
  await db.query(
    `UPDATE oauth_access_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE refresh_token_family_id = $1`,
    [familyId]
  );
}

export async function createTokenPair(
  input: TokenPairInput,
  db: PoolClient
): Promise<OAuthTokenResponse> {
  const familyExpiresAt = new Date(Date.now() + REFRESH_TOKEN_FAMILY_TTL_MS);
  const familyResult = await db.query<{ id: string }>(
    `INSERT INTO oauth_refresh_token_families (
       grant_id,
       app_id,
       user_id,
       workspace_id,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.grantId, input.appId, input.userId, input.workspaceId, familyExpiresAt]
  );
  const familyId = familyResult.rows[0]?.id;
  if (!familyId) {
    throw new Error('OAuth refresh token family insert did not return a row');
  }

  const refreshToken = generateRefreshToken();
  await db.query(
    `INSERT INTO oauth_refresh_tokens (
       family_id,
       app_id,
       user_id,
       workspace_id,
       token_hash,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      familyId,
      input.appId,
      input.userId,
      input.workspaceId,
      hashOAuthSecret(refreshToken),
      familyExpiresAt,
    ]
  );
  const accessToken = await createOAuthAccessToken({
    appId: input.appId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    grantedScopes: input.scopes,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    grantId: input.grantId,
    refreshTokenFamilyId: familyId,
  }, db);

  return {
    access_token: accessToken.token,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    refresh_token: refreshToken,
    scope: input.scopes.join(' '),
  };
}

export async function exchangeAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse> {
  if (!isValidPkceVerifier(input.codeVerifier)) {
    throw new OAuthProviderError('invalid_grant', 'Invalid code_verifier');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const codeHash = hashOAuthSecret(input.code);
    const codeResult = await client.query<AuthorizationCodeRow>(
      `SELECT
         c.id,
         c.grant_id,
         c.app_id,
         c.user_id,
         c.workspace_id,
         a.client_id,
         c.redirect_uri,
         c.granted_scopes,
         c.code_challenge,
         c.code_challenge_method,
         c.expires_at,
         c.consumed_at,
         a.is_active AS app_active
       FROM oauth_authorization_codes c
       JOIN oauth_apps a ON a.id = c.app_id AND a.workspace_id = c.workspace_id
       WHERE c.code_hash = $1
       FOR UPDATE OF c`,
      [codeHash]
    );
    const row = codeResult.rows[0];
    if (!row || !isAuthorizationCodeUsable(row)) {
      throw new OAuthProviderError('invalid_grant', 'Invalid authorization code');
    }
    if (!row.app_active || row.client_id !== input.clientId || row.redirect_uri !== input.redirectUri) {
      throw new OAuthProviderError('invalid_grant', 'Invalid authorization code');
    }
    if (!pkceVerifierMatchesChallenge(input.codeVerifier, row.code_challenge)) {
      throw new OAuthProviderError('invalid_grant', 'Invalid code_verifier');
    }

    await client.query(
      `UPDATE oauth_authorization_codes
       SET consumed_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
    const tokenResponse = await createTokenPair({
      appId: row.app_id,
      grantId: row.grant_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      scopes: normalizeScopes(row.granted_scopes),
    }, client);
    await client.query('COMMIT');
    return tokenResponse;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateRefreshToken(input: {
  clientId: string;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const tokenHash = hashOAuthSecret(input.refreshToken);
    const tokenResult = await client.query<RefreshTokenRow>(
      `SELECT
         rt.id,
         rt.family_id,
         f.grant_id,
         rt.app_id,
         rt.user_id,
         rt.workspace_id,
         a.client_id,
         g.granted_scopes,
         rt.expires_at AS token_expires_at,
         rt.used_at,
         rt.revoked_at,
         f.expires_at AS family_expires_at,
         f.invalidated_at,
         a.is_active AS app_active
       FROM oauth_refresh_tokens rt
       JOIN oauth_refresh_token_families f ON f.id = rt.family_id
       JOIN oauth_apps a ON a.id = rt.app_id AND a.workspace_id = rt.workspace_id
       JOIN oauth_grants g ON g.id = f.grant_id
       WHERE rt.token_hash = $1
       FOR UPDATE OF rt, f`,
      [tokenHash]
    );
    const row = tokenResult.rows[0];
    if (!row) {
      throw new OAuthProviderError('invalid_grant', 'Invalid refresh token');
    }
    if (row.used_at) {
      await invalidateRefreshTokenFamily(row.family_id, 'refresh_token_reuse', client);
      await client.query('COMMIT');
      committed = true;
      throw new OAuthProviderError('invalid_grant', 'Invalid refresh token');
    }
    if (!isRefreshTokenUsable(row) || row.client_id !== input.clientId) {
      throw new OAuthProviderError('invalid_grant', 'Invalid refresh token');
    }

    const nextRefreshToken = generateRefreshToken();
    const nextRefreshTokenHash = hashOAuthSecret(nextRefreshToken);
    const nextRefreshResult = await client.query<{ id: string }>(
      `INSERT INTO oauth_refresh_tokens (
         family_id,
         app_id,
         user_id,
         workspace_id,
         token_hash,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        row.family_id,
        row.app_id,
        row.user_id,
        row.workspace_id,
        nextRefreshTokenHash,
        row.family_expires_at,
      ]
    );
    const nextRefreshId = nextRefreshResult.rows[0]?.id;
    if (!nextRefreshId) {
      throw new Error('OAuth refresh token rotation did not return a row');
    }
    await client.query(
      `UPDATE oauth_refresh_tokens
       SET used_at = NOW(),
           replaced_by_token_id = $2
       WHERE id = $1`,
      [row.id, nextRefreshId]
    );

    const accessToken = await createOAuthAccessToken({
      appId: row.app_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      grantedScopes: normalizeScopes(row.granted_scopes),
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
      grantId: row.grant_id,
      refreshTokenFamilyId: row.family_id,
    }, client);
    await client.query('COMMIT');
    committed = true;
    return {
      access_token: accessToken.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      refresh_token: nextRefreshToken,
      scope: normalizeScopes(row.granted_scopes).join(' '),
    };
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK');
    }
    throw error;
  } finally {
    client.release();
  }
}
