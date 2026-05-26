// Idempotent FleetGraph demo setup seeds reviewer-safe blocked-work scenarios.
import { pathToFileURL } from 'url';
import { randomBytes } from 'crypto';
import { computeCurrentSprintNumber } from '@ship/shared';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client.js';
import { detectBlockedImportantIssueDecisions, findBlockedImportantIssueQuietExits } from '../fleetgraph/detector.js';
import { runFleetGraph } from '../fleetgraph/core.js';
import { runFleetGraphManualTick } from '../fleetgraph/manual-run.js';
import { saveBlockedImportantIssueFinding } from '../fleetgraph/persistence.js';
import type { Principal } from '../security/principal.js';
import { requireFirstRow } from '../utils/query-rows.js';

const WORKSPACE_NAME = 'FleetGraph Demo Workspace';
const BASE_URL = process.env.FLEETGRAPH_DEMO_WEB_URL ?? 'http://localhost:5173';
const DEMO_PASSWORD = process.env.FLEETGRAPH_DEMO_PASSWORD ?? randomBytes(9).toString('base64url');

type IdRow = { id: string };
type UserRow = { id: string; email: string; name: string };
type WorkspaceRow = { id: string; sprint_start_date: Date | string };

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayWeeksAgo(weeksAgo: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday - weeksAgo * 7);
  return isoDate(date);
}

function assertLocalDemoDatabase(): void {
  if (process.env.FLEETGRAPH_DEMO_ALLOW_NONLOCAL_DB === '1') return;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (localHosts.has(parsed.hostname)) return;

  throw new Error('Refusing to run fleetgraph:demo against a non-local DATABASE_URL. Set FLEETGRAPH_DEMO_ALLOW_NONLOCAL_DB=1 only for an intentional demo database.');
}

async function upsertWorkspace(): Promise<WorkspaceRow> {
  const existing = await pool.query<WorkspaceRow>(
    'SELECT id, sprint_start_date FROM workspaces WHERE name = $1 ORDER BY created_at ASC LIMIT 1',
    [WORKSPACE_NAME]
  );
  if (existing.rows[0]) {
    await pool.query(
      'UPDATE workspaces SET sprint_start_date = $2 WHERE id = $1',
      [existing.rows[0].id, mondayWeeksAgo(6)]
    );
    return { ...existing.rows[0], sprint_start_date: mondayWeeksAgo(6) };
  }

  const created = await pool.query<WorkspaceRow>(
    `INSERT INTO workspaces (name, sprint_start_date)
     VALUES ($1, $2)
     RETURNING id, sprint_start_date`,
    [WORKSPACE_NAME, mondayWeeksAgo(6)]
  );
  return requireFirstRow(created.rows);
}

async function upsertUser(email: string, name: string, workspaceId: string, role: 'admin' | 'member'): Promise<UserRow> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const existing = await pool.query<UserRow>(
    'SELECT id, email, name FROM users WHERE lower(email) = lower($1) LIMIT 1',
    [email]
  );
  const user = existing.rows[0] ?? requireFirstRow((await pool.query<UserRow>(
    `INSERT INTO users (email, name, password_hash, last_workspace_id)
     VALUES ($1, $2, 'fleetgraph-demo-no-login', $3)
     RETURNING id, email, name`,
    [email, name, workspaceId]
  )).rows);

  await pool.query(
    `UPDATE users
        SET name = $2,
            last_workspace_id = $3,
            password_hash = $4
      WHERE id = $1`,
    [user.id, name, workspaceId, passwordHash]
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [workspaceId, user.id, role]
  );

  return { ...user, name };
}

async function upsertDocument(input: {
  workspaceId: string;
  type: 'person' | 'program' | 'project' | 'sprint' | 'issue' | 'wiki';
  title: string;
  properties: Record<string, unknown>;
  createdBy?: string | null;
  visibility?: 'workspace' | 'private';
}): Promise<string> {
  const existing = await pool.query<IdRow>(
    `SELECT id
       FROM documents
      WHERE workspace_id = $1
        AND document_type = $2
        AND title = $3
      ORDER BY created_at ASC
      LIMIT 1`,
    [input.workspaceId, input.type, input.title]
  );

  if (existing.rows[0]) {
    await pool.query(
      `UPDATE documents
          SET properties = $2::jsonb,
              visibility = $3,
              created_by = COALESCE($4, created_by),
              deleted_at = NULL,
              archived_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [
        existing.rows[0].id,
        JSON.stringify(input.properties),
        input.visibility ?? 'workspace',
        input.createdBy ?? null,
      ]
    );
    return existing.rows[0].id;
  }

  const created = await pool.query<IdRow>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, visibility, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING id`,
    [
      input.workspaceId,
      input.type,
      input.title,
      JSON.stringify(input.properties),
      input.visibility ?? 'workspace',
      input.createdBy ?? null,
    ]
  );
  return requireFirstRow(created.rows).id;
}

async function associate(documentId: string, relatedId: string, relationshipType: 'program' | 'project' | 'sprint'): Promise<void> {
  await pool.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
     VALUES ($1, $2, $3, '{"created_via":"fleetgraph-demo"}'::jsonb)
     ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
    [documentId, relatedId, relationshipType]
  );
}

