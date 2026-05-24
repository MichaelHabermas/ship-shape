import { describe, expect, it, vi } from 'vitest';
import type { DocumentActor } from '../document-access.js';
import {
  DOCUMENT_POLICY_CASES,
  decideCreatorOrAdmin,
  decideDocumentAccess,
  decideReferenceAccess,
  decideWorkspaceAdmin,
} from '../document-policy.js';

const actor: DocumentActor = {
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
        workspace_id: actor.workspaceId,
        created_by: 'user-2',
        visibility: 'workspace',
        properties: {},
        archived_at: null,
        deleted_at: null,
      },
    ]);

    const decision = await decideDocumentAccess(db, actor, 'read', 'doc-1');

    expect(decision).toMatchObject({
      action: 'read',
      allowed: true,
      reason: 'allowed',
    });
  });

  it('denies missing or unreadable documents as not found', async () => {
    const db = dbWithRows([]);

    const decision = await decideDocumentAccess(db, actor, 'write', 'doc-1');

    expect(decision).toEqual({
      action: 'write',
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
              workspace_id: actor.workspaceId,
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

    const decision = await decideDocumentAccess(db, actor, 'content_update', 'doc-1');

    expect(decision).toEqual({
      action: 'content_update',
      allowed: false,
      reason: 'accountability_scope_denied',
    });
  });

  it('requires expected reference types for associations', async () => {
    const db = dbWithRows([]);

    const decision = await decideReferenceAccess(db, actor, 'doc-1', 'program');

    expect(decision).toEqual({
      action: 'reference',
      allowed: false,
      reason: 'wrong_reference_type',
    });
  });

  it('uses creator-or-admin decisions for type and visibility changes', async () => {
    const db = dbWithRows([{ role: 'member' }]);

    const decision = await decideCreatorOrAdmin(actor, { created_by: 'user-2' }, 'convert', db);

    expect(decision).toEqual({
      action: 'convert',
      allowed: false,
      reason: 'not_creator_or_admin',
    });
  });

  it('uses workspace-admin decisions for governance fields', async () => {
    const db = dbWithRows([{ role: 'member' }]);

    const decision = await decideWorkspaceAdmin(actor, 'write', db);

    expect(decision).toEqual({
      action: 'write',
      allowed: false,
      reason: 'not_workspace_admin',
    });
  });
});
