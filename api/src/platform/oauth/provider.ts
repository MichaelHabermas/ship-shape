// OAuth provider service owns Authorization Code, Device Grant, grants, codes, and refresh rotation.
import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import type {
  OAuthConsentRequest,
  OAuthDeviceAuthorizationCode,
  OAuthDeviceVerificationRequest,
  OAuthErrorCode,
  OAuthTokenResponse,
  PublicApiScope,
} from '@ship/shared';
import { pool } from '../../db/client.js';
import { isPublicApiScope } from '../scopes/registry.js';
import { createOAuthAccessToken } from './tokens.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
const DEVICE_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const DEVICE_POLL_INTERVAL_SECONDS = 5;
const DEVICE_SLOW_DOWN_INCREMENT_SECONDS = 5;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_FAMILY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class OAuthProviderError extends Error {
  readonly oauthCode: OAuthErrorCode;
  readonly status: number;

  constructor(oauthCode: OAuthErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'OAuthProviderError';
    this.oauthCode = oauthCode;
    this.status = status;
  }
}

type OAuthAppRow = {
  id: string;
  workspace_id: string;
  name: string;
  client_id: string;
  redirect_uris: string[];
  requested_scopes: unknown;
  is_active: boolean;
};

type AuthorizationRequestRow = {
  id: string;
  app_id: string;
  user_id: string;
  workspace_id: string;
  client_id: string;
  redirect_uri: string;
  requested_scopes: unknown;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: Date | string;
  approved_at: Date | string | null;
  denied_at: Date | string | null;
  app_name: string;
  app_active: boolean;
};

type GrantRow = {
  id: string;
  granted_scopes: unknown;
};

type AuthorizationCodeRow = GrantRow & {
  grant_id: string;
  app_id: string;
  user_id: string;
  workspace_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  app_active: boolean;
};

type RefreshTokenRow = GrantRow & {
  family_id: string;
  grant_id: string;
  app_id: string;
  user_id: string;
  workspace_id: string;
  client_id: string;
  token_expires_at: Date | string;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
  family_expires_at: Date | string;
  invalidated_at: Date | string | null;
  app_active: boolean;
};

type DeviceAuthorizationRow = {
  id: string;
  app_id: string;
  workspace_id: string;
  client_id: string;
  requested_scopes: unknown;
  interval_seconds: number;
  last_polled_at: Date | string | null;
  expires_at: Date | string;
  authorized_user_id: string | null;
  grant_id: string | null;
  authorized_at: Date | string | null;
  denied_at: Date | string | null;
  consumed_at: Date | string | null;
  app_name: string;
  app_active: boolean;
};

export type AuthorizationRequestInput = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  userId: string;
  workspaceId: string;
};

export type CreatedAuthorizationRequest = {
  requestId: string;
};

export type ApprovedAuthorizationRequest = {
  redirectUrl: string;
  code: string;
};

export function generateAuthorizationCode(): string {
  return `ship_oac_${crypto.randomBytes(32).toString('hex')}`;
}

export function generateRefreshToken(): string {
  return `ship_ort_${crypto.randomBytes(32).toString('hex')}`;
}

export function generateDeviceCode(): string {
  return `ship_odc_${crypto.randomBytes(32).toString('hex')}`;
}

export function generateUserCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function hashOAuthSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function parseOAuthScope(scope: string): PublicApiScope[] {
  const scopes = scope
    .split(/\s+/)
    .map(value => value.trim())
    .filter(Boolean);

  if (scopes.length === 0) {
    throw new OAuthProviderError('invalid_scope', 'At least one scope is required');
  }

  const uniqueScopes = [...new Set(scopes)];
  const publicScopes: PublicApiScope[] = [];
  for (const value of uniqueScopes) {
    if (!isPublicApiScope(value)) {
      throw new OAuthProviderError('invalid_scope', `Unknown scope: ${value}`);
    }
    publicScopes.push(value);
  }

  return publicScopes;
}

