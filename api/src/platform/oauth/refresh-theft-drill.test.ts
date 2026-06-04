// Refresh theft drill proves reused refresh tokens revoke the whole OAuth token family.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { OAuthErrorResponseSchema, OAuthTokenResponseSchema, PublicApiErrorSchema, PublicMeResponseSchema } from '@ship/shared';
import { createApp } from '../../app.js';
import { pool } from '../../db/client.js';
import { expectJsonBody } from '../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';
import { createTokenPair } from './refresh-rotation.js';

describe('refresh-token theft drill', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clientId = `ship_refresh_theft_${testRunId}`;
  let workspaceId: string;
  let userId: string;
  let appId: string;
  let grantId: string;

  beforeAll(async () => {
    workspaceId = requireFirstRow((await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Refresh Theft ${testRunId}`]
    )).rows).id;
    userId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Refresh Theft User')
       RETURNING id`,
      [`refresh-theft-${testRunId}@ship.local`]
    )).rows).id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [workspaceId, userId]
    );
    appId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, 'Refresh Theft App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [workspaceId, userId, clientId, ['https://example.test/callback'], ['documents:read']]
    )).rows).id;
    grantId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO oauth_grants (app_id, user_id, workspace_id, granted_scopes)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [appId, userId, workspaceId, ['documents:read']]
    )).rows).id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2', [workspaceId, clientId]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_refresh_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_refresh_token_families WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_grants WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('invalidates the token family and revokes access tokens when a stolen refresh token is reused', async () => {
    const client = await pool.connect();
    let first: Awaited<ReturnType<typeof createTokenPair>>;
    try {
      await client.query('BEGIN');
      first = await createTokenPair({
        appId,
        grantId,
        userId,
        workspaceId,
        scopes: ['documents:read'],
      }, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    expectJsonBody(await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${first.access_token}`), 200, PublicMeResponseSchema);

    const rotateResponse = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: first.refresh_token,
      });
    const rotated = expectJsonBody(rotateResponse, 200, OAuthTokenResponseSchema);
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    expect(rotated.access_token).not.toBe(first.access_token);

    const theftResponse = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: first.refresh_token,
      });
    const theft = expectJsonBody(theftResponse, 400, OAuthErrorResponseSchema);
    expect(theft.error).toBe('invalid_grant');

    expectJsonBody(await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${first.access_token}`), 401, PublicApiErrorSchema);
    expectJsonBody(await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${rotated.access_token}`), 401, PublicApiErrorSchema);

    const family = requireFirstRow((await pool.query<{
      invalidated_reason: string | null;
      revoked_access_tokens: string;
    }>(
      `SELECT
         f.invalidated_reason,
         COUNT(t.id)::text AS revoked_access_tokens
       FROM oauth_refresh_token_families f
       JOIN oauth_access_tokens t ON t.refresh_token_family_id = f.id
       WHERE f.grant_id = $1
       AND t.revoked_at IS NOT NULL
       GROUP BY f.id`,
      [grantId]
    )).rows);
    expect(family).toEqual({
      invalidated_reason: 'refresh_token_reuse',
      revoked_access_tokens: '2',
    });
  });
});
