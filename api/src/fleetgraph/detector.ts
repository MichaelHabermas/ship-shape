// FleetGraph deterministic detectors select candidate work before graph reasoning.
import { pool } from '../db/client.js';
import { blockedImportantIssueDedupeKey, recordFleetGraphRun } from './persistence.js';
import { resolveFleetGraphCurrentWeek } from './current-week.js';

type QueryRunner = Pick<typeof pool, 'query'>;

type BlockedImportantIssueCandidateRow = {
  workspace_id: string;
  issue_id: string;
  issue_title: string;
  issue_ticket_number: number | null;
  issue_state: string | null;
  issue_priority: 'urgent' | 'high';
  issue_assignee_id: string | null;
  sprint_id: string;
  sprint_title: string;
  sprint_number: number;
  sprint_owner_id: string | null;
  blocker_text: string;
  blocker_iteration_id: string;
  blocker_iteration_created_at: Date;
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

export async function findBlockedImportantIssueCandidates(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
  limit?: number;
}): Promise<BlockedImportantIssueCandidate[]> {
  const db = input.db ?? pool;
  const { currentSprintNumber } = await resolveFleetGraphCurrentWeek(input.workspaceId, {
    db,
    today: input.today,
  });

  const result = await db.query<BlockedImportantIssueCandidateRow>(
    `SELECT
       i.workspace_id,
       i.id AS issue_id,
       i.title AS issue_title,
       i.ticket_number AS issue_ticket_number,
       i.properties->>'state' AS issue_state,
       i.properties->>'priority' AS issue_priority,
       NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
       s.id AS sprint_id,
       s.title AS sprint_title,
       (s.properties->>'sprint_number')::int AS sprint_number,
       COALESCE(
         NULLIF(s.properties->>'owner_id', ''),
         NULLIF(s.properties->'assignee_ids'->>0, '')
       ) AS sprint_owner_id,
       latest_iteration.blockers_encountered AS blocker_text,
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
     JOIN LATERAL (
       SELECT iteration.id, iteration.blockers_encountered, iteration.created_at
         FROM issue_iterations iteration
        WHERE iteration.issue_id = i.id
          AND iteration.workspace_id = i.workspace_id
        ORDER BY iteration.created_at DESC, iteration.id DESC
        LIMIT 1
     ) latest_iteration ON TRUE
     WHERE i.workspace_id = $1
       AND i.document_type = 'issue'
       AND i.deleted_at IS NULL
       AND i.archived_at IS NULL
       AND COALESCE(i.properties->>'state', 'backlog') NOT IN ('done', 'cancelled')
       AND i.properties->>'priority' IN ('urgent', 'high')
       AND (s.properties->>'sprint_number')::int = $2
       AND (
         NULLIF(i.properties->>'assignee_id', '') IS NOT NULL
         OR NULLIF(s.properties->>'owner_id', '') IS NOT NULL
         OR NULLIF(s.properties->'assignee_ids'->>0, '') IS NOT NULL
       )
       AND btrim(COALESCE(latest_iteration.blockers_encountered, '')) <> ''
     ORDER BY
       CASE i.properties->>'priority'
         WHEN 'urgent' THEN 1
         WHEN 'high' THEN 2
         ELSE 3
       END,
       latest_iteration.created_at DESC,
       i.updated_at DESC
     LIMIT $3`,
    [input.workspaceId, currentSprintNumber, input.limit ?? 25]
  );

  return result.rows.map(mapCandidate);
}

export async function planBlockedImportantIssueDedupeDecisions(input: {
  workspaceId: string;
  candidates: BlockedImportantIssueCandidate[];
  db?: QueryRunner;
}): Promise<BlockedImportantIssueDedupeDecision[]> {
  if (input.candidates.length === 0) return [];

  const db = input.db ?? pool;
  const dedupeKeys = [...new Set(input.candidates.map((candidate) => candidate.dedupeKey))];
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

  return input.candidates.map((candidate) => {
    const existingFindingId = openFindingIdByDedupeKey.get(candidate.dedupeKey) ?? null;
    return {
      decision: existingFindingId ? 'update_finding' : 'create_finding',
      candidate,
      existingFindingId,
    };
  });
}