export async function createAuthorizationRequest(
  input: AuthorizationRequestInput,
  db: QueryRunner = pool
): Promise<CreatedAuthorizationRequest> {
  if (input.responseType !== 'code') {
    throw new OAuthProviderError('invalid_request', 'response_type must be code');
  }
  if (input.codeChallengeMethod !== 'S256') {
    throw new OAuthProviderError('invalid_request', 'code_challenge_method must be S256');
  }
  if (!isValidPkceChallenge(input.codeChallenge)) {
    throw new OAuthProviderError('invalid_request', 'Invalid code_challenge');
  }

  const requestedScopes = parseOAuthScope(input.scope);
  const app = await findActiveOAuthAppByClientId(input.clientId, db);
  if (!app) {
    throw new OAuthProviderError('invalid_client', 'Invalid client_id');
  }
  if (app.workspace_id !== input.workspaceId) {
    throw new OAuthProviderError('invalid_client', 'OAuth app is not in the active workspace');
  }
  if (!app.redirect_uris.includes(input.redirectUri)) {
    throw new OAuthProviderError('invalid_request', 'Invalid redirect_uri');
  }

  const appScopes = normalizeScopes(app.requested_scopes);
  const disallowedScope = requestedScopes.find(scope => !appScopes.includes(scope));
  if (disallowedScope) {
    throw new OAuthProviderError('invalid_scope', `Scope not registered for this app: ${disallowedScope}`);
  }

  const membership = await db.query(
    `SELECT 1
     FROM workspace_memberships
     WHERE workspace_id = $1
       AND user_id = $2`,
    [app.workspace_id, input.userId]
  );
  if (!membership.rows[0]) {
    throw new OAuthProviderError('invalid_client', 'User is not a member of the app workspace');
  }

  const result = await db.query<{ id: string }>(
    `INSERT INTO oauth_authorization_requests (
       app_id,
       user_id,
       workspace_id,
       client_id,
       redirect_uri,
       requested_scopes,
       state,
       code_challenge,
       code_challenge_method,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'S256', $9)
     RETURNING id`,
    [
      app.id,
      input.userId,
      input.workspaceId,
      input.clientId,
      input.redirectUri,
      requestedScopes,
      input.state ?? null,
      input.codeChallenge,
      new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS),
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('OAuth authorization request insert did not return a row');
  }

  return { requestId: row.id };
}

