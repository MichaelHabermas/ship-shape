// FleetGraph deterministic detectors select candidate work before graph reasoning.
import { pool } from '../db/client.js';
import {
  BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX,
  blockedImportantIssueDedupeKey,
  recordFleetGraphRun,
  sqlBlockedImportantIssueDedupeKey,
} from './persistence.js';

type QueryRunner = Pick<typeof pool, 'query'>;

type BlockedImportantIssueCandidateRow = {
  workspace_id: string;
  issue_id: string;
  issue_title: string;
  issue_ticket_number: number | null;
  issue_state: string | null;
  issue_priority: 'low' | 'medium' | 'high' | 'urgent';
  issue_assignee_id: string | null;
  sprint_id: string;
  sprint_title: string;
  sprint_number: number | null;
  sprint_owner_id: string | null;
  blocker_text: string;
  blocker_iteration_id: string | null;
  blocker_iteration_created_at: Date | null;
};

export type BlockedImportantIssueCandidate = BlockedImportantIssueCandidateRow & {
  dedupeKey: string;
};

export type FleetGraphDetectorQuietExitReason =
  | 'inactive_week'
  | 'no_blocker'
  | 'medium_low_priority'
  | 'done_or_cancelled'
  | 'missing_fallback_owner'
  | 'duplicate_open_finding'
  | 'insufficient_visible_evidence';

export type FleetGraphDetectorQuietExit = {
  reason: FleetGraphDetectorQuietExitReason;
  count: number;
};

export type BlockedImportantIssueDedupeDecision = {
  decision: 'create_finding' | 'update_finding';
  candidate: BlockedImportantIssueCandidate;
  existingFindingId: string | null;
};

export type BlockedImportantIssueDecisionBatch = {
  decisions: BlockedImportantIssueDedupeDecision[];
};

export type FleetGraphStaleFinding = {
  findingId: string;
  sourceIssueId: string;
  sourceSprintId: string;
  dedupeKey: string;
  reason: FleetGraphDetectorQuietExitReason | 'condition_gone';
};

function mapCandidate(row: BlockedImportantIssueCandidateRow): BlockedImportantIssueCandidate {
  return {
    ...row,
    dedupeKey: blockedImportantIssueDedupeKey({
      workspaceId: row.workspace_id,
      issueId: row.issue_id,
      sprintId: row.sprint_id,
    }),
  };
}

async function findBlockedImportantIssueCandidates(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
}): Promise<BlockedImportantIssueCandidate[]> {
  const db = input.db ?? pool;
  const result = await db.query<BlockedImportantIssueCandidateRow>(
    `SELECT
       i.workspace_id,
       i.id AS issue_id,
       i.title AS issue_title,
       i.ticket_number AS issue_ticket_number,
       i.properties->>'state' AS issue_state,
       CASE i.properties->>'priority'
         WHEN 'urgent' THEN 'urgent'
         WHEN 'high' THEN 'high'
         WHEN 'medium' THEN 'medium'
         WHEN 'low' THEN 'low'
         ELSE 'medium'
       END AS issue_priority,
       NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
       s.id AS sprint_id,
       s.title AS sprint_title,
       CASE
         WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
         ELSE NULL
       END AS sprint_number,
       COALESCE(
         NULLIF(s.properties->>'owner_id', ''),
         NULLIF(s.properties->'assignee_ids'->>0, '')
       ) AS sprint_owner_id,
       COALESCE(latest_iteration.blockers_encountered, '') AS blocker_text,
       latest_iteration.id AS blocker_iteration_id,
       latest_iteration.created_at AS blocker_iteration_created_at
     FROM documents i
     JOIN document_associations sprint_assoc
       ON sprint_assoc.document_id = i.id
      AND sprint_assoc.relationship_type = 'sprint'
     JOIN documents s
       ON s.id = sprint_assoc.related_id
      AND s.workspace_id = i.workspace_id
      AND s.document_type = 'sprint'
      AND s.deleted_at IS NULL
      AND s.archived_at IS NULL
      LEFT JOIN LATERAL (
       SELECT iteration.id, iteration.blockers_encountered, iteration.created_at
         FROM issue_iterations iteration
        WHERE iteration.issue_id = i.id
          AND iteration.workspace_id = i.workspace_id
          AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
        ORDER BY iteration.created_at DESC, iteration.id DESC
        LIMIT 1
     ) latest_iteration ON TRUE
     WHERE i.workspace_id = $1
       AND i.document_type = 'issue'
       AND i.deleted_at IS NULL
       AND i.archived_at IS NULL
       AND COALESCE(i.visibility, 'workspace') <> 'private'
       AND COALESCE(i.properties->>'state', 'backlog') = 'blocked'
     ORDER BY
       CASE i.properties->>'priority'
         WHEN 'urgent' THEN 1
         WHEN 'high' THEN 2
         WHEN 'medium' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END,
       latest_iteration.created_at DESC NULLS LAST,
       i.updated_at DESC
     LIMIT $2`,
    [input.workspaceId, input.limit ?? 25]
  );

  return result.rows.map(mapCandidate);
}

