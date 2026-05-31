// Internal row shapes and query helpers for reviewer proof chains.
import type { FleetGraphReviewerProofVerdict } from '@ship/shared';
import type { pool } from '../../db/client.js';
import type { FleetGraphRunDecision, JsonRecord } from '../persistence.js';

export type ReviewerProofArtifact = {
  verdict?: FleetGraphReviewerProofVerdict;
  reviewerChain?: { chainId?: unknown };
};

export type QueryRunner = Pick<typeof pool, 'query'>;

export type ChainRow = {
  run_id: string;
  run_created_at: Date;
  run_started_at: Date;
  run_completed_at: Date | null;
  run_mode: 'proactive' | 'on_demand';
  trigger_reason: string;
  decision: FleetGraphRunDecision;
  dedupe_key: string | null;
  run_trace_metadata: JsonRecord;
  token_metadata: JsonRecord;
  cost_metadata: JsonRecord;
  source_issue_id: string | null;
  source_sprint_id: string | null;
  finding_id: string | null;
  finding_status: string | null;
  finding_first_detected_at: Date | null;
  finding_last_detected_at: Date | null;
  finding_trace_metadata: JsonRecord | null;
  issue_title: string | null;
  issue_state: string | null;
  issue_priority: string | null;
  issue_assignee_id: string | null;
  issue_updated_at: Date | null;
  sprint_title: string | null;
  attention_event_id: string | null;
  attention_event_status: string | null;
  attention_event_created_at: Date | null;
  attention_event_locked_at: Date | null;
  attention_event_processed_at: Date | null;
  worker_tick_id: string | null;
  worker_tick_status: string | null;
  worker_tick_started_at: Date | null;
  worker_tick_completed_at: Date | null;
  mutation_before_state: JsonRecord | null;
  mutation_after_state: JsonRecord | null;
  mutation_changed_fields: string[] | null;
  mutation_proof_created_at: Date | null;
};

export type IssueRow = {
  id: string;
  properties: JsonRecord;
  updated_at: Date;
};

export type ScenarioDocuments = {
  sourceIssueId: string;
  sourceSprintId: string;
};

export type ReviewerSourceSnapshot = {
  sourceIssueId: string | null;
  findingId: string | null;
  state: JsonRecord;
};

export function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
