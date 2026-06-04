// OAuth app token revocation centralizes issued and exchangeable credential invalidation.
import type { PoolClient } from 'pg';

export async function revokeOAuthAppTokens(
  appId: string,
  workspaceId: string,
  reason: string,
  db: PoolClient
): Promise<number> {
  const accessTokens = await db.query<{ id: string }>(
    `UPDATE oauth_access_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE app_id = $1
       AND workspace_id = $2
       AND revoked_at IS NULL
     RETURNING id`,
    [appId, workspaceId]
  );
  await db.query(
    `UPDATE oauth_refresh_token_families
     SET invalidated_at = COALESCE(invalidated_at, NOW()),
         invalidated_reason = COALESCE(invalidated_reason, $3)
     WHERE app_id = $1
       AND workspace_id = $2
       AND invalidated_at IS NULL`,
    [appId, workspaceId, reason]
  );
  await db.query(
    `UPDATE oauth_refresh_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE app_id = $1
       AND workspace_id = $2
       AND revoked_at IS NULL`,
    [appId, workspaceId]
  );
  await db.query(
    `UPDATE oauth_authorization_codes
     SET consumed_at = COALESCE(consumed_at, NOW())
     WHERE app_id = $1
       AND workspace_id = $2
       AND consumed_at IS NULL`,
    [appId, workspaceId]
  );
  await db.query(
    `UPDATE oauth_authorization_requests
     SET denied_at = COALESCE(denied_at, NOW())
     WHERE app_id = $1
       AND workspace_id = $2
       AND denied_at IS NULL`,
    [appId, workspaceId]
  );
  await db.query(
    `UPDATE oauth_device_authorizations
     SET denied_at = COALESCE(denied_at, NOW()),
         updated_at = NOW()
     WHERE app_id = $1
       AND workspace_id = $2
       AND denied_at IS NULL
       AND consumed_at IS NULL`,
    [appId, workspaceId]
  );
  return accessTokens.rowCount ?? 0;
}
