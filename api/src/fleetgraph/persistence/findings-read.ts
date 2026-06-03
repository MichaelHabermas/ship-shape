import { pool } from '../../db/client.js';
import {
  mapFinding,
  mapNotificationFinding,
  type FleetGraphFinding,
  type FleetGraphFindingRow,
  type FleetGraphNotificationFinding,
  type FleetGraphNotificationRow,
  type QueryRunner,
} from './types.js';

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

export async function listFleetGraphFindingsByIds(
  input: { workspaceId: string; findingIds: string[] },
  db: QueryRunner = pool
): Promise<FleetGraphFinding[]> {
  if (input.findingIds.length === 0) return [];
  const result = await db.query<FleetGraphFindingRow>(
    `SELECT *
       FROM fleetgraph_findings
      WHERE workspace_id = $1
        AND id = ANY($2::uuid[])
        AND status IN ('open', 'needs_confirmation', 'error')`,
    [input.workspaceId, input.findingIds]
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
