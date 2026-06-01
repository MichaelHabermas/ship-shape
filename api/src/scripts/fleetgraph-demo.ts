// Idempotent FleetGraph demo setup seeds reviewer-safe attention scenarios.
// Non-local demo seeding requires FLEETGRAPH_DEMO_PASSWORD.
import { pathToFileURL } from 'url';
import { computeCurrentSprintNumber, type FleetGraphSignalType } from '@ship/shared';
import bcrypt from 'bcryptjs';
import { PASSWORD_BCRYPT_ROUNDS } from '@ship/shared';
import { pool } from '../db/client.js';
import { detectFleetGraphAttentionDecisions, findBlockedImportantIssueQuietExits } from '../fleetgraph/detection/detector.js';
import { STALE_ISSUE_DAYS } from '../fleetgraph/detection/attention-policy.js';
import { runFleetGraph } from '../fleetgraph/core.js';
import { scoreFleetGraphObservabilityResult } from '../fleetgraph/observability-scores.js';
import { postFleetGraphTraceScores, shutdownFleetGraphTracing, withFleetGraphTrace } from '../fleetgraph/observability-trace.js';
import { fleetGraphAttentionDedupeKey, saveBlockedImportantIssueFinding } from '../fleetgraph/persistence.js';
import type { Principal } from '../security/principal.js';
import { requireFirstRow } from '../utils/query-rows.js';

const FALLBACK_WORKSPACE_NAME = 'FleetGraph Demo Workspace';
const SEEDED_APP_WORKSPACE_NAME = 'Ship Workspace';
const BASE_URL = process.env.FLEETGRAPH_DEMO_WEB_URL ?? 'http://localhost:5173';
const DEMO_FIXTURE_VERSION = 1;
const STALE_DEMO_ISSUE_DAYS = STALE_ISSUE_DAYS + 1;

type IdRow = { id: string };
type UserRow = { id: string; email: string; name: string };
type WorkspaceRow = { id: string; sprint_start_date: Date | string };
type StableSignalScenario = {
  signals: FleetGraphSignalType[];
  title: string;
  reasons: string[];
};
export type FleetGraphDemoTraceEvidence = Awaited<ReturnType<typeof captureTraceEvidence>>;
export type FleetGraphDemoReport = Awaited<ReturnType<typeof seedFleetGraphDemo>>;

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
  if (process.env.FLEETGRAPH_DEMO_ALLOW_NONLOCAL_DB === '1') {
    if (!process.env.FLEETGRAPH_DEMO_PASSWORD) {
      throw new Error('FLEETGRAPH_DEMO_PASSWORD is required when seeding a non-local FleetGraph demo database.');
    }
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const parsed = new URL(databaseUrl);
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (localHosts.has(parsed.hostname)) return;

  throw new Error('Refusing to seed the FleetGraph demo world against a non-local DATABASE_URL. Set FLEETGRAPH_DEMO_ALLOW_NONLOCAL_DB=1 only for an intentional demo database.');
}

function demoPassword(): string {
  return process.env.FLEETGRAPH_DEMO_PASSWORD ?? 'admin123';
}

async function upsertWorkspace(): Promise<WorkspaceRow> {
  const seededAppWorkspace = await pool.query<WorkspaceRow>(
    `SELECT w.id, w.sprint_start_date
       FROM workspaces w
      WHERE w.name = $1
        AND w.archived_at IS NULL
      ORDER BY (
        SELECT COUNT(*)
          FROM documents d
         WHERE d.workspace_id = w.id
           AND d.deleted_at IS NULL
           AND d.archived_at IS NULL
      ) DESC
      LIMIT 1`,
    [SEEDED_APP_WORKSPACE_NAME]
  );
  if (seededAppWorkspace.rows[0]) {
    await pool.query(
      'UPDATE workspaces SET sprint_start_date = $2 WHERE id = $1',
      [seededAppWorkspace.rows[0].id, mondayWeeksAgo(6)]
    );
    return { ...seededAppWorkspace.rows[0], sprint_start_date: mondayWeeksAgo(6) };
  }

  const existing = await pool.query<WorkspaceRow>(
    'SELECT id, sprint_start_date FROM workspaces WHERE name = $1 ORDER BY created_at ASC LIMIT 1',
    [FALLBACK_WORKSPACE_NAME]
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
    [FALLBACK_WORKSPACE_NAME, mondayWeeksAgo(6)]
  );
  return requireFirstRow(created.rows);
}

