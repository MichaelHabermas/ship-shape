// Device Authorization Grant code issuance, verification, approval, and token exchange.
import type { OAuthDeviceAuthorizationCode, OAuthDeviceVerificationRequest, OAuthTokenResponse } from '@ship/shared';
import type { PoolClient } from 'pg';
import { pool } from '../../db/client.js';
import { findActiveOAuthAppByClientId, upsertGrant } from './grants.js';
import { createTokenPair } from './refresh-rotation.js';
import { generateDeviceCode, generateUserCode, hashOAuthSecret } from './secrets.js';
import { normalizeDeviceUserCode, normalizeScopes, parseOAuthScope } from './scopes.js';
import {
  DEVICE_AUTHORIZATION_TTL_MS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DEVICE_SLOW_DOWN_INCREMENT_SECONDS,
  OAuthProviderError,
  type DeviceAuthorizationRow,
  type GrantRow,
  type QueryRunner,
} from './types.js';

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