export async function findBlockedImportantIssueQuietExits(input: {
  workspaceId: string;
  db?: QueryRunner;
  today?: Date;
}): Promise<FleetGraphDetectorQuietExit[]> {
  const db = input.db ?? pool;
  const { currentSprintNumber } = await resolveFleetGraphCurrentWeek(input.workspaceId, {
    db,
    today: input.today,
  });

  const result = await db.query<{ reason: FleetGraphDetectorQuietExitReason; count: string }>(
    `WITH issue_week_context AS (
       SELECT
         i.workspace_id,
         i.id AS issue_id,
         COALESCE(i.properties->>'state', 'backlog') AS issue_state,
         COALESCE(i.properties->>'priority', 'medium') AS issue_priority,
         NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
         s.id AS sprint_id,
         (s.properties->>'sprint_number')::int AS sprint_number,
         COALESCE(
           NULLIF(s.properties->>'owner_id', ''),
           NULLIF(s.properties->'assignee_ids'->>0, '')
         ) AS sprint_owner_id,
         latest_iteration.blockers_encountered AS blocker_text,
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
          ORDER BY iteration.created_at DESC, iteration.id DESC
          LIMIT 1
       ) latest_iteration ON TRUE
       LEFT JOIN fleetgraph_findings blocked_finding
         ON blocked_finding.workspace_id = i.workspace_id
        AND blocked_finding.source_issue_id = i.id
        AND blocked_finding.source_sprint_id = s.id
        AND blocked_finding.status IN ('open', 'needs_confirmation', 'error')
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.deleted_at IS NULL
         AND i.archived_at IS NULL
     ),
     classified AS (
       SELECT 'inactive_week'::text AS reason
         FROM issue_week_context
        WHERE sprint_number <> $2
          AND issue_priority IN ('urgent', 'high')
          AND issue_state NOT IN ('done', 'cancelled')
          AND (issue_assignee_id IS NOT NULL OR sprint_owner_id IS NOT NULL)
          AND btrim(COALESCE(blocker_text, '')) <> ''
       UNION ALL
       SELECT 'no_blocker'::text AS reason
         FROM issue_week_context
        WHERE sprint_number = $2
          AND issue_priority IN ('urgent', 'high')
          AND issue_state NOT IN ('done', 'cancelled')
          AND (issue_assignee_id IS NOT NULL OR sprint_owner_id IS NOT NULL)
          AND btrim(COALESCE(blocker_text, '')) = ''
       UNION ALL
       SELECT 'medium_low_priority'::text AS reason
         FROM issue_week_context
        WHERE sprint_number = $2
          AND issue_priority IN ('medium', 'low')
          AND issue_state NOT IN ('done', 'cancelled')
          AND (issue_assignee_id IS NOT NULL OR sprint_owner_id IS NOT NULL)
          AND btrim(COALESCE(blocker_text, '')) <> ''
       UNION ALL
       SELECT 'done_or_cancelled'::text AS reason
         FROM issue_week_context
        WHERE sprint_number = $2
          AND issue_priority IN ('urgent', 'high')
          AND issue_state IN ('done', 'cancelled')
          AND (issue_assignee_id IS NOT NULL OR sprint_owner_id IS NOT NULL)
          AND btrim(COALESCE(blocker_text, '')) <> ''
       UNION ALL
       SELECT 'missing_fallback_owner'::text AS reason
         FROM issue_week_context
        WHERE sprint_number = $2
          AND issue_priority IN ('urgent', 'high')
          AND issue_state NOT IN ('done', 'cancelled')
          AND issue_assignee_id IS NULL
          AND sprint_owner_id IS NULL
          AND btrim(COALESCE(blocker_text, '')) <> ''
       UNION ALL
       SELECT 'duplicate_open_finding'::text AS reason
         FROM issue_week_context
        WHERE sprint_number = $2
          AND issue_priority IN ('urgent', 'high')
          AND issue_state NOT IN ('done', 'cancelled')
          AND (issue_assignee_id IS NOT NULL OR sprint_owner_id IS NOT NULL)
          AND btrim(COALESCE(blocker_text, '')) <> ''
          AND duplicate_finding_id IS NOT NULL
     )
     SELECT reason, COUNT(*)::text AS count
       FROM classified
      GROUP BY reason
     UNION ALL
     SELECT 'insufficient_visible_evidence', '0'
     ORDER BY reason`,
    [input.workspaceId, currentSprintNumber]
  );

  return result.rows.map((row) => ({
    reason: row.reason,
    count: Number(row.count),
  }));
}

export async function recordBlockedImportantIssueQuietExitRun(input: {
  workspaceId: string;
  quietExits: FleetGraphDetectorQuietExit[];
  db?: QueryRunner;
}): Promise<void> {
  const nonzeroQuietExits = input.quietExits.filter((quietExit) => quietExit.count > 0);
  if (nonzeroQuietExits.length === 0) return;

  await recordFleetGraphRun({
    workspaceId: input.workspaceId,
    mode: 'proactive',
    triggerReason: 'blocked-important-issue-detector',
    decision: 'quiet_exit',
    outputSnapshot: {
      quietExits: nonzeroQuietExits,
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
