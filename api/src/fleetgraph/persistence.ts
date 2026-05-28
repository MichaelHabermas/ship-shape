// FleetGraph persistence helpers own finding/run writes without mutating Ship source records.
import type { FleetGraphRunMode, FleetGraphSeverity, FleetGraphSignalType } from '@ship/shared';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/client.js';
import { requireFirstRow } from '../utils/query-rows.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type FleetGraphFindingStatus =
  | 'open'
  | 'needs_confirmation'
  | 'dismissed'
  | 'resolved'
  | 'suppressed'
  | 'error';

export type FleetGraphRunDecision =
  | 'quiet_exit'
  | 'create_finding'
  | 'update_finding'
  | 'explain'
  | 'refine_draft'
  | 'summarize_changes'
  | 'needs_confirmation'
  | 'dismiss'
  | 'resolve'
  | 'suppress'
  | 'error';

export type JsonRecord = Record<string, unknown>;

type FleetGraphFindingRow = {
  id: string;
  workspace_id: string;
  source_issue_id: string;
  source_sprint_id: string;
  dedupe_key: string;
  status: FleetGraphFindingStatus;
  severity: FleetGraphSeverity;
  confidence: string | number;
  title: string;
  summary: string;
  evidence_snapshot: unknown[];
  recommended_action: JsonRecord;
  draft_content: JsonRecord;
  proposed_recipient: JsonRecord;
  human_gate: JsonRecord;
  trace_metadata: JsonRecord;
  run_metadata: JsonRecord;
  first_detected_at: Date;
  last_detected_at: Date;
  resolved_at: Date | null;
  dismissed_at: Date | null;
  dismissed_by: string | null;
  created_at: Date;
  updated_at: Date;
};

type FleetGraphNotificationRow = FleetGraphFindingRow & {
  issue_title: string;
  context_title: string | null;
  owner_name: string | null;
  read_at: Date | null;
};

export type FleetGraphAttentionEventType =
  | 'issue_changed'
  | 'issue_iteration_added'
  | 'issue_week_changed'
  | 'issue_visibility_changed'
  | 'repair_scan';

export type FleetGraphAttentionEventStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'skipped';

