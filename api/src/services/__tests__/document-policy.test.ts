import { describe, expect, it, vi } from 'vitest';
import { authorize } from '../../security/capabilities.js';
import type { Principal } from '../../security/principal.js';
import { DOCUMENT_POLICY_CASES } from '../document-policy.js';

const sessionPrincipal: Principal = {
  kind: 'session',
  sessionId: 'session-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  isSuperAdmin: false,
};

function dbWithRows(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

describe('DocumentPolicy', () => {
  it('keeps policy compiler seed cases explicit', () => {
    expect(DOCUMENT_POLICY_CASES.map((testCase) => testCase.id)).toEqual([
      'workspace-doc-readable',
      'private-doc-creator-or-admin',
      'weekly-doc-person-scope',
      'document-type-change-creator',
      'association-reference-readable',
    ]);
  });

  it('allows readable workspace documents', async () => {
    const db = dbWithRows([
      {
        id: 'doc-1',
        title: 'Doc',
        document_type: 'wiki',
        workspace_id: sessionPrincipal.workspaceId,
        created_by: 'user-2',
        visibility: 'workspace',
        properties: {},
        archived_at: null,
        deleted_at: null,
      },
    ]);

    const decision = await authorize(db, sessionPrincipal, {
      resource: 'document',
      action: 'read',
      documentId: 'doc-1',
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
    });
  });

  it('denies missing or unreadable documents as not found', async () => {
    const db = dbWithRows([]);

    const decision = await authorize(db, sessionPrincipal, {
      resource: 'document',
      action: 'write',
      documentId: 'doc-1',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'document_not_found',
    });
  });

  it('denies weekly accountability docs outside linked person scope', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'doc-1',
              title: 'Plan',
              document_type: 'weekly_plan',
              workspace_id: sessionPrincipal.workspaceId,
              created_by: 'user-2',
              visibility: 'workspace',
              properties: { person_id: 'person-1' },
              archived_at: null,
              deleted_at: null,
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };

    const decision = await authorize(db, sessionPrincipal, {
      resource: 'document',
      action: 'write',
      documentId: 'doc-1',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'accountability_scope_denied',
    });
  });

  it('requires expected reference types for associations', async () => {
    const db = dbWithRows([]);

    const decision = await authorize(db, sessionPrincipal, {
      resource: 'document_reference',
      action: 'link',
      targetId: 'doc-1',
      relationship: 'program',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'reference_not_visible',
    });
  });

  it('uses creator-or-admin decisions for type and visibility changes', async () => {
    const db = dbWithRows([
      { role: 'member' },
      {
        id: 'doc-1',
        title: 'Doc',
        document_type: 'wiki',
        workspace_id: sessionPrincipal.workspaceId,
        created_by: 'user-2',
        visibility: 'workspace',
        properties: {},
        archived_at: null,
        deleted_at: null,
      },
      { role: 'member' },
    ]);

    const decision = await authorize(db, sessionPrincipal, {
      resource: 'document',
      action: 'write',
      documentId: 'doc-1',
      enforce: 'creator_or_admin',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'not_creator_or_admin',
    });
  });

  it('uses workspace-admin decisions for governance fields', async () => {
    const db = dbWithRows([
      { role: 'member' },
      {
        id: 'doc-1',
        title: 'Doc',
        document_type: 'wiki',
        workspace_id: sessionPrincipal.workspaceId,
        created_by: 'user-2',
        visibility: 'workspace',
        properties: {},
        archived_at: null,
        deleted_at: null,
      },
      { role: 'member' },
    ]);

    const decision = await authorize(db, sessionPrincipal, {
      resource: 'document',
      action: 'governance',
      documentId: 'doc-1',
      enforce: 'workspace_admin',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'not_workspace_admin',
    });
  });
});
