// Verifies capability authorization for sessions, API tokens, and setup principals.
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

const adminPrincipal: Principal = {
  kind: 'session',
  sessionId: 'session-admin',
  userId: 'admin-1',
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

const workspaceAdminTokenPrincipal: Principal = {
  kind: 'api_token',
  tokenId: 'token-admin',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  isSuperAdmin: false,
  scopes: ['admin:workspace'],
};

const governanceTokenPrincipal: Principal = {
  kind: 'api_token',
  tokenId: 'token-2',
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

const workspaceWiki = {
  id: 'doc-1',
  title: 'Doc',
  document_type: 'wiki',
  workspace_id: sessionPrincipal.workspaceId,
  created_by: 'user-2',
  visibility: 'workspace',
  properties: {},
  archived_at: null,
  deleted_at: null,
};

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

  it('allows setup initialization for the setup principal', async () => {
    const decision = await authorize(dbWithRows([]), { kind: 'setup' }, {
      resource: 'setup',
      action: 'initialize',
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
    });
  });

  it('denies API token create without a workspace admin principal', async () => {
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

  it('allows workspace admin principals to create API tokens', async () => {
    const db = dbWithRows([{ role: 'admin' }]);

    const decision = await authorize(db, adminPrincipal, {
      resource: 'api_token',
      action: 'create',
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
    });
  });

  it('allows admin-scoped API tokens to use workspace admin capabilities', async () => {
    const decision = await authorize(dbWithRows([{ role: 'admin' }]), workspaceAdminTokenPrincipal, {
      resource: 'workspace',
      action: 'admin',
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
    });
  });

  it('denies admin-scoped API tokens without workspace admin membership', async () => {
    const decision = await authorize(dbWithRows([{ role: 'member' }]), workspaceAdminTokenPrincipal, {
      resource: 'workspace',
      action: 'admin',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'not_workspace_admin',
    });
  });

  it('denies read-only API tokens for workspace admin capabilities', async () => {
    const decision = await authorize(dbWithRows([]), tokenPrincipal, {
      resource: 'workspace',
      action: 'admin',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'token_scope_denied',
    });
  });

  it('denies scoped API tokens when governance is outside their scopes', async () => {
    const decision = await authorize(dbWithRows([]), governanceTokenPrincipal, {
      resource: 'document',
      action: 'governance',
      documentId: 'doc-1',
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'token_scope_denied',
    });
  });

  it('allows readable documents for read capability', async () => {
    const db = dbWithRows([workspaceWiki]);

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

  it('denies weekly accountability writes outside linked person scope', async () => {
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

  it('denies delete for session users who are not creator or workspace admin', async () => {
    const db = dbWithRows([
      { role: 'member' },
      workspaceWiki,
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

  it('allows delete for the document creator', async () => {
    const creatorDoc = {
      ...workspaceWiki,
      created_by: sessionPrincipal.userId,
    };
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [creatorDoc], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 }),
    };

    const decision = await authorize(db, sessionPrincipal, {
      resource: 'document',
      action: 'write',
      documentId: 'doc-1',
      enforce: 'creator_or_admin',
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
    });
  });
});