async function nextTicketNumber(workspaceId: string): Promise<number> {
  const result = await pool.query<{ next_ticket: string }>(
    `SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next_ticket
       FROM documents
      WHERE workspace_id = $1
        AND document_type = 'issue'`,
    [workspaceId]
  );
  return Number(requireFirstRow(result.rows).next_ticket);
}

async function ensureIssueTicket(issueId: string, workspaceId: string): Promise<void> {
  const current = await pool.query<{ ticket_number: number | null }>(
    'SELECT ticket_number FROM documents WHERE id = $1',
    [issueId]
  );
  if (requireFirstRow(current.rows).ticket_number !== null) return;
  await pool.query(
    'UPDATE documents SET ticket_number = $2 WHERE id = $1',
    [issueId, await nextTicketNumber(workspaceId)]
  );
}

async function upsertIssueIteration(input: {
  issueId: string;
  workspaceId: string;
  authorId: string;
  whatAttempted: string;
  blockerText: string | null;
  createdAt: Date;
}): Promise<void> {
  await pool.query(
    `DELETE FROM issue_iterations
      WHERE issue_id = $1
        AND workspace_id = $2
        AND what_attempted = $3`,
    [input.issueId, input.workspaceId, input.whatAttempted]
  );
  await pool.query(
    `INSERT INTO issue_iterations
       (issue_id, workspace_id, status, what_attempted, blockers_encountered, author_id, created_at)
     VALUES ($1, $2, 'in_progress', $3, $4, $5, $6)`,
    [
      input.issueId,
      input.workspaceId,
      input.whatAttempted,
      input.blockerText,
      input.authorId,
      input.createdAt,
    ]
  );
}

