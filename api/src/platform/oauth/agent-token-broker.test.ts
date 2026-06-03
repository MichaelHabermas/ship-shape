// Ship Agent token broker tests prove delegated tokens are real OAuth access tokens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/client.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';
import { mintDelegatedShipAgentToken } from './agent-token-broker.js';
import { validateOAuthAccessToken } from './tokens.js';

describe('Ship Agent delegated token broker', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `ship-agent-token-${testRunId}@ship.local`;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    workspaceId = requireFirstRow((await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Ship Agent Token ${testRunId}`]
    )).rows).id;
    userId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Ship Agent Token User')
       RETURNING id`,
      [email]
    )).rows).id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [workspaceId, userId]
    );
  });

  afterAll(async () => {
    if (!workspaceId) return;
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM api_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('mints a short-lived real OAuth access token for the first-party Ship Agent app', async () => {
    const delegated = await mintDelegatedShipAgentToken({ workspaceId, userId });
    const validation = await validateOAuthAccessToken(delegated.token);

    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error('Expected Ship Agent token to validate');
    expect(validation.context).toMatchObject({
      appId: delegated.appId,
      clientId: delegated.clientId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read', 'issues:read', 'sprints:read'],
    });

    const app = requireFirstRow((await pool.query<{
      is_first_party: boolean;
      system_key: string | null;
      requested_scopes: string[];
    }>(
      `SELECT is_first_party, system_key, requested_scopes
       FROM oauth_apps
       WHERE id = $1`,
      [delegated.appId]
    )).rows);
    expect(app).toMatchObject({
      is_first_party: true,
      system_key: 'ship-agent',
      requested_scopes: ['documents:read', 'issues:read', 'sprints:read'],
    });

    const oauthTokenCount = Number(requireFirstRow((await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM oauth_access_tokens WHERE id = $1',
      [delegated.id]
    )).rows).count);
    const legacyTokenCount = Number(requireFirstRow((await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM api_tokens WHERE workspace_id = $1',
      [workspaceId]
    )).rows).count);
    expect(oauthTokenCount).toBe(1);
    expect(legacyTokenCount).toBe(0);
  });

  it('rejects caller-requested scopes outside the Ship Agent read scope', async () => {
    const beforeCount = await oauthTokenCount();
    await expect(mintDelegatedShipAgentToken({
      workspaceId,
      userId,
      scopes: ['documents:read', 'documents:write'],
    })).rejects.toThrow('SHIP_AGENT_SCOPE_NOT_ALLOWED:documents:write');
    expect(await oauthTokenCount()).toBe(beforeCount);
  });

  async function oauthTokenCount(): Promise<number> {
    return Number(requireFirstRow((await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM oauth_access_tokens WHERE workspace_id = $1',
      [workspaceId]
    )).rows).count);
  }
});
