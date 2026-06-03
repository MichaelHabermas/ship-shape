// OAuth app service owns client ids, shown-once secrets, and app registration persistence.
import crypto from 'crypto';
import argon2 from 'argon2';
import type { Pool, PoolClient } from 'pg';
import type { PublicApiScope } from '@ship/shared';
import { pool } from '../../db/client.js';
import { isPublicApiScope } from '../scopes/registry.js';
import { SHIP_AGENT_READ_SCOPES } from '../oauth/ship-agent-scopes.js';
import type { PublicCursorPayload } from '../api/v1/pagination.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;
const CLIENT_SECRET_GRACE_MS = 24 * 60 * 60 * 1000;
export const SHIP_AGENT_SYSTEM_KEY = 'ship-agent';
/** @deprecated Prefer SHIP_AGENT_READ_SCOPES from ship-agent-scopes.ts */
export const SHIP_AGENT_SCOPES = SHIP_AGENT_READ_SCOPES;

export type CreateOAuthAppInput = {
  workspaceId: string;
  ownerUserId: string;
  name: string;
  redirectUris: string[];
  requestedScopes: PublicApiScope[];
};

export type CreatedOAuthApp = {
  id: string;
  client_id: string;
  client_secret: string;
  client_secret_id: string;
  name: string;
  redirect_uris: string[];
  requested_scopes: PublicApiScope[];
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export type OAuthAppSecretSummary = {
  id: string;
  status: 'active' | 'grace' | 'revoked';
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type OAuthAppSummary = Omit<CreatedOAuthApp, 'client_secret' | 'client_secret_id'> & {
  secrets: OAuthAppSecretSummary[];
};

export type RotatedOAuthAppSecret = {
  app_id: string;
  client_secret_id: string;
  client_secret: string;
  previous_secret_expires_at: string | null;
  warning: string;
};

export type PublicApiAuditLogSummary = {
  id: string;
  request_id: string;
  client_id: string | null;
  user_id: string | null;
  method: string;
  route: string;
  scope_used: string | null;
  status: number;
  latency_ms: number;
  error_code: string | null;
  rate_limited: boolean;
  created_at: string;
};

export type FirstPartyOAuthApp = {
  id: string;
  client_id: string;
  requested_scopes: PublicApiScope[];
};

type OAuthAppRow = {
  id: string;
  client_id: string;
  name: string;
  redirect_uris: string[];
  requested_scopes: unknown;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type OAuthAppSecretRow = {
  id: string;
  status: 'active' | 'grace' | 'revoked';
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

type PublicApiAuditLogRow = {
  id: string;
  request_id: string;
  client_id: string | null;
  user_id: string | null;
  method: string;
  route: string;
  scope_used: string | null;
  status: number;
  latency_ms: number;
  error_code: string | null;
  created_at: Date;
};

type FirstPartyOAuthAppRow = {
  id: string;
  client_id: string;
  requested_scopes: unknown;
};

export function generateOAuthClientId(): string {
  return `ship_app_${crypto.randomBytes(16).toString('hex')}`;
}

export function generateOAuthClientSecret(): string {
  return `ship_secret_${crypto.randomBytes(32).toString('hex')}`;
}

export async function hashOAuthClientSecret(secret: string): Promise<string> {
  return argon2.hash(secret, { type: argon2.argon2id });
}

export async function verifyOAuthClientSecret(hash: string, secret: string): Promise<boolean> {
  return argon2.verify(hash, secret);
}

export async function createOAuthApp(input: CreateOAuthAppInput): Promise<CreatedOAuthApp> {
  const clientId = generateOAuthClientId();
  const clientSecret = generateOAuthClientSecret();
  const clientSecretHash = await hashOAuthClientSecret(clientSecret);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<OAuthAppRow>(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, client_id, name, redirect_uris, requested_scopes, is_active, created_at, updated_at`,
      [
        input.workspaceId,
        input.ownerUserId,
        input.name,
        clientId,
        clientSecretHash,
        input.redirectUris,
        input.requestedScopes,
      ]
    );

    const row = requireRow(result.rows[0], 'OAuth app insert did not return a row');
    const secretResult = await client.query<{ id: string }>(
      `INSERT INTO oauth_app_secrets (
         app_id,
         workspace_id,
         secret_hash,
         status,
         created_by
       )
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING id`,
      [row.id, input.workspaceId, clientSecretHash, input.ownerUserId]
    );
    const secret = requireRow(secretResult.rows[0], 'OAuth app secret insert did not return a row');
    await client.query('COMMIT');

    return {
      ...publicAppFromRow(row),
      client_secret: clientSecret,
      client_secret_id: secret.id,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureShipAgentOAuthApp(
  input: { workspaceId: string },
  db: QueryRunner = pool
): Promise<FirstPartyOAuthApp> {
  const result = await db.query<FirstPartyOAuthAppRow>(
    `INSERT INTO oauth_apps (
       workspace_id,
       owner_user_id,
       name,
       client_id,
       client_secret_hash,
       redirect_uris,
       requested_scopes,
       is_first_party,
       system_key
     )
     VALUES (
       $1,
       NULL,
       'Ship Agent',
       $2,
       'first-party-agent-no-client-secret',
       $3,
       $4,
       TRUE,
       $5
     )
     ON CONFLICT (workspace_id, system_key) WHERE system_key IS NOT NULL
     DO UPDATE SET
       name = EXCLUDED.name,
       requested_scopes = EXCLUDED.requested_scopes,
       is_first_party = TRUE,
       updated_at = NOW()
     RETURNING id, client_id, requested_scopes`,
    [
      input.workspaceId,
      shipAgentClientId(input.workspaceId),
      ['https://ship.local/first-party/ship-agent'],
      [...SHIP_AGENT_SCOPES],
      SHIP_AGENT_SYSTEM_KEY,
    ]
  );
  const row = requireRow(result.rows[0], 'Ship Agent OAuth app upsert did not return a row');
  return {
    id: row.id,
    client_id: row.client_id,
    requested_scopes: normalizeScopes(row.requested_scopes),
  };
}

export async function listOAuthApps(input: {
  workspaceId: string;
}): Promise<OAuthAppSummary[]> {
  await revokeExpiredGraceSecrets(input.workspaceId);
  const apps = await pool.query<OAuthAppRow>(
    `SELECT id, client_id, name, redirect_uris, requested_scopes, is_active, created_at, updated_at
     FROM oauth_apps
     WHERE workspace_id = $1
     ORDER BY created_at DESC, id::text DESC`,
    [input.workspaceId]
  );
  const appIds = apps.rows.map(app => app.id);
  if (appIds.length === 0) return [];

  const secrets = await pool.query<OAuthAppSecretRow & { app_id: string }>(
    `SELECT app_id, id, status, expires_at, revoked_at, created_at
     FROM oauth_app_secrets
     WHERE app_id = ANY($1)
     ORDER BY created_at DESC`,
    [appIds]
  );
  const secretsByApp = new Map<string, OAuthAppSecretSummary[]>();
  for (const secret of secrets.rows) {
    const list = secretsByApp.get(secret.app_id) ?? [];
    list.push(publicSecretFromRow(secret));
    secretsByApp.set(secret.app_id, list);
  }

  return apps.rows.map(app => ({
    ...publicAppFromRow(app),
    secrets: secretsByApp.get(app.id) ?? [],
  }));
}

export async function rotateOAuthAppSecret(input: {
  appId: string;
  workspaceId: string;
  actorUserId: string;
  revokePreviousImmediately: boolean;
}): Promise<RotatedOAuthAppSecret> {
  const clientSecret = generateOAuthClientSecret();
  const clientSecretHash = await hashOAuthClientSecret(clientSecret);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await requireOAuthAppInWorkspace(input.appId, input.workspaceId, client, true);
    const previousSecretExpiresAt = input.revokePreviousImmediately
      ? null
      : new Date(Date.now() + CLIENT_SECRET_GRACE_MS);

    if (input.revokePreviousImmediately) {
      await client.query(
        `UPDATE oauth_app_secrets
         SET status = 'revoked',
             revoked_at = COALESCE(revoked_at, NOW()),
             expires_at = NULL,
             updated_at = NOW()
         WHERE app_id = $1
           AND workspace_id = $2
           AND status IN ('active', 'grace')`,
        [input.appId, input.workspaceId]
      );
    } else {
      await client.query(
        `UPDATE oauth_app_secrets
         SET status = 'grace',
             expires_at = $3,
             updated_at = NOW()
         WHERE app_id = $1
           AND workspace_id = $2
           AND status = 'active'`,
        [input.appId, input.workspaceId, previousSecretExpiresAt]
      );
    }

    const secretResult = await client.query<{ id: string }>(
      `INSERT INTO oauth_app_secrets (
         app_id,
         workspace_id,
         secret_hash,
         status,
         created_by
       )
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING id`,
      [input.appId, input.workspaceId, clientSecretHash, input.actorUserId]
    );
    const secret = requireRow(secretResult.rows[0], 'OAuth app secret rotation did not return a row');
    await client.query(
      `UPDATE oauth_apps
       SET client_secret_hash = $3,
           updated_at = NOW()
       WHERE id = $1
         AND workspace_id = $2`,
      [input.appId, input.workspaceId, clientSecretHash]
    );
    await client.query('COMMIT');

    return {
      app_id: input.appId,
      client_secret_id: secret.id,
      client_secret: clientSecret,
      previous_secret_expires_at: previousSecretExpiresAt?.toISOString() ?? null,
      warning: 'Save this client_secret now. It will not be shown again.',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeOAuthAppSecret(input: {
  appId: string;
  secretId: string;
  workspaceId: string;
}): Promise<OAuthAppSecretSummary> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requireOAuthAppInWorkspace(input.appId, input.workspaceId, client, true);
    const existing = await client.query<OAuthAppSecretRow>(
      `SELECT id, status, expires_at, revoked_at, created_at
       FROM oauth_app_secrets
       WHERE id = $1
         AND app_id = $2
         AND workspace_id = $3
       FOR UPDATE`,
      [input.secretId, input.appId, input.workspaceId]
    );
    const secret = existing.rows[0];
    if (!secret) throw new Error('OAUTH_APP_SECRET_NOT_FOUND');
    if (secret.status === 'active') throw new Error('OAUTH_APP_ACTIVE_SECRET_REQUIRED');

    const revoked = await client.query<OAuthAppSecretRow>(
      `UPDATE oauth_app_secrets
       SET status = 'revoked',
           revoked_at = COALESCE(revoked_at, NOW()),
           expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, expires_at, revoked_at, created_at`,
      [input.secretId]
    );
    await client.query('COMMIT');
    return publicSecretFromRow(requireRow(revoked.rows[0], 'OAuth app secret revoke returned no row'));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listPublicApiAuditLogs(input: {
  appId: string;
  workspaceId: string;
  limit: number;
  cursor?: PublicCursorPayload;
}): Promise<PublicApiAuditLogSummary[]> {
  await requireOAuthAppInWorkspace(input.appId, input.workspaceId);
  const values: Array<string | number> = [input.appId, input.workspaceId];
  const cursorClause = input.cursor
    ? `AND (
         created_at < $3::timestamptz
         OR (created_at = $3::timestamptz AND id::text < $4)
       )`
    : '';
  if (input.cursor) values.push(input.cursor.timestamp, input.cursor.id);
  values.push(input.limit);
  const limitParam = values.length;

  const result = await pool.query<PublicApiAuditLogRow>(
    `SELECT id, request_id, client_id, user_id, method, route, scope_used,
            status, latency_ms, error_code, created_at
     FROM public_api_audit_logs
     WHERE app_id = $1
       AND workspace_id = $2
       ${cursorClause}
     ORDER BY created_at DESC, id::text DESC
     LIMIT $${limitParam}`,
    values
  );
  return result.rows.map(publicAuditLogFromRow);
}

export async function requireOAuthAppInWorkspace(
  appId: string,
  workspaceId: string,
  db: QueryRunner = pool,
  forUpdate = false
): Promise<OAuthAppSummary> {
  const result = await db.query<OAuthAppRow>(
    `SELECT id, client_id, name, redirect_uris, requested_scopes, is_active, created_at, updated_at
     FROM oauth_apps
     WHERE id = $1
       AND workspace_id = $2
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [appId, workspaceId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('OAUTH_APP_NOT_FOUND');
  return {
    ...publicAppFromRow(row),
    secrets: [],
  };
}

async function revokeExpiredGraceSecrets(workspaceId: string): Promise<void> {
  await pool.query(
    `UPDATE oauth_app_secrets
     SET status = 'revoked',
         revoked_at = COALESCE(expires_at, NOW()),
         updated_at = NOW()
     WHERE workspace_id = $1
       AND status = 'grace'
       AND expires_at <= NOW()`,
    [workspaceId]
  );
}

function publicAppFromRow(row: OAuthAppRow): Omit<OAuthAppSummary, 'secrets'> {
  return {
    id: row.id,
    client_id: row.client_id,
    name: row.name,
    redirect_uris: row.redirect_uris,
    requested_scopes: normalizeScopes(row.requested_scopes),
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function publicSecretFromRow(row: OAuthAppSecretRow): OAuthAppSecretSummary {
  return {
    id: row.id,
    status: row.status,
    expires_at: row.expires_at?.toISOString() ?? null,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

function publicAuditLogFromRow(row: PublicApiAuditLogRow): PublicApiAuditLogSummary {
  return {
    id: row.id,
    request_id: row.request_id,
    client_id: row.client_id,
    user_id: row.user_id,
    method: row.method,
    route: row.route,
    scope_used: row.scope_used,
    status: row.status,
    latency_ms: row.latency_ms,
    error_code: row.error_code,
    rate_limited: row.status === 429 || row.error_code === 'rate_limited',
    created_at: row.created_at.toISOString(),
  };
}

function normalizeScopes(scopes: unknown): PublicApiScope[] {
  if (!Array.isArray(scopes)) return [];
  return scopes.filter(isPublicApiScope);
}

function shipAgentClientId(workspaceId: string): string {
  return `ship_agent_${workspaceId.replace(/-/g, '')}`;
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