async function seedDemo(): Promise<void> {
  assertLocalDemoDatabase();
  const workspace = await upsertWorkspace();
  const currentSprintNumber = computeCurrentSprintNumber(new Date(workspace.sprint_start_date));

  const admin = await upsertUser('fleetgraph.reviewer@ship.local', 'FleetGraph Reviewer', workspace.id, 'admin');
  const engineer = await upsertUser('fleetgraph.engineer@ship.local', 'Riley Builder', workspace.id, 'member');
  const pm = await upsertUser('fleetgraph.pm@ship.local', 'Morgan Project Owner', workspace.id, 'member');
  const lead = await upsertUser('fleetgraph.lead@ship.local', 'Dana Program Lead', workspace.id, 'member');
  const dependency = await upsertUser('fleetgraph.dependency@ship.local', 'Casey Dependency Owner', workspace.id, 'member');

  const engineerPersonId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'person',
    title: engineer.name,
    properties: { user_id: engineer.id, role: 'Engineer' },
    createdBy: admin.id,
  });
  const pmPersonId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'person',
    title: pm.name,
    properties: { user_id: pm.id, role: 'PM' },
    createdBy: admin.id,
  });
  const leadPersonId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'person',
    title: lead.name,
    properties: { user_id: lead.id, role: 'Director' },
    createdBy: admin.id,
  });
  const dependencyPersonId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'person',
    title: dependency.name,
    properties: { user_id: dependency.id, role: 'Dependency Owner' },
    createdBy: admin.id,
  });

  const programId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'program',
    title: 'Reviewer Readiness Program',
    properties: { color: '#2563eb', owner_id: leadPersonId, accountable_id: lead.id },
    createdBy: admin.id,
  });
  const projectId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'project',
    title: 'FleetGraph Reviewer Demo Project',
    properties: { color: '#16a34a', impact: 5, confidence: 4, ease: 3, owner_id: pmPersonId, accountable_id: pm.id },
    createdBy: admin.id,
  });
  const activeSprintId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'sprint',
    title: `FleetGraph Demo Week ${currentSprintNumber}`,
    properties: { sprint_number: currentSprintNumber, owner_id: pm.id },
    createdBy: admin.id,
  });
  const inactiveSprintId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'sprint',
    title: `FleetGraph Demo Week ${currentSprintNumber - 1}`,
    properties: { sprint_number: currentSprintNumber - 1, owner_id: pm.id },
    createdBy: admin.id,
  });
  const dependencyDocId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'wiki',
    title: 'FleetGraph Demo Dependency Notes',
    properties: { owner_id: dependencyPersonId },
    createdBy: admin.id,
  });

  await associate(projectId, programId, 'program');
  await associate(activeSprintId, programId, 'program');
  await associate(inactiveSprintId, programId, 'program');

  const now = new Date();
  const issues = [
    {
      key: 'auth',
      title: 'FG Demo - SSO cert rotation blocked',
      properties: { state: 'blocked', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Blocked on Casey Dependency Owner approving the SSO cert rotation window.',
      whatAttempted: 'FleetGraph demo blocker: SSO cert rotation',
    },
    {
      key: 'data',
      title: 'FG Demo - Data export contract blocked',
      properties: { state: 'blocked', priority: 'high', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Blocked on Morgan Project Owner deciding whether the export includes archived issues.',
      whatAttempted: 'FleetGraph demo blocker: data export contract',
    },
    {
      key: 'unblocked',
      title: 'FG Demo - Urgent active work not blocked',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo negative: urgent active unblocked',
    },
    {
      key: 'missing',
      title: 'FG Demo - Blocked without blocker explanation',
      properties: { state: 'blocked', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo negative: missing blocker evidence',
    },
    {
      key: 'medium',
      title: 'FG Demo - Medium priority blocked control',
      properties: { state: 'blocked', priority: 'medium', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Blocked but medium priority, so FleetGraph should stay quiet for MVP.',
      whatAttempted: 'FleetGraph demo negative: medium priority blocker',
    },
    {
      key: 'done',
      title: 'FG Demo - Done blocker history control',
      properties: { state: 'done', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Historical blocker is stale because this issue is done.',
      whatAttempted: 'FleetGraph demo negative: done with blocker history',
    },
    {
      key: 'inactive',
      title: 'FG Demo - Inactive week blocked control',
      properties: { state: 'blocked', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: inactiveSprintId,
      blockerText: 'Blocked in a prior week, outside the active-week detector scope.',
      whatAttempted: 'FleetGraph demo negative: inactive week blocker',
    },
    {
      key: 'duplicate',
      title: 'FG Demo - Duplicate open finding control',
      properties: { state: 'blocked', priority: 'high', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Blocked on a dependency already represented by an open FleetGraph finding.',
      whatAttempted: 'FleetGraph demo negative: duplicate open finding',
    },
    {
      key: 'private',
      title: 'FG Demo - Private blocked source control',
      properties: { state: 'blocked', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: 'Private blocker text should not leak to unauthorized reviewer surfaces.',
      whatAttempted: 'FleetGraph demo negative: private blocked source',
      visibility: 'private' as const,
    },
  ];

  const issueIds = new Map<string, string>();
  for (const issue of issues) {
    const issueId = await upsertDocument({
      workspaceId: workspace.id,
      type: 'issue',
      title: issue.title,
      properties: issue.properties,
      createdBy: issue.key === 'private' ? dependency.id : admin.id,
      visibility: issue.visibility ?? 'workspace',
    });
    await ensureIssueTicket(issueId, workspace.id);
    await associate(issueId, programId, 'program');
    await associate(issueId, projectId, 'project');
    await associate(issueId, issue.sprintId, 'sprint');
    await upsertIssueIteration({
      issueId,
      workspaceId: workspace.id,
      authorId: issue.key === 'private' ? dependency.id : engineer.id,
      whatAttempted: issue.whatAttempted,
      blockerText: issue.blockerText,
      createdAt: new Date(now.getTime() - issueIds.size * 60_000),
    });
    issueIds.set(issue.key, issueId);
  }

  const duplicateIssueId = issueIds.get('duplicate');
  if (!duplicateIssueId) throw new Error('Missing duplicate issue');
  const demoIssueIds = Array.from(issueIds.values());
  await pool.query(
    `DELETE FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND source_issue_id = ANY($2::uuid[])
        AND source_issue_id <> $3`,
    [workspace.id, demoIssueIds, duplicateIssueId]
  );
  await saveBlockedImportantIssueFinding({
    workspaceId: workspace.id,
    sourceIssueId: duplicateIssueId,
    sourceSprintId: activeSprintId,
    severity: 'high',
    confidence: 0.85,
    title: 'FG Demo - Duplicate open finding control',
    summary: 'Seeded duplicate control finding for FleetGraph reviewer readiness.',
  });

  const decisions = await detectBlockedImportantIssueDecisions({ workspaceId: workspace.id });
  const quietExits = await findBlockedImportantIssueQuietExits({ workspaceId: workspace.id });
  const traceEvidence = process.argv.includes('--capture-traces')
    ? await captureTraceEvidence({
      workspaceId: workspace.id,
      adminUserId: admin.id,
      positiveIssueId: issueIds.get('auth') ?? '',
    })
    : null;

  console.log(JSON.stringify({
    workspaceId: workspace.id,
    currentSprintNumber,
    reviewerLogin: admin.email,
    reviewerPassword: DEMO_PASSWORD,
    decisionCount: decisions.length,
    decisions: decisions.map((decision) => ({
      decision: decision.decision,
      title: decision.candidate.issue_title,
      issueId: decision.candidate.issue_id,
      sprintId: decision.candidate.sprint_id,
    })),
    quietExits,
    reviewerUrls: {
      activeWeek: `${BASE_URL}/documents/${activeSprintId}`,
      project: `${BASE_URL}/documents/${projectId}`,
      dependencyNotes: `${BASE_URL}/documents/${dependencyDocId}`,
      positiveIssueA: `${BASE_URL}/documents/${issueIds.get('auth')}`,
      positiveIssueB: `${BASE_URL}/documents/${issueIds.get('data')}`,
      missingEvidenceIssue: `${BASE_URL}/documents/${issueIds.get('missing')}`,
      duplicateControlIssue: `${BASE_URL}/documents/${duplicateIssueId}`,
    },
    traceCapturePrompts: [
      'Run gated manual FleetGraph execute for proactive create/update proof.',
      'Open a positive issue and use Why flagged for on-demand explain proof.',
      'Refine the blocker draft on a positive finding for on-demand draft proof.',
      'Rerun detector after duplicate finding exists for update/quiet proof.',
    ],
    traceEvidence,
  }, null, 2));
}

async function captureTraceEvidence(input: {
  workspaceId: string;
  adminUserId: string;
  positiveIssueId: string;
}) {
  const proactivePrincipal: Principal = {
    kind: 'fleetgraph_system',
    workspaceId: input.workspaceId,
    isSuperAdmin: false,
  };
  const onDemandPrincipal: Principal = {
    kind: 'session',
    sessionId: 'fleetgraph-demo-trace-session',
    userId: input.adminUserId,
    workspaceId: input.workspaceId,
    isSuperAdmin: false,
  };

  const proactive = await runFleetGraphManualTick({
    workspaceId: input.workspaceId,
    principal: proactivePrincipal,
    limit: 10,
  });

  const findingResult = await pool.query<{ id: string }>(
    `SELECT id
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND source_issue_id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.workspaceId, input.positiveIssueId]
  );
  const findingId = requireFirstRow(findingResult.rows).id;

  const explain = await runFleetGraph({
    workspaceId: input.workspaceId,
    principal: onDemandPrincipal,
    mode: 'on_demand',
    trigger: { type: 'explain_finding', findingId },
    triggerReason: 'demo-why-flagged',
  }, { db: pool });

  const refine = await runFleetGraph({
    workspaceId: input.workspaceId,
    principal: onDemandPrincipal,
    mode: 'on_demand',
    trigger: {
      type: 'refine_draft',
      findingId,
      instruction: 'Make the unblock ask concise and mention the approval dependency.',
    },
    triggerReason: 'demo-refine-draft',
  }, { db: pool });

  return {
    proactive: proactive.results.map((result) => ({
      decision: result.decision,
      findingId: result.finding?.id ?? null,
      traceMetadata: result.traceMetadata,
    })),
    explain: {
      decision: explain.decision,
      findingId,
      traceMetadata: explain.traceMetadata,
    },
    refine: {
      decision: refine.decision,
      findingId,
      traceMetadata: refine.traceMetadata,
    },
  };
}

export async function main(): Promise<void> {
  await seedDemo();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