export async function createDeviceAuthorization(input: {
  clientId: string;
  scope: string;
}, db: QueryRunner = pool): Promise<OAuthDeviceAuthorizationCode> {
  const requestedScopes = parseOAuthScope(input.scope);
  const app = await findActiveOAuthAppByClientId(input.clientId, db);
  if (!app) {
    throw new OAuthProviderError('invalid_client', 'Invalid client_id');
  }

  const appScopes = normalizeScopes(app.requested_scopes);
  const disallowedScope = requestedScopes.find(scope => !appScopes.includes(scope));
  if (disallowedScope) {
    throw new OAuthProviderError('invalid_scope', `Scope not registered for this app: ${disallowedScope}`);
  }

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  await db.query(
    `INSERT INTO oauth_device_authorizations (
       app_id,
       workspace_id,
       client_id,
       device_code_hash,
       user_code_hash,
       requested_scopes,
       interval_seconds,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      app.id,
      app.workspace_id,
      app.client_id,
      hashOAuthSecret(deviceCode),
      hashOAuthSecret(normalizeDeviceUserCode(userCode)),
      requestedScopes,
      DEVICE_POLL_INTERVAL_SECONDS,
      new Date(Date.now() + DEVICE_AUTHORIZATION_TTL_MS),
    ]
  );

  return {
    device_code: deviceCode,
    user_code: userCode,
    expires_in: DEVICE_AUTHORIZATION_TTL_MS / 1000,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  };
}

export async function getDeviceVerificationRequest(input: {
  userCode: string;
  userId: string;
  workspaceId: string;
}, db: QueryRunner = pool): Promise<OAuthDeviceVerificationRequest> {
  const request = await findPendingDeviceAuthorization(input.userCode, input.workspaceId, db);
  const existingGrant = await db.query<GrantRow>(
    `SELECT granted_scopes
     FROM oauth_grants
     WHERE app_id = $1
       AND user_id = $2
       AND workspace_id = $3
       AND revoked_at IS NULL`,
    [request.app_id, input.userId, input.workspaceId]
  );
  const requestedScopes = normalizeScopes(request.requested_scopes);
  const previouslyGrantedScopes = normalizeScopes(existingGrant.rows[0]?.granted_scopes);
  return {
    app: {
      name: request.app_name,
      client_id: request.client_id,
    },
    requested_scopes: requestedScopes,
    previously_granted_scopes: previouslyGrantedScopes,
    new_scopes: requestedScopes.filter(scope => !previouslyGrantedScopes.includes(scope)),
    expires_at: new Date(request.expires_at).toISOString(),
  };
}

export async function approveDeviceAuthorization(input: {
  userCode: string;
  userId: string;
  workspaceId: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await findPendingDeviceAuthorization(input.userCode, input.workspaceId, client, true);
    const grant = await upsertGrant({
      appId: request.app_id,
      userId: input.userId,
      workspaceId: input.workspaceId,
      requestedScopes: normalizeScopes(request.requested_scopes),
    }, client);
    await client.query(
      `UPDATE oauth_device_authorizations
       SET authorized_user_id = $2,
           grant_id = $3,
           authorized_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [request.id, input.userId, grant.id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getConsentRequest(
  requestId: string,
  userId: string,
  workspaceId: string,
  db: QueryRunner = pool
): Promise<OAuthConsentRequest> {
  const request = await findPendingAuthorizationRequest(requestId, userId, workspaceId, db);
  const existingGrant = await db.query<GrantRow>(
    `SELECT granted_scopes
     FROM oauth_grants
     WHERE app_id = $1
       AND user_id = $2
       AND workspace_id = $3
       AND revoked_at IS NULL`,
    [request.app_id, userId, workspaceId]
  );

  const requestedScopes = normalizeScopes(request.requested_scopes);
  const previouslyGrantedScopes = normalizeScopes(existingGrant.rows[0]?.granted_scopes);
  return {
    request_id: request.id,
    app: {
      name: request.app_name,
      client_id: request.client_id,
    },
    redirect_uri: request.redirect_uri,
    requested_scopes: requestedScopes,
    previously_granted_scopes: previouslyGrantedScopes,
    new_scopes: requestedScopes.filter(scope => !previouslyGrantedScopes.includes(scope)),
  };
}

export async function approveAuthorizationRequest(
  requestId: string,
  userId: string,
  workspaceId: string
): Promise<ApprovedAuthorizationRequest> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await findPendingAuthorizationRequest(requestId, userId, workspaceId, client, true);
    const requestedScopes = normalizeScopes(request.requested_scopes);
    const grant = await upsertGrant({
      appId: request.app_id,
      userId,
      workspaceId,
      requestedScopes,
    }, client);
    const code = generateAuthorizationCode();
    const codeHash = hashOAuthSecret(code);
    await client.query(
      `INSERT INTO oauth_authorization_codes (
         authorization_request_id,
         grant_id,
         app_id,
         user_id,
         workspace_id,
         code_hash,
         redirect_uri,
         granted_scopes,
         state,
         code_challenge,
         code_challenge_method,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'S256', $11)`,
      [
        request.id,
        grant.id,
        request.app_id,
        userId,
        workspaceId,
        codeHash,
        request.redirect_uri,
        requestedScopes,
        request.state,
        request.code_challenge,
        new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
      ]
    );
    await client.query(
      `UPDATE oauth_authorization_requests
       SET approved_at = NOW()
       WHERE id = $1`,
      [request.id]
    );
    await client.query('COMMIT');

    return {
      code,
      redirectUrl: appendOAuthRedirectParams(request.redirect_uri, code, request.state),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

export async function exchangeDeviceCode(input: {
  clientId: string;
  deviceCode: string;
}): Promise<OAuthTokenResponse> {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const deviceResult = await client.query<DeviceAuthorizationRow>(
      `SELECT
         d.id,
         d.app_id,
         d.workspace_id,
         d.client_id,
         d.requested_scopes,
         d.interval_seconds,
         d.last_polled_at,
         d.expires_at,
         d.authorized_user_id,
         d.grant_id,
         d.authorized_at,
         d.denied_at,
         d.consumed_at,
         a.name AS app_name,
         a.is_active AS app_active
       FROM oauth_device_authorizations d
       JOIN oauth_apps a ON a.id = d.app_id AND a.workspace_id = d.workspace_id
       WHERE d.device_code_hash = $1
       FOR UPDATE OF d`,
      [hashOAuthSecret(input.deviceCode)]
    );
    const row = deviceResult.rows[0];
    if (!row || row.client_id !== input.clientId || !row.app_active || row.consumed_at) {
      throw new OAuthProviderError('invalid_grant', 'Invalid device_code');
    }
    if (new Date(row.expires_at) <= new Date()) {
      throw new OAuthProviderError('expired_token', 'Device code expired');
    }
    if (row.denied_at) {
      throw new OAuthProviderError('access_denied', 'Device authorization denied');
    }
    if (!row.authorized_at || !row.authorized_user_id || !row.grant_id) {
      const pendingError = await recordDevicePoll(row, client);
      await client.query('COMMIT');
      committed = true;
      throw pendingError;
    }

    const tokenResponse = await createTokenPair({
      appId: row.app_id,
      grantId: row.grant_id,
      userId: row.authorized_user_id,
      workspaceId: row.workspace_id,
      scopes: normalizeScopes(row.requested_scopes),
    }, client);
    await client.query(
      `UPDATE oauth_device_authorizations
       SET consumed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
    await client.query('COMMIT');
    committed = true;
    return tokenResponse;
  } catch (error) {
    if (!committed) {
      await client.query('ROLLBACK').catch(() => {});
    }
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

async function createTokenPair(
  input: {
    appId: string;
    grantId: string;
    userId: string;
    workspaceId: string;
    scopes: PublicApiScope[];
  },
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

async function recordDevicePoll(row: DeviceAuthorizationRow, db: PoolClient): Promise<OAuthProviderError> {
  const now = Date.now();
  const lastPolledAt = row.last_polled_at ? new Date(row.last_polled_at).getTime() : 0;
  const minimumNextPollAt = lastPolledAt + row.interval_seconds * 1000;
  if (lastPolledAt > 0 && now < minimumNextPollAt) {
    await db.query(
      `UPDATE oauth_device_authorizations
       SET interval_seconds = interval_seconds + $2,
           slow_down_count = slow_down_count + 1,
           last_polled_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [row.id, DEVICE_SLOW_DOWN_INCREMENT_SECONDS]
    );
    return new OAuthProviderError('slow_down', 'Polling too quickly');
  }

  await db.query(
    `UPDATE oauth_device_authorizations
     SET last_polled_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [row.id]
  );
  return new OAuthProviderError('authorization_pending', 'Device authorization is still pending');
}

async function findPendingDeviceAuthorization(
  userCode: string,
  workspaceId: string,
  db: QueryRunner,
  forUpdate = false
): Promise<DeviceAuthorizationRow> {
  const result = await db.query<DeviceAuthorizationRow>(
    `SELECT
       d.id,
       d.app_id,
       d.workspace_id,
       d.client_id,
       d.requested_scopes,
       d.interval_seconds,
       d.last_polled_at,
       d.expires_at,
       d.authorized_user_id,
       d.grant_id,
       d.authorized_at,
       d.denied_at,
       d.consumed_at,
       a.name AS app_name,
       a.is_active AS app_active
     FROM oauth_device_authorizations d
     JOIN oauth_apps a ON a.id = d.app_id AND a.workspace_id = d.workspace_id
     WHERE d.user_code_hash = $1
       AND d.workspace_id = $2
     ${forUpdate ? 'FOR UPDATE OF d' : ''}`,
    [hashOAuthSecret(normalizeDeviceUserCode(userCode)), workspaceId]
  );
  const row = result.rows[0];
  if (
    !row ||
    !row.app_active ||
    row.authorized_at ||
    row.denied_at ||
    row.consumed_at ||
    new Date(row.expires_at) <= new Date()
  ) {
    throw new OAuthProviderError('invalid_request', 'Device authorization request not found');
  }
  return row;
}

async function findActiveOAuthAppByClientId(
  clientId: string,
  db: QueryRunner
): Promise<OAuthAppRow | null> {
  const result = await db.query<OAuthAppRow>(
    `SELECT id, workspace_id, name, client_id, redirect_uris, requested_scopes, is_active
     FROM oauth_apps
     WHERE client_id = $1
       AND is_active = TRUE`,
    [clientId]
  );
  return result.rows[0] ?? null;
}

async function findPendingAuthorizationRequest(
  requestId: string,
  userId: string,
  workspaceId: string,
  db: QueryRunner,
  forUpdate = false
): Promise<AuthorizationRequestRow> {
  const result = await db.query<AuthorizationRequestRow>(
    `SELECT
       r.id,
       r.app_id,
       r.user_id,
       r.workspace_id,
       r.client_id,
       r.redirect_uri,
       r.requested_scopes,
       r.state,
       r.code_challenge,
       r.code_challenge_method,
       r.expires_at,
       r.approved_at,
       r.denied_at,
       a.name AS app_name,
       a.is_active AS app_active
     FROM oauth_authorization_requests r
     JOIN oauth_apps a ON a.id = r.app_id AND a.workspace_id = r.workspace_id
     WHERE r.id = $1
       AND r.user_id = $2
       AND r.workspace_id = $3
     ${forUpdate ? 'FOR UPDATE OF r' : ''}`,
    [requestId, userId, workspaceId]
  );
  const row = result.rows[0];
  if (
    !row ||
    !row.app_active ||
    row.approved_at ||
    row.denied_at ||
    new Date(row.expires_at) <= new Date()
  ) {
    throw new OAuthProviderError('invalid_request', 'Authorization request not found');
  }
  return row;
}

async function upsertGrant(
  input: {
    appId: string;
    userId: string;
    workspaceId: string;
    requestedScopes: PublicApiScope[];
  },
  db: PoolClient
): Promise<GrantRow> {
  const existing = await db.query<GrantRow>(
    `SELECT id, granted_scopes
     FROM oauth_grants
     WHERE app_id = $1
       AND user_id = $2
       AND workspace_id = $3
       AND revoked_at IS NULL
     FOR UPDATE`,
    [input.appId, input.userId, input.workspaceId]
  );
  const mergedScopes = mergeScopes(normalizeScopes(existing.rows[0]?.granted_scopes), input.requestedScopes);
  const result = await db.query<GrantRow>(
    `INSERT INTO oauth_grants (
       app_id,
       user_id,
       workspace_id,
       granted_scopes
     )
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (app_id, user_id, workspace_id)
     DO UPDATE
       SET granted_scopes = $4,
           revoked_at = NULL,
           updated_at = NOW()
     RETURNING id, granted_scopes`,
    [input.appId, input.userId, input.workspaceId, mergedScopes]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('OAuth grant upsert did not return a row');
  }
  return row;
}

async function invalidateRefreshTokenFamily(
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

function normalizeScopes(scopes: unknown): PublicApiScope[] {
  if (!Array.isArray(scopes)) return [];
  return scopes.filter(
    (scope): scope is PublicApiScope => typeof scope === 'string' && isPublicApiScope(scope)
  );
}

function mergeScopes(currentScopes: PublicApiScope[], requestedScopes: PublicApiScope[]): PublicApiScope[] {
  return [...new Set([...currentScopes, ...requestedScopes])];
}

function normalizeDeviceUserCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function appendOAuthRedirectParams(redirectUri: string, code: string, state: string | null): string {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) {
    url.searchParams.set('state', state);
  }
  return url.toString();
}

function isAuthorizationCodeUsable(row: AuthorizationCodeRow): boolean {
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

function isValidPkceChallenge(value: string): boolean {
  return value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isValidPkceVerifier(value: string): boolean {
  return value.length >= 43 && value.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(value);
}

function pkceVerifierMatchesChallenge(verifier: string, expectedChallenge: string): boolean {
  const actualChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const actual = Buffer.from(actualChallenge);
  const expected = Buffer.from(expectedChallenge);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
