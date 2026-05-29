// Unit checks for mutation-capability-guard denial mapping (token scope vs not found).
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../db/client.js';
import { authorize } from '../../security/capabilities.js';
import { guardDocumentCreate, guardDocumentMutationsBatch } from '../mutation-capability-guard.js';
import type { Principal } from '../../security/principal.js';
import { IdRow, requireFirstRow } from '../../test/pg-result.js';

describe('mutation-capability-guard', () => {
  it('returns token_scope_denied for read-only API token on document create', async () => {
    const principal: Principal = {
      kind: 'api_token',
      tokenId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      workspaceId: '00000000-0000-4000-8000-000000000003',
      isSuperAdmin: false,
      scopes: ['documents:read'],
    };

    const result = await guardDocumentCreate(pool, principal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.body.error).toBe('token_scope_denied');
    }
  });

  it('batch creator_or_admin denial matches single-document authorize', async () => {
    const testRunId = Date.now().toString(36);
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Batch Parity ${testRunId}`]
    );
    const workspaceId = requireFirstRow(workspaceResult.rows).id;

    const adminResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, 'h', 'Admin') RETURNING id`,
      [`batch-parity-admin-${testRunId}@ship.local`]
    );
    const adminUserId = requireFirstRow(adminResult.rows).id;

    const memberResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, 'h', 'Member') RETURNING id`,
      [`batch-parity-member-${testRunId}@ship.local`]
    );
    const memberUserId = requireFirstRow(memberResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, adminUserId, memberUserId]
    );

    const issueResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, archived_at)
       VALUES ($1, 'issue', 'Archived owned by admin', 'workspace', $2, '{}', NOW()) RETURNING id`,
      [workspaceId, adminUserId]
    );
    const issueId = requireFirstRow(issueResult.rows).id;

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

    const principal: Principal = {
      kind: 'api_token',
      tokenId,
      userId: memberUserId,
      workspaceId,
      isSuperAdmin: false,
      scopes: ['documents:write'],
    };

    const single = await authorize(pool, principal, {
      resource: 'document',
      action: 'write',
      documentId: issueId,
      enforce: 'creator_or_admin',
      expectedType: 'issue',
      includeArchived: true,
    });

    const [batch] = await guardDocumentMutationsBatch(
      pool,
      principal,
      [issueId],
      {
        action: 'write',
        enforce: 'creator_or_admin',
        expectedType: 'issue',
        includeArchived: true,
      },
      { notFoundMessage: 'Issue not found' }
    );

    expect(single.allowed).toBe(false);
    expect(batch.ok).toBe(false);
    if (batch.ok) {
      throw new Error('expected batch guard denial');
    }
    const { status, body } = batch;
    expect(status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });
});
