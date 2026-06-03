// OAuth grant upsert and active app lookup shared by auth-code and device flows.
import type { PoolClient } from 'pg';
import type { PublicApiScope } from '@ship/shared';
import { mergeScopes, normalizeScopes } from './scopes.js';
import type { GrantRow, OAuthAppRow, QueryRunner } from './types.js';

export async function findActiveOAuthAppByClientId(
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

export async function upsertGrant(
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
