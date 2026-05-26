// FleetGraph deterministic detectors select candidate work before graph reasoning.
import { pool } from '../db/client.js';
import { blockedImportantIssueDedupeKey } from './persistence.js';
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