async function upsertUser(email: string, name: string, workspaceId: string, role: 'admin' | 'member'): Promise<UserRow> {
  const passwordHash = await bcrypt.hash(demoPassword(), PASSWORD_BCRYPT_ROUNDS);
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

async function setDocumentUpdatedAt(documentId: string, updatedAt: Date): Promise<void> {
  await pool.query(
    'UPDATE documents SET updated_at = $2 WHERE id = $1',
    [documentId, updatedAt]
  );
}

function stableDemoDedupeKey(input: {
  signalType: FleetGraphSignalType;
  workspaceId: string;
  issueId: string;
  sprintId: string;
  signalIndex?: number;
}): string {
  const baseKey = fleetGraphAttentionDedupeKey({
    signalType: input.signalType,
    workspaceId: input.workspaceId,
    issueId: input.issueId,
    sprintId: input.sprintId,
  });
  return input.signalIndex === undefined ? baseKey : `${baseKey}:demo-${input.signalIndex}`;
}

function demoFindingMetadata(input: {
  signalType: FleetGraphSignalType;
  reason: string;
  multiSignal?: boolean;
}) {
  return {
    mode: 'proactive',
    decision: 'create_finding',
    signalType: input.signalType,
    reason: input.reason,
    demo_fixture: true,
    demo_fixture_version: DEMO_FIXTURE_VERSION,
    multiSignal: input.multiSignal ?? false,
  };
}

async function upsertStableDemoFinding(input: {
  workspaceId: string;
  issueId: string;
  sprintId: string;
  signalType: FleetGraphSignalType;
  title: string;
  summary: string;
  assignee: UserRow;
  signalIndex?: number;
  multiSignal?: boolean;
}): Promise<string> {
  const dedupeKey = stableDemoDedupeKey({
    signalType: input.signalType,
    workspaceId: input.workspaceId,
    issueId: input.issueId,
    sprintId: input.sprintId,
    signalIndex: input.signalIndex,
  });
  const evidence = [
    {
      kind: 'source_issue',
      sourceDocumentId: input.issueId,
      sourceType: 'issue',
      claim: input.title,
      visibility: 'internal',
      visibleFields: ['title', 'ticket_number', 'priority', 'state'],
    },
    {
      kind: input.signalType === 'blocked' ? 'blocker' : input.signalType,
      sourceDocumentId: input.issueId,
      sourceType: 'issue',
      claim: input.signalType === 'blocked' ? 'Current blocker' : input.summary,
      excerpt: input.summary,
      visibility: 'internal',
      visibleFields: ['state', 'priority', 'updated_at', 'due_date'],
    },
  ];
  const metadata = demoFindingMetadata({
    signalType: input.signalType,
    reason: input.summary,
    multiSignal: input.multiSignal,
  });

  const updated = await pool.query<IdRow>(
    `UPDATE fleetgraph_findings
        SET source_issue_id = $2,
            source_sprint_id = $3,
            status = 'open',
            severity = $4,
            confidence = $5,
            title = $6,
            summary = $7,
            evidence_snapshot = $8::jsonb,
            recommended_action = $9::jsonb,
            draft_content = $10::jsonb,
            proposed_recipient = $11::jsonb,
            human_gate = $12::jsonb,
            trace_metadata = $13::jsonb,
            run_metadata = $14::jsonb,
            last_detected_at = NOW(),
            resolved_at = NULL,
            dismissed_at = NULL,
            dismissed_by = NULL,
            updated_at = NOW()
      WHERE workspace_id = $1
        AND dedupe_key = $15
        AND (
          COALESCE((run_metadata->>'demo_fixture')::boolean, false) = true
          OR COALESCE((run_metadata->>'seed')::boolean, false) = true
          OR (source_issue_id = $2 AND source_sprint_id = $3)
          OR title LIKE 'FG Demo - %'
          OR title LIKE 'FG-%'
        )
      RETURNING id`,
    [
      input.workspaceId,
      input.issueId,
      input.sprintId,
      input.signalType === 'at_risk' ? 'urgent' : 'high',
      input.multiSignal ? 0.9 : 0.86,
      input.title,
      input.summary,
      JSON.stringify(evidence),
      JSON.stringify({
        label: input.signalType === 'blocked' ? 'Unblock issue' : input.signalType === 'stale' ? 'Refresh plan' : 'Reduce risk',
        summary: input.multiSignal
          ? 'Resolve this signal while preserving the other active demo signals on the same issue.'
          : 'Open the issue, confirm the owner, and record the next dated action.',
      }),
      JSON.stringify({
        subject: input.title,
        body: `Please update ${input.title}. ${input.summary}`,
      }),
      JSON.stringify({
        role: 'issue_assignee',
        userId: input.assignee.id,
        displayName: input.assignee.name,
        rationale: 'Seeded FleetGraph demo scenario routes the notification to the issue assignee.',
      }),
      JSON.stringify({ required: false, reason: 'fleetgraph_demo_fixture' }),
      JSON.stringify({ demoFixture: true }),
      JSON.stringify(metadata),
      dedupeKey,
    ]
  );
  if (updated.rows[0]) return updated.rows[0].id;

  const inserted = await pool.query<IdRow>(
    `INSERT INTO fleetgraph_findings (
       workspace_id, source_issue_id, source_sprint_id, dedupe_key,
       status, severity, confidence, title, summary, evidence_snapshot,
       recommended_action, draft_content, proposed_recipient, human_gate,
       trace_metadata, run_metadata
     )
     VALUES (
       $1, $2, $3, $4, 'open', $5, $6, $7, $8, $9::jsonb,
       $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
       $14::jsonb, $15::jsonb
     )
     RETURNING id`,
    [
      input.workspaceId,
      input.issueId,
      input.sprintId,
      dedupeKey,
      input.signalType === 'at_risk' ? 'urgent' : 'high',
      input.multiSignal ? 0.9 : 0.86,
      input.title,
      input.summary,
      JSON.stringify(evidence),
      JSON.stringify({
        label: input.signalType === 'blocked' ? 'Unblock issue' : input.signalType === 'stale' ? 'Refresh plan' : 'Reduce risk',
        summary: input.multiSignal
          ? 'Resolve this signal while preserving the other active demo signals on the same issue.'
          : 'Open the issue, confirm the owner, and record the next dated action.',
      }),
      JSON.stringify({
        subject: input.title,
        body: `Please update ${input.title}. ${input.summary}`,
      }),
      JSON.stringify({
        role: 'issue_assignee',
        userId: input.assignee.id,
        displayName: input.assignee.name,
        rationale: 'Seeded FleetGraph demo scenario routes the notification to the issue assignee.',
      }),
      JSON.stringify({ required: false, reason: 'fleetgraph_demo_fixture' }),
      JSON.stringify({ demoFixture: true }),
      JSON.stringify(metadata),
    ]
  );

  return requireFirstRow(inserted.rows).id;
}

async function seedStableAttentionFixtures(input: {
  workspaceId: string;
  programId: string;
  projectId: string;
  sprintId: string;
  assignee: UserRow;
  adminId: string;
}): Promise<{ issueCount: number; findingCount: number }> {
  const singleSignalGroups: Array<{
    signalType: FleetGraphSignalType;
    state: string;
    prefix: string;
    summaries: Array<[string, string]>;
  }> = [
    {
      signalType: 'blocked',
      state: 'blocked',
      prefix: 'FG-BLOCKED',
      summaries: [
        ['SSO callback contract blocked by identity provider review', 'Waiting on the identity team to confirm the callback payload and signing key rotation window.'],
        ['Payment reconciliation blocked by missing treasury sample file', 'The importer cannot be validated until Finance provides the May close sample.'],
        ['Notification digest blocked on email domain approval', 'SES domain verification is still pending with platform operations.'],
        ['Role migration blocked by production permission export', 'The migration plan needs the current role export before cutover.'],
        ['Mobile upload flow blocked by antivirus vendor response', 'The attachment scanner is rejecting signed iOS uploads.'],
        ['Data retention job blocked by legal hold matrix', 'Legal has not marked which document classes are exempt from retention.'],
        ['Bulk move blocked by week ownership ambiguity', 'The team has not decided whether owner reassignment follows moved issues.'],
        ['Reviewer console blocked by CSP exception approval', 'The evidence viewer needs one approved frame-src exception.'],
        ['Audit export blocked by column classification', 'Security has not classified two export columns for masking.'],
        ['Workspace invite flow blocked by SMTP bounce analysis', 'Agency-domain invites are bouncing pending DMARC analysis.'],
      ],
    },
    {
      signalType: 'stale',
      state: 'in_progress',
      prefix: 'FG-STALE',
      summaries: [
        ['Search relevance tuning has not moved since kickoff', `No implementation update has landed for more than ${STALE_ISSUE_DAYS} days.`],
        ['Project health rollup stalled after initial schema notes', 'The issue has old design notes but no recent code, comment, or status movement.'],
        ['Attachment preview accessibility follow-up is idle', 'The accessibility finding remains open and predates the current review cycle.'],
        ['API pagination cleanup stopped after route inventory', 'The route inventory was captured but endpoints were not converted.'],
        ['Week dashboard empty-state copy is aging out', `The copy decision has been unchanged for more than ${STALE_ISSUE_DAYS} days.`],
        ['Document conversion audit has no recent evidence', 'The checklist has not been updated since the first test pass.'],
        ['Resource allocation export has gone quiet', 'The issue has an owner and estimate but no recent movement.'],
        ['Keyboard navigation polish is still open after review', 'The keyboard review notes are still unresolved.'],
        ['Program breadcrumb cleanup has stale design assumptions', 'The issue references an old navigation model.'],
        ['Bulk selection affordance has no current owner signal', 'The issue remains assigned with no current next action.'],
      ],
    },
    {
      signalType: 'at_risk',
      state: 'todo',
      prefix: 'FG-RISK',
      summaries: [
        ['Security evidence bundle at risk for reviewer deadline', 'The issue is due soon and lacks automated evidence links.'],
        ['Week close reconciliation at risk due to unresolved children', 'Several child issues remain incomplete before close.'],
        ['Invite acceptance flow at risk from cross-browser gap', 'Safari coverage is missing for the collaborator redirect path.'],
        ['Audit log viewer at risk from large workspace load', 'The query is still unpaged for large workspaces.'],
        ['Program status badge at risk from mixed source states', 'The rollup combines stale, blocked, and cancelled issues without clear precedence.'],
        ['Export redaction at risk before compliance demo', 'Masking rules are still represented as notes only.'],
        ['FleetGraph explain action at risk from missing draft path', 'The recommended draft path is not validated end to end.'],
        ['My Week accountability at risk from skipped plan coverage', 'Some assignees have active week work and no plan document.'],
        ['Project retro summary at risk from incomplete impact data', 'Actual impact and next-step data are missing.'],
        ['Realtime document handoff at risk from reconnect edge case', 'Collaboration recovers after refresh but not after network drop.'],
      ],
    },
  ];
  const multiSignalIssues: StableSignalScenario[] = [
    { signals: ['blocked', 'stale'], title: 'Agency SSO redirect has stalled behind certificate approval', reasons: ['Certificate approval is blocking redirect validation.', `The redirect issue has had no meaningful update for ${STALE_DEMO_ISSUE_DAYS} days.`] },
    { signals: ['blocked', 'stale'], title: 'Reviewer evidence import waits on sample archive', reasons: ['The reviewer sample archive has not been delivered.', 'The import plan has not changed since the first spike.'] },
    { signals: ['blocked', 'at_risk'], title: 'Compliance export masking is blocked near demo', reasons: ['Data classification is missing for two export fields.', 'The compliance demo is inside the current delivery window.'] },
    { signals: ['blocked', 'at_risk'], title: 'Workspace invite recovery is blocked before pilot', reasons: ['SMTP alignment remains unresolved for pilot domains.', 'Pilot onboarding depends on this path this week.'] },
    { signals: ['stale', 'at_risk'], title: 'Program health rollup has old precedence assumptions', reasons: ['The rollup logic has not been refreshed after FleetGraph labels shipped.', 'Mixed-status programs may show the wrong executive summary.'] },
    { signals: ['stale', 'at_risk'], title: 'My Week plan gaps are aging into accountability noise', reasons: ['The missing-plan cases have not been revisited since last week.', 'Managers will see noisy action items during planning.'] },
    { signals: ['blocked', 'stale', 'at_risk'], title: 'Security console deploy readiness is blocked and aging', reasons: ['AWS environment approval is still pending.', `The deployment checklist has not moved in ${STALE_DEMO_ISSUE_DAYS} days.`, 'Reviewer access depends on this before the next evidence package.'] },
    { signals: ['blocked', 'stale', 'at_risk'], title: 'External feedback triage migration needs owner decision', reasons: ['Product has not approved the migration mapping.', 'The migration issue has stale acceptance criteria.', 'Untriaged feedback will leak into the pilot dashboard.'] },
  ];
  let issueCount = 0;
  let findingCount = 0;
  const now = new Date();

  for (const group of singleSignalGroups) {
    for (let index = 0; index < group.summaries.length; index++) {
      const summaryEntry = group.summaries[index];
      if (!summaryEntry) {
        throw new Error(`Missing FleetGraph demo summary at index ${index}`);
      }
      const [title, summary] = summaryEntry;
      const issueTitle = `${group.prefix}-${String(index + 1).padStart(2, '0')} ${title}`;
      const issueId = await upsertDocument({
        workspaceId: input.workspaceId,
        type: 'issue',
        title: issueTitle,
        properties: {
          state: group.state,
          priority: group.signalType === 'at_risk' || index % 3 === 0 ? 'urgent' : 'high',
          source: 'internal',
          assignee_id: input.assignee.id,
          estimate: 3 + (index % 6),
          due_date: isoDate(new Date(now.getTime() + (index + 1) * 86_400_000)),
          blocker_text: group.signalType === 'blocked' ? summary : null,
          blocked_reason: group.signalType === 'blocked' ? summary : null,
          attention_seed: group.signalType,
          demo_fixture: true,
        },
        createdBy: input.adminId,
      });
      await ensureIssueTicket(issueId, input.workspaceId);
      await associate(issueId, input.programId, 'program');
      await associate(issueId, input.projectId, 'project');
      await associate(issueId, input.sprintId, 'sprint');
      await upsertIssueIteration({
        issueId,
        workspaceId: input.workspaceId,
        authorId: input.assignee.id,
        whatAttempted: `Stable FleetGraph demo ${group.signalType}: ${title}`,
        blockerText: group.signalType === 'blocked' ? summary : null,
        createdAt: new Date(now.getTime() - (group.signalType === 'stale' ? STALE_DEMO_ISSUE_DAYS : 5 + index) * 86_400_000),
      });
      if (group.signalType === 'stale') {
        await setDocumentUpdatedAt(issueId, new Date(now.getTime() - STALE_DEMO_ISSUE_DAYS * 86_400_000));
      }
      await upsertStableDemoFinding({
        workspaceId: input.workspaceId,
        issueId,
        sprintId: input.sprintId,
        signalType: group.signalType,
        title,
        summary,
        assignee: input.assignee,
      });
      issueCount++;
      findingCount++;
    }
  }

  for (let index = 0; index < multiSignalIssues.length; index++) {
    const scenario = multiSignalIssues[index];
    if (!scenario) {
      throw new Error(`Missing FleetGraph multi-signal scenario at index ${index}`);
    }
    const issueTitle = `FG-MULTI-${String(index + 1).padStart(2, '0')} ${scenario.title}`;
    const issueId = await upsertDocument({
      workspaceId: input.workspaceId,
      type: 'issue',
      title: issueTitle,
      properties: {
        state: scenario.signals.includes('blocked') ? 'blocked' : 'in_progress',
        priority: scenario.signals.includes('at_risk') ? 'urgent' : 'high',
        source: 'internal',
        assignee_id: input.assignee.id,
        estimate: 5 + (index % 8),
        due_date: isoDate(new Date(now.getTime() + ((index % 5) + 1) * 86_400_000)),
        blocker_text: scenario.signals.includes('blocked') ? scenario.reasons[0] : null,
        blocked_reason: scenario.signals.includes('blocked') ? scenario.reasons[0] : null,
        attention_seed: 'multi_signal',
        attention_signals: scenario.signals,
        demo_fixture: true,
      },
      createdBy: input.adminId,
    });
    await ensureIssueTicket(issueId, input.workspaceId);
    await associate(issueId, input.programId, 'program');
    await associate(issueId, input.projectId, 'project');
    await associate(issueId, input.sprintId, 'sprint');
    await upsertIssueIteration({
      issueId,
      workspaceId: input.workspaceId,
      authorId: input.assignee.id,
      whatAttempted: `Stable FleetGraph multi-signal demo: ${scenario.title}`,
      blockerText: scenario.signals.includes('blocked') ? (scenario.reasons[0] ?? null) : null,
      createdAt: new Date(now.getTime() - STALE_DEMO_ISSUE_DAYS * 86_400_000),
    });
    if (scenario.signals.includes('stale')) {
      await setDocumentUpdatedAt(issueId, new Date(now.getTime() - STALE_DEMO_ISSUE_DAYS * 86_400_000));
    }
    for (let signalIndex = 0; signalIndex < scenario.signals.length; signalIndex++) {
      const signalType = scenario.signals[signalIndex];
      if (!signalType) {
        throw new Error(`Missing FleetGraph signal at index ${signalIndex}`);
      }
      await upsertStableDemoFinding({
        workspaceId: input.workspaceId,
        issueId,
        sprintId: input.sprintId,
        signalType,
        title: `${scenario.title} (${signalType})`,
        summary: scenario.reasons[signalIndex] ?? scenario.reasons[0] ?? scenario.title,
        assignee: input.assignee,
        signalIndex,
        multiSignal: true,
      });
      findingCount++;
    }
    issueCount++;
  }

  return { issueCount, findingCount };
}

export async function seedFleetGraphDemo(options: {
  captureTraces?: boolean;
} = {}) {
  assertLocalDemoDatabase();
  const workspace = await upsertWorkspace();
  const currentSprintNumber = computeCurrentSprintNumber(new Date(workspace.sprint_start_date));

  const admin = await upsertUser('fleetgraph.reviewer@ship.local', 'FleetGraph Reviewer', workspace.id, 'admin');
  const engineer = await upsertUser('fleetgraph.engineer@ship.local', 'Riley Builder', workspace.id, 'member');
  const pm = await upsertUser('fleetgraph.pm@ship.local', 'Morgan Project Owner', workspace.id, 'member');
  const lead = await upsertUser('fleetgraph.lead@ship.local', 'Dana Program Lead', workspace.id, 'member');
  const dependency = await upsertUser('fleetgraph.dependency@ship.local', 'Casey Dependency Owner', workspace.id, 'member');

  await upsertDocument({
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
    properties: { sprint_number: currentSprintNumber, status: 'active', owner_id: pm.id },
    createdBy: admin.id,
  });
  const inactiveSprintId = await upsertDocument({
    workspaceId: workspace.id,
    type: 'sprint',
    title: `FleetGraph Demo Week ${currentSprintNumber - 1}`,
    properties: { sprint_number: currentSprintNumber - 1, status: 'completed', owner_id: pm.id },
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
      key: 'at-risk',
      title: 'FG Demo - At-risk rollout checklist',
      properties: { state: 'in_progress', priority: 'urgent', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo at risk: urgent current-week work',
      ageDays: 4,
    },
    {
      key: 'missing-owner',
      title: 'FG Demo - At-risk unowned launch task',
      properties: { state: 'todo', priority: 'high', source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo at risk: missing owner',
      ageDays: 1,
    },
    {
      key: 'stale',
      title: 'FG Demo - Stale integration cleanup',
      properties: { state: 'in_progress', priority: 'medium', assignee_id: engineer.id, source: 'internal' },
      sprintId: activeSprintId,
      blockerText: null,
      whatAttempted: 'FleetGraph demo stale: integration cleanup',
      ageDays: 210,
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
      blockerText: 'Blocked even though medium priority; blocked state alone should surface it.',
      whatAttempted: 'FleetGraph demo blocker: medium priority blocker',
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
      createdAt: new Date(now.getTime() - ((issue.ageDays ?? 0) * 86_400_000) - issueIds.size * 60_000),
    });
    if (issue.ageDays) {
      await setDocumentUpdatedAt(issueId, new Date(now.getTime() - issue.ageDays * 86_400_000));
    }
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
    runMetadata: {
      signalType: 'blocked',
      reason: 'Seeded duplicate open finding.',
      demo_fixture: true,
      demo_fixture_version: DEMO_FIXTURE_VERSION,
    },
  });
  const stableFixtures = await seedStableAttentionFixtures({
    workspaceId: workspace.id,
    programId,
    projectId,
    sprintId: activeSprintId,
    assignee: engineer,
    adminId: admin.id,
  });

  const decisions = await detectFleetGraphAttentionDecisions({ workspaceId: workspace.id });
  const quietExits = await findBlockedImportantIssueQuietExits({ workspaceId: workspace.id });
  const traceEvidence = options.captureTraces
    ? await captureTraceEvidence({
      workspaceId: workspace.id,
      adminUserId: admin.id,
      positiveIssueId: issueIds.get('auth') ?? '',
    })
    : null;

  return {
    workspaceId: workspace.id,
    currentSprintNumber,
    reviewerLogin: admin.email,
    reviewerPassword: demoPassword(),
    decisionCount: decisions.length,
    stableFixtures,
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
      'Use the FleetGraph explain API for legacy on-demand trace continuity proof.',
      'Use the FleetGraph refine API for legacy draft trace continuity proof.',
      'Rerun detector after duplicate finding exists for update/quiet proof.',
    ],
    traceEvidence,
  };
}

