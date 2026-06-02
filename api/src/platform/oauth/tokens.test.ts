// OAuth token service tests cover denial reasons outside the /api/v1/me happy path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../db/client.js';
import { createOAuthAccessToken, validateOAuthAccessToken } from './tokens.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';

describe('OAuth access token validation', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `oauth-token-${testRunId}@ship.local`;

  let workspaceId: string;
  let userId: string;
  let activeAppId: string;
  let inactiveAppId: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`OAuth Token ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'OAuth Token User')
       RETURNING id`,
      [testEmail]
    );
    userId = requireFirstRow(userResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [workspaceId, userId]
    );

    activeAppId = await insertApp('active', true);
    inactiveAppId = await insertApp('inactive', false);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('rejects revoked tokens', async () => {
    const created = await createOAuthAccessToken({
      appId: activeAppId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await pool.query('UPDATE oauth_access_tokens SET revoked_at = NOW() WHERE id = $1', [created.id]);

    await expect(validateOAuthAccessToken(created.token)).resolves.toEqual({
      ok: false,
      reason: 'token_revoked',
    });
  });

  it('rejects tokens for inactive apps', async () => {
    const created = await createOAuthAccessToken({
      appId: inactiveAppId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(validateOAuthAccessToken(created.token)).resolves.toEqual({
      ok: false,
      reason: 'app_inactive',
    });
  });

  it('does not mint tokens for scopes the app did not request', async () => {
    await expect(createOAuthAccessToken({
      appId: activeAppId,
      userId,
      workspaceId,
      grantedScopes: ['documents:write'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).rejects.toThrow('OAuth access token not allowed');
  });

  it('does not mint tokens across app workspace boundaries', async () => {
    const otherWorkspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`OAuth Token Other ${testRunId}`]
    );
    const otherWorkspaceId = requireFirstRow(otherWorkspaceResult.rows).id;

    try {
      await expect(createOAuthAccessToken({
        appId: activeAppId,
        userId,
        workspaceId: otherWorkspaceId,
        grantedScopes: ['documents:read'],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })).rejects.toThrow('OAuth access token not allowed');
    } finally {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId]);
    }
  });

  it('does not mint tokens for users outside the app workspace', async () => {
    const outsiderResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'OAuth Token Outsider')
       RETURNING id`,
      [`oauth-token-outsider-${testRunId}@ship.local`]
    );
    const outsiderUserId = requireFirstRow(outsiderResult.rows).id;

    try {
      await expect(createOAuthAccessToken({
        appId: activeAppId,
        userId: outsiderUserId,
        workspaceId,
        grantedScopes: ['documents:read'],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })).rejects.toThrow('OAuth access token not allowed');
    } finally {
      await pool.query('DELETE FROM users WHERE id = $1', [outsiderUserId]);
    }
  });

  it('rejects tokens when workspace membership is gone', async () => {
    const created = await createOAuthAccessToken({
      appId: activeAppId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await pool.query(
      'DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    await expect(validateOAuthAccessToken(created.token)).resolves.toEqual({
      ok: false,
      reason: 'membership_revoked',
    });
  });

  async function insertApp(name: string, isActive: boolean): Promise<string> {
    const result = await pool.query<IdRow>(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes,
         is_active
       )
       VALUES ($1, $2, $3, $4, 'test-secret-hash', $5, $6, $7)
       RETURNING id`,
      [
        workspaceId,
        userId,
        `Token ${name} ${testRunId}`,
        `ship_app_${name}_${testRunId}`,
        ['https://example.test/callback'],
        ['documents:read'],
        isActive,
      ]
    );
    return requireFirstRow(result.rows).id;
  }
});
