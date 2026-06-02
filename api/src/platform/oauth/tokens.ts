// OAuth token service validates PlugForge /api/v1 bearer tokens without using legacy API tokens.
import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/client.js';
import { PUBLIC_API_SCOPES, type PublicApiScope } from '../scopes/registry.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type OAuthAccessTokenContext = {
  tokenId: string;
  appId: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  grantedScopes: PublicApiScope[];
};

export type OAuthAccessTokenValidation =
  | { ok: true; context: OAuthAccessTokenContext }
  | {
      ok: false;
      reason:
        | 'access_token_expired'
        | 'app_inactive'
        | 'invalid_token'
        | 'membership_revoked'
        | 'token_revoked';
    };

type OAuthAccessTokenRow = {
  id: string;
  app_id: string;
  client_id: string;
  user_id: string;
  workspace_id: string;
  granted_scopes: unknown;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  app_is_active: boolean;
  membership_user_id: string | null;
};

export type CreatedOAuthAccessToken = {
  id: string;
  token: string;
  expires_at: Date;
};

type CreatedOAuthAccessTokenRow = {
  id: string;
};

const PUBLIC_SCOPE_SET = new Set<string>(PUBLIC_API_SCOPES);

export function generateOAuthAccessToken(): string {
  return `ship_oat_${crypto.randomBytes(32).toString('hex')}`;
}

export function hashOAuthAccessToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createOAuthAccessToken(
  input: {
    appId: string;
    userId: string;
    workspaceId: string;
    grantedScopes: PublicApiScope[];
    expiresAt: Date;
  },
  db: QueryRunner = pool
): Promise<CreatedOAuthAccessToken> {
  const token = generateOAuthAccessToken();
  const tokenHash = hashOAuthAccessToken(token);
  const result = await db.query<CreatedOAuthAccessTokenRow>(
    `INSERT INTO oauth_access_tokens (app_id, user_id, workspace_id, token_hash, granted_scopes, expires_at)
     SELECT $1, $2, $3, $4, $5, $6
     FROM oauth_apps
     JOIN workspace_memberships wm
       ON wm.workspace_id = oauth_apps.workspace_id
      AND wm.user_id = $2
     WHERE oauth_apps.id = $1
       AND oauth_apps.workspace_id = $3
       AND oauth_apps.requested_scopes @> $5::text[]
     RETURNING id`,
    [
      input.appId,
      input.userId,
      input.workspaceId,
      tokenHash,
      input.grantedScopes,
      input.expiresAt,
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('OAuth access token not allowed for this app, workspace, user, or scope set');
  }

  return { id: row.id, token, expires_at: input.expiresAt };
}

export async function validateOAuthAccessToken(
  token: string,
  db: QueryRunner = pool
): Promise<OAuthAccessTokenValidation> {
  const tokenHash = hashOAuthAccessToken(token);
  const result = await db.query<OAuthAccessTokenRow>(
    `SELECT
       t.id,
       t.app_id,
       a.client_id,
       t.user_id,
       t.workspace_id,
       t.granted_scopes,
       t.expires_at,
       t.revoked_at,
       a.is_active AS app_is_active,
       wm.user_id AS membership_user_id
     FROM oauth_access_tokens t
     JOIN oauth_apps a
       ON a.id = t.app_id
      AND a.workspace_id = t.workspace_id
     LEFT JOIN workspace_memberships wm
       ON wm.user_id = t.user_id
      AND wm.workspace_id = t.workspace_id
     WHERE t.token_hash = $1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) return { ok: false, reason: 'invalid_token' };
  if (row.revoked_at) return { ok: false, reason: 'token_revoked' };
  if (new Date(row.expires_at) <= new Date()) {
    return { ok: false, reason: 'access_token_expired' };
  }
  if (!row.app_is_active) return { ok: false, reason: 'app_inactive' };
  if (!row.membership_user_id) return { ok: false, reason: 'membership_revoked' };

  await db.query('UPDATE oauth_access_tokens SET last_used_at = NOW() WHERE id = $1', [row.id]);

  return {
    ok: true,
    context: {
      tokenId: row.id,
      appId: row.app_id,
      clientId: row.client_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      grantedScopes: normalizeGrantedScopes(row.granted_scopes),
    },
  };
}

function normalizeGrantedScopes(scopes: unknown): PublicApiScope[] {
  if (!Array.isArray(scopes)) return [];
  return scopes.filter(
    (scope): scope is PublicApiScope => typeof scope === 'string' && PUBLIC_SCOPE_SET.has(scope)
  );
}
