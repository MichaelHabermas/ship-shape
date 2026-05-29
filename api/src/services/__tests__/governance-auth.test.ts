import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { IdRow, requireFirstRow } from '../../test/pg-result.js';
import type { DocumentActor } from '../document-access.js';
import type { Principal } from '../../security/principal.js';
import {
  requireTeamAllocationAuthority,
  requireWeekLifecycleAuthority,
} from '../governance-auth.js';

describe('governance-auth', () => {
  let workspaceId: string;
  let adminUserId: string;
  let memberUserId: string;
  let sprintId: string;
  let programId: string;

  beforeEach(async () => {
    const runId = crypto.randomUUID();
    const ws = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`gov-auth-${runId}`],
    );
    workspaceId = requireFirstRow(ws.rows).id;

    const admin = await pool.query<IdRow>(
      `INSERT INTO users (email, name) VALUES ($1, 'Admin') RETURNING id`,
      [`gov-admin-${runId}@example.test`],
    );
    adminUserId = requireFirstRow(admin.rows).id;

    const member = await pool.query<IdRow>(
      `INSERT INTO users (email, name) VALUES ($1, 'Member') RETURNING id`,
      [`gov-member-${runId}@example.test`],
    );
    memberUserId = requireFirstRow(member.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, adminUserId, memberUserId],
    );

    const adminPerson = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'person', 'Admin Person', 'workspace', $2) RETURNING id`,
      [workspaceId, JSON.stringify({ user_id: adminUserId })],
    );
    const adminPersonId = requireFirstRow(adminPerson.rows).id;

    const program = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility)
       VALUES ($1, 'program', 'Program', 'workspace') RETURNING id`,
      [workspaceId],
    );
    programId = requireFirstRow(program.rows).id;

    const sprint = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'sprint', 'Week 1', 'workspace', $2) RETURNING id`,
      [workspaceId, JSON.stringify({ sprint_number: 1, status: 'planning', owner_id: adminPersonId })],
    );
    sprintId = requireFirstRow(sprint.rows).id;

    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [sprintId, programId],
    );
  });

  afterEach(async () => {
    await pool.query('DELETE FROM document_associations WHERE document_id = $1', [sprintId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [adminUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [memberUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  function actor(userId: string, isSuperAdmin = false): DocumentActor {
    return { userId, workspaceId, isSuperAdmin };
  }

  function sessionPrincipal(userId: string, isSuperAdmin = false): Principal {
    return {
      kind: 'session',
      sessionId: 'test-session',
      userId,
      workspaceId,
      isSuperAdmin,
    };
  }

  describe('requireTeamAllocationAuthority', () => {
    it('allows workspace admins', async () => {
      const result = await requireTeamAllocationAuthority(actor(adminUserId));
      expect(result).toEqual({ authorized: true });
    });

    it('denies non-admin members', async () => {
      const result = await requireTeamAllocationAuthority(actor(memberUserId));
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.error).toContain('admin');
      }
    });
  });

  describe('requireWeekLifecycleAuthority', () => {
    it('allows sprint owner to start week', async () => {
      const result = await requireWeekLifecycleAuthority(
        pool,
        sessionPrincipal(adminUserId),
        sprintId,
        'start_week'
      );
      expect(result).toEqual({ authorized: true });
    });

    it('denies unrelated member for start_week', async () => {
      const result = await requireWeekLifecycleAuthority(
        pool,
        sessionPrincipal(memberUserId),
        sprintId,
        'start_week'
      );
      expect(result.authorized).toBe(false);
    });

    it('allows sprint owner for carryover', async () => {
      const result = await requireWeekLifecycleAuthority(
        pool,
        sessionPrincipal(adminUserId),
        sprintId,
        'carryover'
      );
      expect(result).toEqual({ authorized: true });
    });

    it('denies read-scoped API token for start_week', async () => {
      const tokenId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO api_tokens (id, user_id, workspace_id, name, token_hash, token_prefix, scopes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tokenId,
          adminUserId,
          workspaceId,
          'read',
          crypto.createHash('sha256').update('unused').digest('hex'),
          'ship_read',
          ['documents:read'],
        ]
      );

      const result = await requireWeekLifecycleAuthority(
        pool,
        {
          kind: 'api_token',
          tokenId,
          userId: adminUserId,
          workspaceId,
          isSuperAdmin: false,
          scopes: ['documents:read'],
        },
        sprintId,
        'start_week'
      );

      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.error).toBe('token_scope_denied');
      }

      await pool.query('DELETE FROM api_tokens WHERE id = $1', [tokenId]);
    });
  });
});
