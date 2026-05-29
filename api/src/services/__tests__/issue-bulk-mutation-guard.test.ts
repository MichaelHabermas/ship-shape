// Service-layer tests: bulk issue delete enforces creator_or_admin like single DELETE.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { bulkUpdateIssuesMutation } from '../issue-mutations-service.js';
import type { Principal } from '../../security/principal.js';
import { IdRow, requireFirstRow } from '../../test/pg-result.js';

describe('issue bulk mutation guards', () => {
  const testRunId = Date.now().toString(36);
  let workspaceId: string;
  let adminUserId: string;
  let memberUserId: string;
  let memberIssueId: string;
  let writePrincipal: Principal;
  let adminSessionPrincipal: Principal;
  let archivedIssueId: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Bulk Guard ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const adminResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, 'h', 'Admin') RETURNING id`,
      [`bulk-admin-${testRunId}@ship.local`]
    );
    adminUserId = requireFirstRow(adminResult.rows).id;

    const memberResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, 'h', 'Member') RETURNING id`,
      [`bulk-member-${testRunId}@ship.local`]
    );
    memberUserId = requireFirstRow(memberResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, adminUserId, memberUserId]
    );

    const issueResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'issue', 'Owned by admin', 'workspace', $2, '{}') RETURNING id`,
      [workspaceId, adminUserId]
    );
    memberIssueId = requireFirstRow(issueResult.rows).id;

    const tokenId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO api_tokens (id, user_id, workspace_id, name, token_hash, token_prefix, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tokenId,
        memberUserId,
        workspaceId,
        'write',
        crypto.createHash('sha256').update('unused').digest('hex'),
        'ship_write',
        ['documents:write'],
      ]
    );

    writePrincipal = {
      kind: 'api_token',
      tokenId,
      userId: memberUserId,
      workspaceId,
      isSuperAdmin: false,
      scopes: ['documents:write'],
    };

    adminSessionPrincipal = {
      kind: 'session',
      sessionId: 'bulk-restore-test',
      userId: adminUserId,
      workspaceId,
      isSuperAdmin: false,
    };

    const archivedResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, archived_at, deleted_at)
       VALUES ($1, 'issue', 'Archived deleted', 'workspace', $2, '{}', NOW(), NOW()) RETURNING id`,
      [workspaceId, adminUserId]
    );
    archivedIssueId = requireFirstRow(archivedResult.rows).id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM api_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[adminUserId, memberUserId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('denies bulk delete for non-creator member with write-scoped token', async () => {
    const client = await pool.connect();
    try {
      const result = await bulkUpdateIssuesMutation({
        client,
        principal: writePrincipal,
        workspaceId,
        userId: memberUserId,
        ids: [memberIssueId],
        action: 'delete',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(403);
        expect(result.body.failed).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: memberIssueId, error: 'Forbidden' }),
          ])
        );
      }
    } finally {
      client.release();
    }
  });

  it('restores archived and soft-deleted issues for admin session', async () => {
    const client = await pool.connect();
    try {
      const result = await bulkUpdateIssuesMutation({
        client,
        principal: adminSessionPrincipal,
        workspaceId,
        userId: adminUserId,
        ids: [archivedIssueId],
        action: 'restore',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.body.updated).toHaveLength(1);
        const row = await pool.query<{ archived_at: Date | null; deleted_at: Date | null }>(
          `SELECT archived_at, deleted_at FROM documents WHERE id = $1`,
          [archivedIssueId]
        );
        expect(row.rows[0]?.archived_at).toBeNull();
        expect(row.rows[0]?.deleted_at).toBeNull();
      }
    } finally {
      client.release();
    }
  });
});
