import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pool } from '../../db/client.js';
import type { DocumentActor } from '../document-access.js';
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
    const ws = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`gov-auth-${Date.now()}`],
    );
    workspaceId = ws.rows[0].id;

    const admin = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, 'Admin') RETURNING id`,
      [`gov-admin-${Date.now()}@example.test`],
    );
    adminUserId = admin.rows[0].id;

    const member = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, 'Member') RETURNING id`,
      [`gov-member-${Date.now()}@example.test`],
    );
    memberUserId = member.rows[0].id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, adminUserId, memberUserId],
    );

    const adminPerson = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'person', 'Admin Person', 'workspace', $2) RETURNING id`,
      [workspaceId, JSON.stringify({ user_id: adminUserId })],
    );
    const adminPersonId = adminPerson.rows[0].id;

    const program = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility)
       VALUES ($1, 'program', 'Program', 'workspace') RETURNING id`,
      [workspaceId],
    );
    programId = program.rows[0].id;

    const sprint = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'sprint', 'Week 1', 'workspace', $2) RETURNING id`,
      [workspaceId, JSON.stringify({ sprint_number: 1, status: 'planning', owner_id: adminPersonId })],
    );
    sprintId = sprint.rows[0].id;

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
      const result = await requireWeekLifecycleAuthority(pool, actor(adminUserId), sprintId, 'start_week');
      expect(result).toEqual({ authorized: true });
    });

    it('denies unrelated member for start_week', async () => {
      const result = await requireWeekLifecycleAuthority(pool, actor(memberUserId), sprintId, 'start_week');
      expect(result.authorized).toBe(false);
    });

    it('allows sprint owner for carryover', async () => {
      const result = await requireWeekLifecycleAuthority(pool, actor(adminUserId), sprintId, 'carryover');
      expect(result).toEqual({ authorized: true });
    });
  });
});