type FleetGraphAttentionEventRow = {
  id: string;
  workspace_id: string;
  source_issue_id: string;
  source_sprint_id: string | null;
  event_type: FleetGraphAttentionEventType;
  reason: string;
  status: FleetGraphAttentionEventStatus;
  attempt_count: number;
  last_error: string | null;
  available_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type FleetGraphRunRow = {
  id: string;
  workspace_id: string;
  finding_id: string | null;
  source_issue_id: string | null;
  source_sprint_id: string | null;
  mode: FleetGraphRunMode;
  trigger_reason: string;
  decision: FleetGraphRunDecision;
  dedupe_key: string | null;
  input_snapshot: JsonRecord;
  evidence_snapshot: unknown[];
  output_snapshot: JsonRecord;
  trace_metadata: JsonRecord;
  token_metadata: JsonRecord;
  cost_metadata: JsonRecord;
  error_metadata: JsonRecord;
  started_at: Date;
  completed_at: Date | null;
  created_at: Date;
};

type FleetGraphWorkerTickRow = {
  id: string;
  instance_id: string;
  status: FleetGraphWorkerTickStatus;
  started_at: Date;
  heartbeat_at: Date;
  deadline_at: Date;
  completed_at: Date | null;
  workspace_count: number;
  detector_decision_count: number;
  result_count: number;
  model_call_count: number;
  error_metadata: JsonRecord;
  audit_metadata: JsonRecord;
  created_at: Date;
};

export type FleetGraphFinding = Omit<FleetGraphFindingRow, 'confidence'> & {
  confidence: number;
};

export type FleetGraphNotificationFinding = FleetGraphFinding & {
  issue_title: string;
  context_title: string | null;
  owner_name: string | null;
  read_at: Date | null;
};

export type FleetGraphRun = FleetGraphRunRow;
export type FleetGraphAttentionEvent = FleetGraphAttentionEventRow;

export type FleetGraphWorkerTickStatus = 'running' | 'completed' | 'failed' | 'skipped_lock';

export type FleetGraphWorkerTick = FleetGraphWorkerTickRow;

export type SaveBlockedImportantIssueFindingInput = {
  workspaceId: string;
  sourceIssueId: string;
  sourceSprintId: string;
  status?: Extract<FleetGraphFindingStatus, 'open' | 'needs_confirmation' | 'error'>;
  severity: FleetGraphSeverity;
  confidence: number;
  title: string;
  summary: string;
  evidenceSnapshot?: unknown[];
  recommendedAction?: JsonRecord;
  draftContent?: JsonRecord;
  proposedRecipient?: JsonRecord;
  humanGate?: JsonRecord;
  traceMetadata?: JsonRecord;
  runMetadata?: JsonRecord;
};

export type RecordFleetGraphRunInput = {
  workspaceId: string;
  findingId?: string | null;
  sourceIssueId?: string | null;
  sourceSprintId?: string | null;
  mode: FleetGraphRunMode;
  triggerReason: string;
  decision: FleetGraphRunDecision;
  dedupeKey?: string | null;
  inputSnapshot?: JsonRecord;
  evidenceSnapshot?: unknown[];
  outputSnapshot?: JsonRecord;
  traceMetadata?: JsonRecord;
  tokenMetadata?: JsonRecord;
  costMetadata?: JsonRecord;
  errorMetadata?: JsonRecord;
  completedAt?: Date | null;
};

export type CompleteFleetGraphWorkerTickInput = {
  tickId: string;
  status: Exclude<FleetGraphWorkerTickStatus, 'running'>;
  workspaceCount?: number;
  detectorDecisionCount?: number;
  resultCount?: number;
  modelCallCount?: number;
  errorMetadata?: JsonRecord;
  auditMetadata?: JsonRecord;
};

export type EnqueueFleetGraphAttentionEventInput = {
  workspaceId: string;
  sourceIssueId: string;
  sourceSprintId?: string | null;
  eventType: FleetGraphAttentionEventType;
  reason: string;
  availableAt?: Date;
};

export type ClaimFleetGraphAttentionEventsInput = {
  lockedBy: string;
  limit?: number;
  now?: Date;
  leaseTimeoutMinutes?: number;
};

export type CompleteFleetGraphAttentionEventInput = {
  eventId: string;
  status: Extract<FleetGraphAttentionEventStatus, 'completed' | 'failed' | 'skipped'>;
  lastError?: string | null;
};

export const BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX = 'blocked-important-issue';
export const STALE_ISSUE_DEDUPE_PREFIX = 'stale-issue';
export const AT_RISK_ISSUE_DEDUPE_PREFIX = 'at-risk-issue';
const ATTENTION_EVENT_LEASE_TIMEOUT_MINUTES = 10;

function mapFinding(row: FleetGraphFindingRow): FleetGraphFinding {
  return {
    ...row,
    confidence: Number(row.confidence),
  };
}

function mapNotificationFinding(row: FleetGraphNotificationRow): FleetGraphNotificationFinding {
  return {
    ...mapFinding(row),
    issue_title: row.issue_title,
    context_title: row.context_title,
    owner_name: row.owner_name,
    read_at: row.read_at,
  };
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value);
}

export function blockedImportantIssueDedupeKey(input: {
  workspaceId: string;
  issueId: string;
  sprintId: string;
}): string {
  return `${BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX}:${input.workspaceId}:${input.issueId}:${input.sprintId}`;
}

export function fleetGraphAttentionDedupeKey(input: {
  signalType: FleetGraphSignalType;
  workspaceId: string;
  issueId: string;
  sprintId: string;
}): string {
  return `${dedupePrefixForSignalType(input.signalType)}:${input.workspaceId}:${input.issueId}:${input.sprintId}`;
}

export function signalTypeFromDedupeKey(dedupeKey: string): FleetGraphSignalType {
  if (dedupeKey.startsWith(`${STALE_ISSUE_DEDUPE_PREFIX}:`)) return 'stale';
  if (dedupeKey.startsWith(`${AT_RISK_ISSUE_DEDUPE_PREFIX}:`)) return 'at_risk';
  return 'blocked';
}

export function fleetGraphSignalType(value: unknown): FleetGraphSignalType {
  return value === 'stale' || value === 'at_risk' || value === 'blocked' ? value : 'blocked';
}

export function signalLabelForType(signalType: FleetGraphSignalType): string {
  switch (signalType) {
    case 'blocked':
      return 'Blocked';
    case 'stale':
      return 'Stale';
    case 'at_risk':
      return 'At risk';
  }
}