function uniqueCandidatesByDedupeKey(
  candidates: BlockedImportantIssueCandidate[]
): BlockedImportantIssueCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.dedupeKey)) return false;
    seen.add(candidate.dedupeKey);
    return true;
  });
}

async function planBlockedImportantIssueDedupeDecisions(input: {
  workspaceId: string;
  candidates: BlockedImportantIssueCandidate[];
  db?: QueryRunner;
}): Promise<BlockedImportantIssueDedupeDecision[]> {
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

export async function detectBlockedImportantIssueDecisions(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
}): Promise<BlockedImportantIssueDedupeDecision[]> {
  const candidates = await findBlockedImportantIssueCandidates(input);
  return planBlockedImportantIssueDedupeDecisions({
    workspaceId: input.workspaceId,
    candidates,
    db: input.db,
  });
}

export async function findBlockedImportantIssueQuietExits(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
}): Promise<FleetGraphDetectorQuietExit[]> {
  const db = input.db ?? pool;

  const result = await db.query<{ reason: FleetGraphDetectorQuietExitReason; count: string }>(
    `WITH issue_week_context AS (
       SELECT
         i.workspace_id,
         i.id AS issue_id,
         COALESCE(i.properties->>'state', 'backlog') AS issue_state,
         COALESCE(i.properties->>'priority', 'medium') AS issue_priority,
         NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
         s.id AS sprint_id,
         CASE
           WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
           ELSE NULL
         END AS sprint_number,
         COALESCE(
           NULLIF(s.properties->>'owner_id', ''),
           NULLIF(s.properties->'assignee_ids'->>0, '')
         ) AS sprint_owner_id,
         COALESCE(latest_iteration.blockers_encountered, '') AS blocker_text,
         blocked_finding.id AS duplicate_finding_id
       FROM documents i
       JOIN document_associations sprint_assoc
         ON sprint_assoc.document_id = i.id
        AND sprint_assoc.relationship_type = 'sprint'
       JOIN documents s
         ON s.id = sprint_assoc.related_id
        AND s.workspace_id = i.workspace_id
        AND s.document_type = 'sprint'
        AND s.deleted_at IS NULL
        AND s.archived_at IS NULL
       LEFT JOIN LATERAL (
         SELECT iteration.blockers_encountered, iteration.created_at
           FROM issue_iterations iteration
          WHERE iteration.issue_id = i.id
            AND iteration.workspace_id = i.workspace_id
            AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
          ORDER BY iteration.created_at DESC, iteration.id DESC
          LIMIT 1
       ) latest_iteration ON TRUE
       LEFT JOIN fleetgraph_findings blocked_finding
         ON blocked_finding.workspace_id = i.workspace_id
        AND blocked_finding.dedupe_key = ${sqlBlockedImportantIssueDedupeKey('i.workspace_id', 'i.id', 's.id')}
        AND blocked_finding.status IN ('open', 'needs_confirmation', 'error')
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.deleted_at IS NULL
         AND i.archived_at IS NULL
       ),
       private_blocked_context AS (
       SELECT
         i.workspace_id,
         i.id AS issue_id
       FROM documents i
       JOIN document_associations sprint_assoc
         ON sprint_assoc.document_id = i.id
        AND sprint_assoc.relationship_type = 'sprint'
       JOIN documents s
         ON s.id = sprint_assoc.related_id
        AND s.workspace_id = i.workspace_id
        AND s.document_type = 'sprint'
        AND s.deleted_at IS NULL
        AND s.archived_at IS NULL
       LEFT JOIN LATERAL (
         SELECT iteration.blockers_encountered, iteration.created_at
           FROM issue_iterations iteration
          WHERE iteration.issue_id = i.id
            AND iteration.workspace_id = i.workspace_id
            AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
          ORDER BY iteration.created_at DESC, iteration.id DESC
          LIMIT 1
       ) latest_iteration ON TRUE
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.deleted_at IS NULL
         AND i.archived_at IS NULL
         AND COALESCE(i.visibility, 'workspace') = 'private'
         AND COALESCE(i.properties->>'state', 'backlog') = 'blocked'
     ),
     classified AS (
       SELECT 'duplicate_open_finding'::text AS reason
         FROM issue_week_context
       WHERE issue_state = 'blocked'
         AND duplicate_finding_id IS NOT NULL
       UNION ALL
       SELECT 'insufficient_visible_evidence'::text AS reason
         FROM private_blocked_context
     )
     SELECT reason, COUNT(*)::text AS count
       FROM classified
     GROUP BY reason
     ORDER BY reason`,
    [input.workspaceId]
  );

  const countsByReason = new Map(result.rows.map((row) => [row.reason, Number(row.count)]));
  return [
    'done_or_cancelled',
    'duplicate_open_finding',
    'inactive_week',
    'insufficient_visible_evidence',
    'medium_low_priority',
    'missing_fallback_owner',
    'no_blocker',
  ].map((reason) => ({
    reason: reason as FleetGraphDetectorQuietExitReason,
    count: countsByReason.get(reason as FleetGraphDetectorQuietExitReason) ?? 0,
  }));
}

