import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { validateAuthenticatedSession } from '../session-auth.js';

type IdRow = {
  id: string;
};

describe('validateAuthenticatedSession', () => {
  let userId: string;
  let workspaceId: string;
  let sessionId: string;

  beforeEach(async () => {
    const ws = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`session-auth-${Date.now()}`]
    );
    workspaceId = ws.rows[0].id;

    const user = await pool.query<IdRow>(
      `INSERT INTO users (email, name) VALUES ($1, 'Session Auth User') RETURNING id`,
      [`session-auth-${Date.now()}@example.test`]
    );
    userId = user.rows[0].id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspaceId, userId]
    );

    sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at, user_agent, ip_address)
       VALUES ($1, $2, $3, NOW() + INTERVAL '12 hours', NOW(), NOW(), $4, $5)`,
      [sessionId, userId, workspaceId, 'Test Browser', '203.0.113.10']
    );
  });

  afterEach(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('returns a valid session when membership exists', async () => {
    const result = await validateAuthenticatedSession(sessionId, {
      userAgent: 'Test Browser',
      ipAddress: '203.0.113.10',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.userId).toBe(userId);
      expect(result.session.workspaceId).toBe(workspaceId);
    }
  });

  it('denies a session when the user agent changes', async () => {
    const result = await validateAuthenticatedSession(sessionId, {
      userAgent: 'Different Browser',
      ipAddress: '203.0.113.10',
    });
    expect(result).toEqual({ ok: false, reason: 'binding_mismatch' });

    const remaining = await pool.query('SELECT id FROM sessions WHERE id = $1', [sessionId]);
    expect(remaining.rows).toHaveLength(0);
  });

  it('allows but flags a session when only the IP address changes', async () => {
    const result = await validateAuthenticatedSession(sessionId, {
      userAgent: 'Test Browser',
      ipAddress: '203.0.113.11',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bindingDecision).toEqual({
        level: 'suspicious',
        reasons: ['ip_changed'],
      });
    }
  });

  it('refreshes missing legacy binding on successful validation', async () => {
    await pool.query('UPDATE sessions SET user_agent = NULL, ip_address = NULL WHERE id = $1', [sessionId]);

    const result = await validateAuthenticatedSession(sessionId, {
      userAgent: 'Test Browser',
      ipAddress: '203.0.113.10',
    });

    expect(result.ok).toBe(true);
    const refreshed = await pool.query('SELECT user_agent, ip_address FROM sessions WHERE id = $1', [sessionId]);
    expect(refreshed.rows[0]).toMatchObject({
      user_agent: 'Test Browser',
      ip_address: '203.0.113.10',
    });
  });

  it('fails closed when workspace membership is revoked', async () => {
    await pool.query(
      'DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    const result = await validateAuthenticatedSession(sessionId);
    expect(result).toEqual({ ok: false, reason: 'membership_revoked' });

    const remaining = await pool.query('SELECT id FROM sessions WHERE id = $1', [sessionId]);
    expect(remaining.rows).toHaveLength(0);
  });
});
