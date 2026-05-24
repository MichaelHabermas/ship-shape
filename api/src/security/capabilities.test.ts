import { describe, expect, it, vi } from 'vitest';
import { authorize } from './capabilities.js';
import type { Principal } from './principal.js';

const sessionPrincipal: Principal = {
  kind: 'session',
  sessionId: 'session-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  isSuperAdmin: false,
};

const tokenPrincipal: Principal = {
  kind: 'api_token',
  tokenId: 'token-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  isSuperAdmin: false,
  scopes: ['documents:read'],
};

function dbWithRows(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

describe('security capabilities', () => {
  it('denies setup initialization unless the setup principal is used', async () => {
    const decision = await authorize(dbWithRows([]), sessionPrincipal, {
      resource: 'setup',
      action: 'initialize',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'setup_token_required',
    });
  });

  it('denies API token actions without an admin-capable principal', async () => {
    const db = dbWithRows([{ role: 'member' }]);

    const decision = await authorize(db, sessionPrincipal, {
      resource: 'api_token',
      action: 'create',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'not_workspace_admin',
    });
  });

  it('denies scoped API tokens when the requested action is outside their scopes', async () => {
    const decision = await authorize(dbWithRows([]), tokenPrincipal, {
      resource: 'document',
      action: 'set_governance',
      documentId: 'doc-1',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'token_scope_denied',
    });
  });

  it('allows readable documents through the existing document access adapter', async () => {
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
});