export async function findStaleBlockedImportantIssueFindings(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
}): Promise<FleetGraphStaleFinding[]> {
  const db = input.db ?? pool;
  const candidates = await findBlockedImportantIssueCandidates({
    ...input,
    limit: input.limit ?? 1000,
  });
  const activeDedupeKeys = new Set(candidates.map((candidate) => candidate.dedupeKey));

  const result = await db.query<{
    id: string;
    source_issue_id: string;
    source_sprint_id: string;
    dedupe_key: string;
    reason: FleetGraphStaleFinding['reason'];
  }>(
    `WITH open_findings AS (
       SELECT id, source_issue_id, source_sprint_id, dedupe_key
         FROM fleetgraph_findings
        WHERE workspace_id = $1
          AND dedupe_key LIKE '${BLOCKED_IMPORTANT_ISSUE_DEDUPE_PREFIX}:%'
          AND status IN ('open', 'needs_confirmation', 'error')
        ORDER BY updated_at ASC
        LIMIT $2
     ),
     source_context AS (
       SELECT
         f.id,
         f.source_issue_id,
         f.source_sprint_id,
         f.dedupe_key,
         i.id AS issue_id,
         s.id AS sprint_id,
         COALESCE(i.properties->>'state', 'backlog') AS issue_state,
         COALESCE(i.properties->>'priority', 'medium') AS issue_priority,
         NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
         CASE
           WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
           ELSE NULL
         END AS sprint_number,
         COALESCE(
           NULLIF(s.properties->>'owner_id', ''),
           NULLIF(s.properties->'assignee_ids'->>0, '')
         ) AS sprint_owner_id,
         COALESCE(latest_iteration.blockers_encountered, '') AS blocker_text,
         COALESCE(i.visibility, 'workspace') AS issue_visibility
       FROM open_findings f
       LEFT JOIN documents i
         ON i.id = f.source_issue_id
        AND i.workspace_id = $1
        AND i.document_type = 'issue'
        AND i.deleted_at IS NULL
        AND i.archived_at IS NULL
       LEFT JOIN documents s
         ON s.id = f.source_sprint_id
        AND s.workspace_id = $1
        AND s.document_type = 'sprint'
        AND s.deleted_at IS NULL
        AND s.archived_at IS NULL
       LEFT JOIN LATERAL (
         SELECT iteration.blockers_encountered
           FROM issue_iterations iteration
          WHERE iteration.issue_id = i.id
            AND iteration.workspace_id = i.workspace_id
            AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
          ORDER BY iteration.created_at DESC, iteration.id DESC
          LIMIT 1
       ) latest_iteration ON TRUE
     )
     SELECT
       id,
       source_issue_id,
       source_sprint_id,
       dedupe_key,
       CASE
         WHEN issue_id IS NULL OR sprint_id IS NULL THEN 'condition_gone'
         WHEN issue_visibility = 'private' THEN 'insufficient_visible_evidence'
         WHEN issue_state IN ('done', 'cancelled') THEN 'done_or_cancelled'
         WHEN issue_state <> 'blocked' THEN 'condition_gone'
         ELSE 'condition_gone'
       END AS reason
     FROM source_context`,
    [input.workspaceId, input.limit ?? 100]
  );

  return result.rows
    .filter((row) => !activeDedupeKeys.has(row.dedupe_key))
    .map((row) => ({
      findingId: row.id,
      sourceIssueId: row.source_issue_id,
      sourceSprintId: row.source_sprint_id,
      dedupeKey: row.dedupe_key,
      reason: row.reason,
    }));
}

export async function recordBlockedImportantIssueQuietExitRun(input: {
  workspaceId: string;
  quietExits: FleetGraphDetectorQuietExit[];
  db?: QueryRunner;
}): Promise<void> {
  await recordFleetGraphRun({
    workspaceId: input.workspaceId,
    mode: 'proactive',
    triggerReason: 'blocked-important-issue-detector',
    decision: 'quiet_exit',
    outputSnapshot: {
      quietExits: input.quietExits,
    },
    tokenMetadata: {
      modelCalls: 0,
    },
    costMetadata: {
      modelCostUsd: 0,
    },
    completedAt: new Date(),
  }, input.db ?? pool);
}
