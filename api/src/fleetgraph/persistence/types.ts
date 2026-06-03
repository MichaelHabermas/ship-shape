import type { FleetGraphRunMode, FleetGraphSeverity } from '@ship/shared';
import type { Pool, PoolClient } from 'pg';

export type QueryRunner = Pick<Pool | PoolClient, 'query'>;

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

export type FleetGraphFindingRow = {
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

export type FleetGraphNotificationRow = FleetGraphFindingRow & {
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

export type FleetGraphAttentionEventRow = {
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

export type FleetGraphRunRow = {
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

export type FleetGraphWorkerTickRow = {
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
  workspaceIds?: string[];
};

export type CompleteFleetGraphAttentionEventInput = {
  eventId: string;
  status: Extract<FleetGraphAttentionEventStatus, 'completed' | 'failed' | 'skipped'>;
  lastError?: string | null;
};

export type RetryFleetGraphAttentionEventInput = {
  eventId: string;
  lastError: string;
  availableAt?: Date;
};

export type FailFleetGraphAttentionEventInput = {
  eventId: string;
  lastError: string;
  maxAttempts?: number;
  now?: Date;
};

export function mapFinding(row: FleetGraphFindingRow): FleetGraphFinding {
  return {
    ...row,
    confidence: Number(row.confidence),
  };
}

export function mapNotificationFinding(row: FleetGraphNotificationRow): FleetGraphNotificationFinding {
  return {
    ...mapFinding(row),
    issue_title: row.issue_title,
    context_title: row.context_title,
    owner_name: row.owner_name,
    read_at: row.read_at,
  };
}

export function jsonParam(value: unknown): string {
  return JSON.stringify(value);
}
