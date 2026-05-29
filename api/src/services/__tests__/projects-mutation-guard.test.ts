// Service-layer tests: project writes deny read-scoped API token principals without HTTP routes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { createProject, deleteProject, updateProject } from '../projects-service.js';
import type { Principal } from '../../security/principal.js';
import { IdRow, requireFirstRow } from '../../test/pg-result.js';

describe('projects-service mutation guards', () => {
  const testRunId = Date.now().toString(36);
  let workspaceId: string;
  let userId: string;
  let projectId: string;
  let readOnlyPrincipal: Principal;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Svc Guard ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'hash', 'User') RETURNING id`,
      [`svc-guard-${testRunId}@ship.local`]
    );
    userId = requireFirstRow(userResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [workspaceId, userId]
    );

    const projectResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'project', 'Guarded', 'workspace', $2, '{}') RETURNING id`,
      [workspaceId, userId]
    );
    projectId = requireFirstRow(projectResult.rows).id;

    const tokenId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO api_tokens (id, user_id, workspace_id, name, token_hash, token_prefix, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tokenId,
        userId,
        workspaceId,
        'read',
        crypto.createHash('sha256').update('unused').digest('hex'),
        'ship_read',
        ['documents:read'],
      ]
    );

    readOnlyPrincipal = {
      kind: 'api_token',
      tokenId,
      userId,
      workspaceId,
      isSuperAdmin: false,
      scopes: ['documents:read'],
    };
  });

  afterAll(async () => {
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM api_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('denies createProject at service layer for read-only API token principal', async () => {
    const result = await createProject({
      principal: readOnlyPrincipal,
      workspaceId,
      userId,
      data: { title: 'New project', impact: 3, confidence: 3, ease: 3 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.body.error).toBe('token_scope_denied');
    }
  });

  it('denies deleteProject at service layer for read-only API token principal', async () => {
    const result = await deleteProject({
      principal: readOnlyPrincipal,
      projectId,
      workspaceId,
      userId,
      isAdmin: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.body.error).toBe('token_scope_denied');
    }
  });

  it('denies updateProject at service layer for read-only API token principal', async () => {
    const result = await updateProject({
      principal: readOnlyPrincipal,
      projectId,
      workspaceId,
      userId,
      isAdmin: true,
      data: { title: 'Bypass attempt' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.body.error).toBe('token_scope_denied');
    }
  });
});
