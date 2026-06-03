import { type FleetGraphSignalType } from '@ship/shared';
import bcrypt from 'bcryptjs';
import { PASSWORD_BCRYPT_ROUNDS } from '@ship/shared';
import { pool } from '../../db/client.js';
import { STALE_ISSUE_DAYS } from '../../fleetgraph/detection/attention-policy.js';
import { fleetGraphAttentionDedupeKey } from '../../fleetgraph/persistence.js';
import { requireFirstRow } from '../../utils/query-rows.js';

const FALLBACK_WORKSPACE_NAME = 'FleetGraph Demo Workspace';
const SEEDED_APP_WORKSPACE_NAME = 'Ship Workspace';

export const DEMO_FIXTURE_VERSION = 1;
export const STALE_DEMO_ISSUE_DAYS = STALE_ISSUE_DAYS + 1;

type IdRow = { id: string };
export type UserRow = { id: string; email: string; name: string };
type WorkspaceRow = { id: string; sprint_start_date: Date | string };

export function isoDate(date: Date): string {
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

export function assertLocalDemoDatabase(): void {
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

export function demoPassword(): string {
  return process.env.FLEETGRAPH_DEMO_PASSWORD ?? 'admin123';
}

export async function upsertWorkspace(): Promise<WorkspaceRow> {
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

export async function upsertUser(email: string, name: string, workspaceId: string, role: 'admin' | 'member'): Promise<UserRow> {
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

export async function upsertDocument(input: {
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

export async function associate(documentId: string, relatedId: string, relationshipType: 'program' | 'project' | 'sprint'): Promise<void> {
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

export async function ensureIssueTicket(issueId: string, workspaceId: string): Promise<void> {
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

export async function upsertIssueIteration(input: {
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

export async function setDocumentUpdatedAt(documentId: string, updatedAt: Date): Promise<void> {
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

export async function upsertStableDemoFinding(input: {
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
