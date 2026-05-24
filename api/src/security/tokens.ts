import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/client.js';
import type { ApiTokenScope, Principal } from './principal.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export const DEFAULT_API_TOKEN_SCOPES: ApiTokenScope[] = [
  'documents:read',
  'documents:write',
  'documents:content',
  'files:read',
  'files:write',
  'collaboration:join',
];

export const LEGACY_FULL_SCOPE: ApiTokenScope = 'legacy:full';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const token = `ship_${randomBytes}`;
  const hash = hashToken(token);
  const prefix = token.substring(0, 12);
  return { token, hash, prefix };
}

export function normalizeApiTokenScopes(scopes: unknown): ApiTokenScope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) return [LEGACY_FULL_SCOPE];
  return scopes.filter((scope): scope is ApiTokenScope => typeof scope === 'string') as ApiTokenScope[];
}

type TokenRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  is_super_admin: boolean;
  membership_user_id: string | null;
  scopes?: unknown;
};

export async function validateApiToken(
  token: string,
  db: QueryRunner = pool
): Promise<Extract<Principal, { kind: 'api_token' }> | null> {
  const tokenHash = hashToken(token);

  const result = await db.query<TokenRow>(
    `SELECT t.id, t.user_id, t.workspace_id, t.expires_at, t.revoked_at,
            COALESCE(t.scopes, ARRAY['legacy:full']::text[]) AS scopes,
            u.is_super_admin, wm.user_id AS membership_user_id
       FROM api_tokens t
       JOIN users u ON t.user_id = u.id
       LEFT JOIN workspace_memberships wm
         ON wm.user_id = t.user_id
        AND wm.workspace_id = t.workspace_id
      WHERE t.token_hash = $1`,
    [tokenHash]
  );

  const tokenRow = result.rows[0];
  if (!tokenRow) return null;
  if (tokenRow.revoked_at) return null;
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return null;
  if (!tokenRow.is_super_admin && !tokenRow.membership_user_id) return null;

  await db.query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [tokenRow.id]);

  return {
    kind: 'api_token',
    tokenId: tokenRow.id,
    userId: tokenRow.user_id,
    workspaceId: tokenRow.workspace_id,
    isSuperAdmin: tokenRow.is_super_admin,
    scopes: normalizeApiTokenScopes(tokenRow.scopes),
  };
}