export async function captureTraceEvidence(input: {
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

  const decisions = await detectFleetGraphAttentionDecisions({ workspaceId: input.workspaceId, db: pool });
  const positiveDecision = decisions.find((decision) => decision.candidate.issue_id === input.positiveIssueId);
  if (!positiveDecision) throw new Error('Missing positive FleetGraph demo decision for trace capture');
  const staleDecision = decisions.find((decision) => decision.candidate.signalType === 'stale');
  if (!staleDecision) throw new Error('Missing stale FleetGraph demo decision for trace capture');
  const atRiskDecision = decisions.find((decision) => decision.candidate.signalType === 'at_risk');
  if (!atRiskDecision) throw new Error('Missing at-risk FleetGraph demo decision for trace capture');

  const proactive = await withFleetGraphTrace({
    name: 'fleetgraph.proactive_create',
    inputs: {
      mode: 'proactive',
      trigger: 'detector_decision',
      decision: positiveDecision.decision,
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: proactivePrincipal,
    mode: 'proactive',
    trigger: { type: 'detector_decision', detectorDecision: positiveDecision },
    triggerReason: 'demo-proactive-create',
  }, { db: pool, externalTrace, traceRecorder }));

  const stale = await withFleetGraphTrace({
    name: 'fleetgraph.proactive_stale',
    inputs: {
      mode: 'proactive',
      trigger: 'detector_decision',
      signalType: 'stale',
      decision: staleDecision.decision,
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: proactivePrincipal,
    mode: 'proactive',
    trigger: { type: 'detector_decision', detectorDecision: staleDecision },
    triggerReason: 'demo-proactive-stale',
  }, { db: pool, externalTrace, traceRecorder }));

  const atRisk = await withFleetGraphTrace({
    name: 'fleetgraph.proactive_at_risk',
    inputs: {
      mode: 'proactive',
      trigger: 'detector_decision',
      signalType: 'at_risk',
      decision: atRiskDecision.decision,
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: proactivePrincipal,
    mode: 'proactive',
    trigger: { type: 'detector_decision', detectorDecision: atRiskDecision },
    triggerReason: 'demo-proactive-at-risk',
  }, { db: pool, externalTrace, traceRecorder }));

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

  const explain = await withFleetGraphTrace({
    name: 'fleetgraph.on_demand_explain',
    inputs: {
      mode: 'on_demand',
      trigger: 'explain_finding',
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: onDemandPrincipal,
    mode: 'on_demand',
    trigger: { type: 'explain_finding', findingId },
    triggerReason: 'demo-why-flagged',
  }, { db: pool, externalTrace, traceRecorder }));

  const refine = await withFleetGraphTrace({
    name: 'fleetgraph.on_demand_refine',
    inputs: {
      mode: 'on_demand',
      trigger: 'refine_draft',
    },
  }, (externalTrace, traceRecorder) => runFleetGraph({
    workspaceId: input.workspaceId,
    principal: onDemandPrincipal,
    mode: 'on_demand',
    trigger: {
      type: 'refine_draft',
      findingId,
      instruction: 'Make the unblock ask concise and mention the approval dependency.',
    },
    triggerReason: 'demo-refine-draft',
  }, { db: pool, externalTrace, traceRecorder }));

  return {
    proactive: await traceEvidenceFor(proactive),
    stale: await traceEvidenceFor(stale),
    atRisk: await traceEvidenceFor(atRisk),
    explain: await traceEvidenceFor(explain),
    refine: await traceEvidenceFor(refine),
  };
}

async function traceEvidenceFor(capture: Awaited<ReturnType<typeof withFleetGraphTrace>>) {
  const observabilityScores = scoreFleetGraphObservabilityResult(capture.result);
  const scorePostFailures = await postFleetGraphTraceScores({
    providers: capture.providers,
    scores: observabilityScores,
  });
  return {
    decision: capture.result.decision,
    findingId: capture.result.finding?.id ?? null,
    traceId: capture.traceId,
    traceUrl: capture.traceUrl,
    sharedTraceUrl: capture.sharedTraceUrl,
    providers: capture.providers,
    providerFailures: capture.providerFailures,
    observabilityScores,
    scorePostFailures,
    tokenMetadata: capture.result.tokenMetadata,
    costMetadata: capture.result.costMetadata,
    traceMetadata: capture.result.traceMetadata,
  };
}

export async function main(): Promise<void> {
  const report = await seedFleetGraphDemo({
    captureTraces: process.argv.includes('--capture-traces'),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await shutdownFleetGraphTracing().catch(() => undefined);
      await pool.end();
    });
}
