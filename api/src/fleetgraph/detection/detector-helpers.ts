import type { FleetGraphSignalType, IssuePriority, IssueState } from '@ship/shared';
import { pool } from '../../db/client.js';
import {
  blockedImportantIssueDedupeKey,
  fleetGraphAttentionDedupeKey,
  signalLabelForType,
} from '../persistence.js';
import type { FleetGraphIssueAttentionContext } from './attention-context.js';
import type { attentionPolicyForContext } from './attention-policy.js';

type QueryRunner = Pick<typeof pool, 'query'>;
type SourceKey = `${string}:${string}:${string}`;

export type FleetGraphAttentionCandidateRow = {
  workspace_id: string;
  issue_id: string;
  issue_title: string;
  issue_ticket_number: number | null;
  issue_state: IssueState | null;
  issue_priority: IssuePriority;
  issue_assignee_id: string | null;
  issue_assignee_name: string | null;
  sprint_id: string;
  sprint_title: string;
  sprint_number: number | null;
  sprint_owner_id: string | null;
  sprint_owner_name: string | null;
  project_id: string | null;
  project_title: string | null;
  project_owner_id: string | null;
  project_owner_name: string | null;
  program_id: string | null;
  program_title: string | null;
  program_owner_id: string | null;
  program_owner_name: string | null;
  blocker_text: string;
  blocker_iteration_id: string | null;
  blocker_iteration_created_at: Date | null;
  meaningful_updated_at?: Date | null;
  attention_reason?: string | null;
  signal_type?: FleetGraphSignalType;
};

export type FleetGraphAttentionCandidate = FleetGraphAttentionCandidateRow & {
  dedupeKey: string;
  signalType?: FleetGraphSignalType;
  signalLabel?: string;
  attentionReason?: string;
  meaningfulUpdatedAt?: Date | null;
};

export type FleetGraphDetectorQuietExitReason =
  | 'done_or_cancelled'
  | 'duplicate_open_finding'
  | 'insufficient_visible_evidence';

export type FleetGraphDetectorQuietExit = {
  reason: FleetGraphDetectorQuietExitReason;
  count: number;
};

export type FleetGraphAttentionDedupeDecision = {
  decision: 'create_finding' | 'update_finding';
  candidate: FleetGraphAttentionCandidate;
  existingFindingId: string | null;
};

export type FleetGraphAttentionDecisionBatch = {
  decisions: FleetGraphAttentionDedupeDecision[];
};

export type FleetGraphStaleFinding = {
  findingId: string;
  sourceIssueId: string;
  sourceSprintId: string;
  dedupeKey: string;
  reason: FleetGraphDetectorQuietExitReason | 'condition_gone';
};

function mapCandidate(row: FleetGraphAttentionCandidateRow): FleetGraphAttentionCandidate {
  const signalType = row.signal_type ?? 'blocked';
  return {
    ...row,
    signalType,
    signalLabel: signalLabelForType(signalType),
    attentionReason: row.attention_reason || (signalType === 'blocked' ? 'Issue state is blocked.' : 'Issue needs attention.'),
    meaningfulUpdatedAt: row.meaningful_updated_at ?? row.blocker_iteration_created_at ?? null,
    dedupeKey: signalType === 'blocked' ? blockedImportantIssueDedupeKey({
      workspaceId: row.workspace_id,
      issueId: row.issue_id,
      sprintId: row.sprint_id,
    }) : fleetGraphAttentionDedupeKey({
      signalType,
      workspaceId: row.workspace_id,
      issueId: row.issue_id,
      sprintId: row.sprint_id,
    }),
  };
}

export function candidateFromContext(
  context: FleetGraphIssueAttentionContext,
  policy: NonNullable<ReturnType<typeof attentionPolicyForContext>>,
): FleetGraphAttentionCandidate {
  return mapCandidate({
    workspace_id: context.workspace_id,
    issue_id: context.issue_id,
    issue_title: context.issue_title,
    issue_ticket_number: context.issue_ticket_number,
    issue_state: context.issue_state,
    issue_priority: context.issue_priority,
    issue_assignee_id: context.issue_assignee_id,
    issue_assignee_name: context.issue_assignee_name,
    sprint_id: context.sprint_id,
    sprint_title: context.sprint_title,
    sprint_number: context.sprint_number,
    sprint_owner_id: context.sprint_owner_id,
    sprint_owner_name: context.sprint_owner_name,
    project_id: context.project_id,
    project_title: context.project_title,
    project_owner_id: context.project_owner_id,
    project_owner_name: context.project_owner_name,
    program_id: context.program_id,
    program_title: context.program_title,
    program_owner_id: context.program_owner_id,
    program_owner_name: context.program_owner_name,
    blocker_text: context.blocker_text,
    blocker_iteration_id: context.blocker_iteration_id,
    blocker_iteration_created_at: context.blocker_iteration_created_at,
    meaningful_updated_at: context.meaningful_updated_at,
    attention_reason: policy.reason,
    signal_type: policy.signalType,
  });
}

function uniqueCandidatesByDedupeKey(
  candidates: FleetGraphAttentionCandidate[],
): FleetGraphAttentionCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.dedupeKey)) return false;
    seen.add(candidate.dedupeKey);
    return true;
  });
}

function sourceKey(candidate: FleetGraphAttentionCandidate): SourceKey {
  return `${candidate.workspace_id}:${candidate.issue_id}:${candidate.sprint_id}`;
}

function signalRank(candidate: FleetGraphAttentionCandidate): number {
  if ((candidate.signalType ?? 'blocked') === 'blocked') return 3;
  if (candidate.signalType === 'at_risk') return 2;
  return 1;
}

export function strongestCandidatePerSource(
  candidates: FleetGraphAttentionCandidate[],
): FleetGraphAttentionCandidate[] {
  const bySource = new Map<SourceKey, FleetGraphAttentionCandidate>();
  for (const candidate of candidates) {
    const key = sourceKey(candidate);
    const existing = bySource.get(key);
    if (!existing || signalRank(candidate) > signalRank(existing)) bySource.set(key, candidate);
  }
  return [...bySource.values()];
}

export async function planFleetGraphAttentionDedupeDecisions(input: {
  workspaceId: string;
  candidates: FleetGraphAttentionCandidate[];
  db?: QueryRunner;
}): Promise<FleetGraphAttentionDedupeDecision[]> {
  const candidates = uniqueCandidatesByDedupeKey(input.candidates);
  if (candidates.length === 0) return [];

  const db = input.db ?? pool;
  const dedupeKeys = candidates.map((candidate) => candidate.dedupeKey);
  const result = await db.query<{ id: string; dedupe_key: string }>(
    `SELECT id, dedupe_key
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND dedupe_key = ANY($2::text[])
        AND status IN ('open', 'needs_confirmation', 'error')`,
    [input.workspaceId, dedupeKeys]
  );
  const openFindingIdByDedupeKey = new Map(
    result.rows.map((row) => [row.dedupe_key, row.id])
  );

  return candidates.map((candidate) => {
    const existingFindingId = openFindingIdByDedupeKey.get(candidate.dedupeKey) ?? null;
    return {
      decision: existingFindingId ? 'update_finding' : 'create_finding',
      candidate,
      existingFindingId,
    };
  });
}