export function dedupePrefixForSignalType(signalType: FleetGraphSignalType): string {
  switch (signalType) {
    case 'blocked':
      return BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX;
    case 'stale':
      return STALE_ISSUE_DEDUPE_PREFIX;
    case 'at_risk':
      return AT_RISK_ISSUE_DEDUPE_PREFIX;
  }
}

export function sqlBlockedImportantIssueDedupeKey(
  workspaceColumn: string,
  issueColumn: string,
  sprintColumn: string,
): string {
  return `CONCAT('${BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX}', ':', ${workspaceColumn}, ':', ${issueColumn}, ':', ${sprintColumn})`;
}

export async function getOpenFleetGraphFindingByDedupeKey(
  workspaceId: string,
  dedupeKey: string,
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `SELECT *
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND dedupe_key = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      LIMIT 1`,
    [workspaceId, dedupeKey]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function getFleetGraphFindingById(
  input: { workspaceId: string; findingId: string },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `SELECT *
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND id = $2
      LIMIT 1`,
    [input.workspaceId, input.findingId]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function listFleetGraphFindingsForSource(
  input: { workspaceId: string; sourceIssueId?: string; sourceSprintId?: string },
  db: QueryRunner = pool
): Promise<FleetGraphFinding[]> {
  const result = await db.query<FleetGraphFindingRow>(
    `SELECT *
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND ($2::uuid IS NULL OR source_issue_id = $2::uuid)
        AND ($3::uuid IS NULL OR source_sprint_id = $3::uuid)
        AND status IN ('open', 'needs_confirmation', 'error')
      ORDER BY updated_at DESC`,
    [input.workspaceId, input.sourceIssueId ?? null, input.sourceSprintId ?? null]
  );

  return result.rows.map(mapFinding);
}

export async function listFleetGraphNotificationFindings(
  input: { workspaceId: string; userId?: string; limit?: number },
  db: QueryRunner = pool
): Promise<FleetGraphNotificationFinding[]> {
  const limit = input.limit ?? 25;
  const result = await db.query<FleetGraphNotificationRow>(
    `SELECT f.*,
            issue.title AS issue_title,
            sprint.title AS context_title,
            COALESCE(owner.name, owner_person_user.name, owner_person.title, assignee.name) AS owner_name,
            read_state.read_at AS read_at
       FROM fleetgraph_findings f
       JOIN documents issue
         ON issue.id = f.source_issue_id
        AND issue.workspace_id = f.workspace_id
        AND issue.document_type = 'issue'
        AND issue.deleted_at IS NULL
       LEFT JOIN documents sprint
         ON sprint.id = f.source_sprint_id
        AND sprint.workspace_id = f.workspace_id
        AND sprint.document_type = 'sprint'
        AND sprint.deleted_at IS NULL
       LEFT JOIN users owner
         ON owner.id = CASE
              WHEN f.proposed_recipient->>'userId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              THEN (f.proposed_recipient->>'userId')::uuid
              ELSE NULL
            END
       LEFT JOIN documents owner_person
         ON owner_person.id = CASE
              WHEN f.proposed_recipient->>'userId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              THEN (f.proposed_recipient->>'userId')::uuid
              ELSE NULL
            END
        AND owner_person.workspace_id = f.workspace_id
        AND owner_person.document_type = 'person'
        AND owner_person.deleted_at IS NULL
        AND owner_person.archived_at IS NULL
       LEFT JOIN users owner_person_user
         ON owner_person_user.id = CASE
              WHEN owner_person.properties->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              THEN (owner_person.properties->>'user_id')::uuid
              ELSE NULL
            END
       LEFT JOIN users assignee
         ON assignee.id = CASE
              WHEN issue.properties->>'assignee_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              THEN (issue.properties->>'assignee_id')::uuid
              ELSE NULL
            END
       LEFT JOIN fleetgraph_notification_reads read_state
         ON read_state.finding_id = f.id
        AND read_state.workspace_id = f.workspace_id
        AND read_state.user_id = $2::uuid
      WHERE f.workspace_id = $1
        AND f.status IN ('open', 'needs_confirmation', 'error')
      ORDER BY f.last_detected_at DESC, f.updated_at DESC
      LIMIT $3`,
    [input.workspaceId, input.userId ?? null, limit * 3]
  );

  return result.rows.map(mapNotificationFinding);
}

export async function markFleetGraphNotificationRead(
  input: { workspaceId: string; findingId: string; userId: string },
  db: QueryRunner = pool
): Promise<number> {
  const result = await db.query<{ finding_id: string }>(
    `INSERT INTO fleetgraph_notification_reads (workspace_id, finding_id, user_id, read_at)
     SELECT workspace_id, id, $3, NOW()
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
     ON CONFLICT (finding_id, user_id)
     DO UPDATE SET read_at = EXCLUDED.read_at
     RETURNING finding_id`,
    [input.workspaceId, input.findingId, input.userId]
  );
  return result.rows.length;
}

export async function markVisibleFleetGraphNotificationsRead(
  input: { workspaceId: string; userId: string; findingIds: string[] },
  db: QueryRunner = pool
): Promise<number> {
  if (input.findingIds.length === 0) return 0;
  const result = await db.query<{ finding_id: string }>(
    `INSERT INTO fleetgraph_notification_reads (workspace_id, finding_id, user_id, read_at)
     SELECT workspace_id, id, $2, NOW()
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND id = ANY($3::uuid[])
        AND status IN ('open', 'needs_confirmation', 'error')
     ON CONFLICT (finding_id, user_id)
     DO UPDATE SET read_at = EXCLUDED.read_at
     RETURNING finding_id`,
    [input.workspaceId, input.userId, input.findingIds]
  );
  return result.rows.length;
}

export async function enqueueFleetGraphAttentionEvent(
  input: EnqueueFleetGraphAttentionEventInput,
  db: QueryRunner = pool
): Promise<FleetGraphAttentionEvent | null> {
  const result = await db.query<FleetGraphAttentionEventRow>(
    `INSERT INTO fleetgraph_attention_events (
       workspace_id, source_issue_id, source_sprint_id, event_type, reason, available_at
     )
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
     ON CONFLICT (
       workspace_id,
       source_issue_id,
       source_sprint_key,
       event_type
     ) WHERE status IN ('pending', 'processing')
     DO UPDATE SET
       reason = EXCLUDED.reason,
       available_at = LEAST(fleetgraph_attention_events.available_at, EXCLUDED.available_at),
       updated_at = NOW()
     RETURNING *`,
    [
      input.workspaceId,
      input.sourceIssueId,
      input.sourceSprintId ?? null,
      input.eventType,
      input.reason,
      input.availableAt ?? null,
    ]
  );

  return result.rows[0] ?? null;
}

export async function claimFleetGraphAttentionEvents(
  input: ClaimFleetGraphAttentionEventsInput,
  db: QueryRunner = pool
): Promise<FleetGraphAttentionEvent[]> {
  const result = await db.query<FleetGraphAttentionEventRow>(
    `WITH claimed AS (
       SELECT id
         FROM fleetgraph_attention_events
        WHERE (
            status = 'pending'
            OR (
              status = 'processing'
              AND locked_at <= COALESCE($3, NOW()) - ($4::int || ' minutes')::interval
            )
          )
          AND available_at <= COALESCE($3, NOW())
        ORDER BY available_at ASC, created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE fleetgraph_attention_events event
        SET status = 'processing',
            locked_at = NOW(),
            locked_by = $2,
            attempt_count = attempt_count + 1,
            updated_at = NOW()
       FROM claimed
      WHERE event.id = claimed.id
      RETURNING event.*`,
    [
      input.limit ?? 10,
      input.lockedBy,
      input.now ?? null,
      input.leaseTimeoutMinutes ?? ATTENTION_EVENT_LEASE_TIMEOUT_MINUTES,
    ]
  );

  return result.rows;
}

export async function completeFleetGraphAttentionEvent(
  input: CompleteFleetGraphAttentionEventInput,
  db: QueryRunner = pool
): Promise<FleetGraphAttentionEvent | null> {
  const result = await db.query<FleetGraphAttentionEventRow>(
    `UPDATE fleetgraph_attention_events
        SET status = $2,
            last_error = $3,
            processed_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'processing'
      RETURNING *`,
    [input.eventId, input.status, input.lastError ?? null]
  );

  return result.rows[0] ?? null;
}

export async function saveBlockedImportantIssueFinding(
  input: SaveBlockedImportantIssueFindingInput,
  db: QueryRunner = pool
): Promise<FleetGraphFinding> {
  const signalType = fleetGraphSignalType(input.runMetadata?.signalType);
  const dedupeKey = fleetGraphAttentionDedupeKey({
    signalType,
    workspaceId: input.workspaceId,
    issueId: input.sourceIssueId,
    sprintId: input.sourceSprintId,
  });

  const result = await db.query<FleetGraphFindingRow>(
    `INSERT INTO fleetgraph_findings (
       workspace_id, source_issue_id, source_sprint_id, dedupe_key,
       status, severity, confidence, title, summary,
       evidence_snapshot, recommended_action, draft_content, proposed_recipient,
       human_gate, trace_metadata, run_metadata
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8, $9,
       $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
       $14::jsonb, $15::jsonb, $16::jsonb
     )
     ON CONFLICT (dedupe_key) WHERE status IN ('open', 'needs_confirmation', 'error')
     DO UPDATE SET
       status = EXCLUDED.status,
       severity = EXCLUDED.severity,
       confidence = EXCLUDED.confidence,
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       evidence_snapshot = EXCLUDED.evidence_snapshot,
       recommended_action = EXCLUDED.recommended_action,
       draft_content = EXCLUDED.draft_content,
       proposed_recipient = EXCLUDED.proposed_recipient,
       human_gate = EXCLUDED.human_gate,
       trace_metadata = EXCLUDED.trace_metadata,
       run_metadata = EXCLUDED.run_metadata,
       last_detected_at = NOW(),
       resolved_at = NULL,
       dismissed_at = NULL,
       dismissed_by = NULL,
       updated_at = NOW()
     RETURNING *`,
    [
      input.workspaceId,
      input.sourceIssueId,
      input.sourceSprintId,
      dedupeKey,
      input.status ?? 'open',
      input.severity,
      input.confidence,
      input.title,
      input.summary,
      jsonParam(input.evidenceSnapshot ?? []),
      jsonParam(input.recommendedAction ?? {}),
      jsonParam(input.draftContent ?? {}),
      jsonParam(input.proposedRecipient ?? {}),
      jsonParam(input.humanGate ?? {}),
      jsonParam(input.traceMetadata ?? {}),
      jsonParam(input.runMetadata ?? {}),
    ]
  );

  return mapFinding(requireFirstRow(result.rows));
}

export async function refineFleetGraphDraft(
  input: {
    workspaceId: string;
    findingId: string;
    draftContent: JsonRecord;
    humanGate?: JsonRecord;
    traceMetadata?: JsonRecord;
  },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `UPDATE fleetgraph_findings
        SET draft_content = $3::jsonb,
            human_gate = COALESCE($4::jsonb, human_gate),
            trace_metadata = trace_metadata || COALESCE($5::jsonb, '{}'::jsonb),
            status = 'needs_confirmation',
            updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND status IN ('open', 'needs_confirmation')
      RETURNING *`,
    [
      input.findingId,
      input.workspaceId,
      jsonParam(input.draftContent),
      input.humanGate ? jsonParam(input.humanGate) : null,
      input.traceMetadata ? jsonParam(input.traceMetadata) : null,
    ]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function dismissFleetGraphFinding(
  input: { workspaceId: string; findingId: string; dismissedBy: string },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `UPDATE fleetgraph_findings
        SET status = 'dismissed',
            dismissed_at = NOW(),
            dismissed_by = $3,
            updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      RETURNING *`,
    [input.findingId, input.workspaceId, input.dismissedBy]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function resolveFleetGraphFinding(
  input: { workspaceId: string; findingId: string },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `UPDATE fleetgraph_findings
        SET status = 'resolved',
            resolved_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      RETURNING *`,
    [input.findingId, input.workspaceId]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function suppressFleetGraphFinding(
  input: { workspaceId: string; findingId: string },
  db: QueryRunner = pool
): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFindingRow>(
    `UPDATE fleetgraph_findings
        SET status = 'suppressed',
            updated_at = NOW()
      WHERE id = $1
        AND workspace_id = $2
        AND status IN ('open', 'needs_confirmation', 'error')
      RETURNING *`,
    [input.findingId, input.workspaceId]
  );

  return result.rows[0] ? mapFinding(result.rows[0]) : null;
}

export async function recordFleetGraphRun(
  input: RecordFleetGraphRunInput,
  db: QueryRunner = pool
): Promise<FleetGraphRun> {
  const result = await db.query<FleetGraphRunRow>(
    `INSERT INTO fleetgraph_runs (
       workspace_id, finding_id, source_issue_id, source_sprint_id,
       mode, trigger_reason, decision, dedupe_key,
       input_snapshot, evidence_snapshot, output_snapshot, trace_metadata,
       token_metadata, cost_metadata, error_metadata, completed_at
     )
     VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
       $13::jsonb, $14::jsonb, $15::jsonb, COALESCE($16, NOW())
     )
     RETURNING *`,
    [
      input.workspaceId,
      input.findingId ?? null,
      input.sourceIssueId ?? null,
      input.sourceSprintId ?? null,
      input.mode,
      input.triggerReason,
      input.decision,
      input.dedupeKey ?? null,
      jsonParam(input.inputSnapshot ?? {}),
      jsonParam(input.evidenceSnapshot ?? []),
      jsonParam(input.outputSnapshot ?? {}),
      jsonParam(input.traceMetadata ?? {}),
      jsonParam(input.tokenMetadata ?? {}),
      jsonParam(input.costMetadata ?? {}),
      jsonParam(input.errorMetadata ?? {}),
      input.completedAt ?? null,
    ]
  );

  return requireFirstRow(result.rows);
}

export async function listFleetGraphAnchorRuns(
  input: { workspaceId: string; findingId: string; limit?: number },
  db: QueryRunner = pool
): Promise<FleetGraphRun[]> {
  const result = await db.query<FleetGraphRunRow>(
    `SELECT *
       FROM fleetgraph_runs
      WHERE workspace_id = $1
        AND finding_id = $2
        AND decision IN ('create_finding', 'update_finding')
      ORDER BY created_at DESC
      LIMIT $3`,
    [input.workspaceId, input.findingId, input.limit ?? 2]
  );

  return result.rows;
}

export async function startFleetGraphWorkerTick(
  input: { instanceId: string; deadlineAt: Date },
  db: QueryRunner = pool
): Promise<FleetGraphWorkerTick> {
  const result = await db.query<FleetGraphWorkerTickRow>(
    `INSERT INTO fleetgraph_worker_ticks (instance_id, status, deadline_at)
     VALUES ($1, 'running', $2)
     RETURNING *`,
    [input.instanceId, input.deadlineAt]
  );

  return requireFirstRow(result.rows);
}

export async function heartbeatFleetGraphWorkerTick(
  tickId: string,
  db: QueryRunner = pool
): Promise<FleetGraphWorkerTick | null> {
  const result = await db.query<FleetGraphWorkerTickRow>(
    `UPDATE fleetgraph_worker_ticks
        SET heartbeat_at = NOW()
      WHERE id = $1
        AND status = 'running'
      RETURNING *`,
    [tickId]
  );

  return result.rows[0] ?? null;
}

export async function completeFleetGraphWorkerTick(
  input: CompleteFleetGraphWorkerTickInput,
  db: QueryRunner = pool
): Promise<FleetGraphWorkerTick | null> {
  const result = await db.query<FleetGraphWorkerTickRow>(
    `UPDATE fleetgraph_worker_ticks
        SET status = $2,
            completed_at = NOW(),
            heartbeat_at = NOW(),
            workspace_count = COALESCE($3, workspace_count),
            detector_decision_count = COALESCE($4, detector_decision_count),
            result_count = COALESCE($5, result_count),
            model_call_count = COALESCE($6, model_call_count),
            error_metadata = COALESCE($7::jsonb, error_metadata),
            audit_metadata = COALESCE($8::jsonb, audit_metadata)
      WHERE id = $1
        AND status = 'running'
      RETURNING *`,
    [
      input.tickId,
      input.status,
      input.workspaceCount ?? null,
      input.detectorDecisionCount ?? null,
      input.resultCount ?? null,
      input.modelCallCount ?? null,
      input.errorMetadata ? jsonParam(input.errorMetadata) : null,
      input.auditMetadata ? jsonParam(input.auditMetadata) : null,
    ]
  );

  return result.rows[0] ?? null;
}
