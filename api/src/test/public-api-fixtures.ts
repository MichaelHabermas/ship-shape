// Shared OAuth workspace fixtures for /api/v1 route tests (apps, tokens, audit cleanup).
import type { PublicApiScope } from '@ship/shared';
import { pool } from '../db/client.js';
import { createOAuthAccessToken } from '../platform/oauth/tokens.js';
import { type IdRow, requireFirstRow } from './pg-result.js';

export type PublicApiTestContext = {
  testRunId: string;
  clientId: string;
  workspaceId: string;
  adminUserId: string;
  memberUserId: string | null;
  appId: string;
  issueToken: (scopes: PublicApiScope[], userId?: string) => Promise<string>;
  issueExpiredToken: (scopes: PublicApiScope[], userId?: string) => Promise<string>;
  cleanup: () => Promise<void>;
};

export type CreatePublicApiTestContextInput = {
  label: string;
  clientIdPrefix: string;
  requestedScopes: PublicApiScope[];
  includeMember?: boolean;
  workspaceExtras?: { sprintStartDate?: string };
};

function newTestRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function createPublicApiTestContext(
  input: CreatePublicApiTestContextInput
): Promise<PublicApiTestContext> {
  const testRunId = newTestRunId();
  const clientId = `${input.clientIdPrefix}_${testRunId}`;
  const workspaceName = `${input.label} ${testRunId}`;

  const workspaceId = input.workspaceExtras?.sprintStartDate
    ? requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO workspaces (name, sprint_start_date)
       VALUES ($1, $2)
       RETURNING id`,
      [workspaceName, input.workspaceExtras.sprintStartDate]
    )).rows).id
    : requireFirstRow((await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [workspaceName]
    )).rows).id;

  const adminUserId = requireFirstRow((await pool.query<IdRow>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, 'test-hash', $2)
     RETURNING id`,
    [`public-${input.clientIdPrefix}-admin-${testRunId}@ship.local`, `${input.label} Admin`]
  )).rows).id;

  let memberUserId: string | null = null;
  if (input.includeMember) {
    memberUserId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', $2)
       RETURNING id`,
      [`public-${input.clientIdPrefix}-member-${testRunId}@ship.local`, `${input.label} Member`]
    )).rows).id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, adminUserId, memberUserId]
    );
  } else {
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [workspaceId, adminUserId]
    );
  }

  const appId = requireFirstRow((await pool.query<IdRow>(
    `INSERT INTO oauth_apps (
       workspace_id,
       owner_user_id,
       name,
       client_id,
       client_secret_hash,
       redirect_uris,
       requested_scopes
     )
     VALUES ($1, $2, $3, $4, 'test-secret-hash', $5, $6)
     RETURNING id`,
    [
      workspaceId,
      adminUserId,
      `${input.label} Test App`,
      clientId,
      ['https://example.test/callback'],
      input.requestedScopes,
    ]
  )).rows).id;

  const issueToken = async (scopes: PublicApiScope[], userId?: string) => {
    return (await seedOAuthAccessToken({
      appId,
      userId: userId ?? adminUserId,
      workspaceId,
      grantedScopes: scopes,
    })).token;
  };

  const issueExpiredToken = async (scopes: PublicApiScope[], userId?: string) => {
    return (await seedOAuthAccessToken({
      appId,
      userId: userId ?? adminUserId,
      workspaceId,
      grantedScopes: scopes,
      expiresAt: new Date(Date.now() - 60 * 1000),
    })).token;
  };

  const cleanup = async () => {
    await deletePublicApiAuditRows({ workspaceId, clientId });
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [appId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      memberUserId ? [adminUserId, memberUserId] : [adminUserId],
    ]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  };

  return {
    testRunId,
    clientId,
    workspaceId,
    adminUserId,
    memberUserId,
    appId,
    issueToken,
    issueExpiredToken,
    cleanup,
  };
}

export async function seedOAuthAccessToken(input: {
  appId: string;
  userId: string;
  workspaceId: string;
  grantedScopes: PublicApiScope[];
  expiresAt?: Date;
}) {
  return createOAuthAccessToken({
    appId: input.appId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    grantedScopes: input.grantedScopes,
    expiresAt: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
  });
}

export async function deleteIssueIterationsForWorkspace(workspaceId: string): Promise<void> {
  await pool.query('DELETE FROM issue_iterations WHERE workspace_id = $1', [workspaceId]);
}

export async function deleteWebhookDataForWorkspace(workspaceId: string): Promise<void> {
  await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [workspaceId]);
  await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [workspaceId]);
  await pool.query('DELETE FROM webhook_subscriptions WHERE workspace_id = $1', [workspaceId]);
}

export async function deletePublicApiAuditRows(input: {
  workspaceId?: string;
  clientId?: string;
  requestIdPrefix?: string;
}): Promise<void> {
  if (input.requestIdPrefix) {
    await pool.query('DELETE FROM public_api_audit_logs WHERE request_id LIKE $1', [
      `${input.requestIdPrefix}-%`,
    ]);
  }
  if (input.workspaceId || input.clientId) {
    await pool.query(
      'DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2',
      [input.workspaceId ?? null, input.clientId ?? null]
    );
  }
}
