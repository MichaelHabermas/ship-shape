// FleetGraph issue attention context reads source issue facts without deciding signal policy.
import type { DocumentVisibility, IssuePriority, IssueState } from '@ship/shared';
import { pool } from '../../db/client.js';
import { visibilityPredicate } from '../../services/document-access.js';

type QueryRunner = Pick<typeof pool, 'query'>;

export type FleetGraphIssueAttentionContext = {
  workspace_id: string;
  issue_id: string;
  issue_title: string;
  issue_ticket_number: number | null;
  issue_state: IssueState | null;
  issue_priority: IssuePriority;
  issue_assignee_id: string | null;
  issue_assignee_name: string | null;
  issue_visibility: DocumentVisibility;
  issue_created_at: Date;
  issue_updated_at: Date;
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
  latest_iteration_id: string | null;
  latest_iteration_created_at: Date | null;
  meaningful_updated_at: Date;
};

export async function listFleetGraphIssueAttentionContexts(input: {
  workspaceId: string;
  sourceIssueId?: string;
  sourceSprintId?: string | null;
  includePrivate?: boolean;
  limit?: number;
  viewerUserId?: string;
  viewerIsAdmin?: boolean;
  db?: QueryRunner;
}): Promise<FleetGraphIssueAttentionContext[]> {
  const db = input.db ?? pool;
  const viewerFilterEnabled = Boolean(input.viewerUserId);
  const viewerUserId = input.viewerUserId ?? null;
  const viewerIsAdmin = input.viewerIsAdmin ?? false;
  const result = await db.query<FleetGraphIssueAttentionContext>(
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
         WHEN 'none' THEN 'none'
         ELSE 'medium'
       END AS issue_priority,
       NULLIF(i.properties->>'assignee_id', '') AS issue_assignee_id,
       assignee.name AS issue_assignee_name,
       COALESCE(i.visibility, 'workspace') AS issue_visibility,
       i.created_at AS issue_created_at,
       i.updated_at AS issue_updated_at,
       s.id AS sprint_id,
       s.title AS sprint_title,
       CASE
         WHEN s.properties->>'sprint_number' ~ '^\\d+$' THEN (s.properties->>'sprint_number')::int
         ELSE NULL
       END AS sprint_number,
       COALESCE(NULLIF(s.properties->>'owner_id', ''), NULLIF(s.properties->'assignee_ids'->>0, '')) AS sprint_owner_id,
       sprint_owner.name AS sprint_owner_name,
       project.id AS project_id,
       project.title AS project_title,
       COALESCE(
         project_owner.id::text,
         project_owner_person_user.id::text,
         CASE WHEN $6::boolean = FALSE THEN NULLIF(project.properties->>'owner_id', '') ELSE NULL END
       ) AS project_owner_id,
       COALESCE(project_owner.name, project_owner_person_user.name, project_owner_person.title) AS project_owner_name,
       program.id AS program_id,
       program.title AS program_title,
       COALESCE(
         program_owner.id::text,
         program_owner_person_user.id::text,
         CASE WHEN $6::boolean = FALSE THEN NULLIF(program.properties->>'owner_id', '') ELSE NULL END
       ) AS program_owner_id,
       COALESCE(program_owner.name, program_owner_person_user.name, program_owner_person.title) AS program_owner_name,
       COALESCE(latest_blocker_iteration.blockers_encountered, '') AS blocker_text,
       latest_blocker_iteration.id AS blocker_iteration_id,
       latest_blocker_iteration.created_at AS blocker_iteration_created_at,
       latest_iteration.id AS latest_iteration_id,
       latest_iteration.created_at AS latest_iteration_created_at,
       COALESCE(latest_iteration.created_at, i.created_at) AS meaningful_updated_at
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
      AND ($6::boolean = FALSE OR ${visibilityPredicate('s', '$7', '$8')})
     LEFT JOIN LATERAL (
       SELECT iteration.id, iteration.created_at
         FROM issue_iterations iteration
        WHERE iteration.issue_id = i.id
          AND iteration.workspace_id = i.workspace_id
        ORDER BY iteration.created_at DESC, iteration.id DESC
        LIMIT 1
     ) latest_iteration ON TRUE
     LEFT JOIN LATERAL (
       SELECT iteration.id, iteration.blockers_encountered, iteration.created_at
         FROM issue_iterations iteration
        WHERE iteration.issue_id = i.id
          AND iteration.workspace_id = i.workspace_id
          AND btrim(COALESCE(iteration.blockers_encountered, '')) <> ''
        ORDER BY iteration.created_at DESC, iteration.id DESC
        LIMIT 1
     ) latest_blocker_iteration ON TRUE
     LEFT JOIN users assignee
       ON assignee.id = CASE
            WHEN i.properties->>'assignee_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (i.properties->>'assignee_id')::uuid
            ELSE NULL
          END
     LEFT JOIN users sprint_owner
       ON sprint_owner.id = CASE
            WHEN COALESCE(NULLIF(s.properties->>'owner_id', ''), NULLIF(s.properties->'assignee_ids'->>0, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN COALESCE(NULLIF(s.properties->>'owner_id', ''), NULLIF(s.properties->'assignee_ids'->>0, ''))::uuid
            ELSE NULL
          END
     LEFT JOIN LATERAL (
       SELECT p.*
         FROM document_associations project_assoc
         JOIN documents p
           ON p.id = project_assoc.related_id
          AND p.workspace_id = i.workspace_id
          AND p.document_type = 'project'
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
          AND ($6::boolean = FALSE OR ${visibilityPredicate('p', '$7', '$8')})
        WHERE project_assoc.document_id = i.id
          AND project_assoc.relationship_type = 'project'
        ORDER BY project_assoc.created_at DESC
        LIMIT 1
     ) project ON TRUE
     LEFT JOIN users project_owner
       ON project_owner.id = CASE
            WHEN project.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project.properties->>'owner_id')::uuid
            ELSE NULL
          END
     LEFT JOIN documents project_owner_person
       ON project_owner_person.id = CASE
            WHEN project.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project.properties->>'owner_id')::uuid
            ELSE NULL
          END
      AND project_owner_person.workspace_id = i.workspace_id
     AND project_owner_person.document_type = 'person'
     AND project_owner_person.deleted_at IS NULL
     AND project_owner_person.archived_at IS NULL
      AND ($6::boolean = FALSE OR ${visibilityPredicate('project_owner_person', '$7', '$8')})
     LEFT JOIN users project_owner_person_user
       ON project_owner_person_user.id = CASE
            WHEN project_owner_person.properties->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (project_owner_person.properties->>'user_id')::uuid
            ELSE NULL
          END
     LEFT JOIN LATERAL (
       SELECT p.*
         FROM document_associations program_assoc
         JOIN documents p
           ON p.id = program_assoc.related_id
          AND p.workspace_id = i.workspace_id
          AND p.document_type = 'program'
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
          AND ($6::boolean = FALSE OR ${visibilityPredicate('p', '$7', '$8')})
        WHERE program_assoc.relationship_type = 'program'
          AND program_assoc.document_id IN (i.id, project.id, s.id)
        ORDER BY
          CASE program_assoc.document_id
            WHEN i.id THEN 1
            WHEN project.id THEN 2
            ELSE 3
          END,
          program_assoc.created_at DESC
        LIMIT 1
     ) program ON TRUE
     LEFT JOIN users program_owner
       ON program_owner.id = CASE
            WHEN program.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program.properties->>'owner_id')::uuid
            ELSE NULL
          END
     LEFT JOIN documents program_owner_person
       ON program_owner_person.id = CASE
            WHEN program.properties->>'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program.properties->>'owner_id')::uuid
            ELSE NULL
          END
      AND program_owner_person.workspace_id = i.workspace_id
     AND program_owner_person.document_type = 'person'
     AND program_owner_person.deleted_at IS NULL
     AND program_owner_person.archived_at IS NULL
      AND ($6::boolean = FALSE OR ${visibilityPredicate('program_owner_person', '$7', '$8')})
     LEFT JOIN users program_owner_person_user
       ON program_owner_person_user.id = CASE
            WHEN program_owner_person.properties->>'user_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (program_owner_person.properties->>'user_id')::uuid
            ELSE NULL
          END
     WHERE i.workspace_id = $1
       AND i.document_type = 'issue'
       AND i.deleted_at IS NULL
       AND i.archived_at IS NULL
       AND ($2::uuid IS NULL OR i.id = $2::uuid)
       AND ($3::uuid IS NULL OR s.id = $3::uuid)
       AND (
         ($6::boolean = TRUE AND ${visibilityPredicate('i', '$7', '$8')})
         OR ($6::boolean = FALSE AND ($4::boolean OR COALESCE(i.visibility, 'workspace') <> 'private'))
       )
     ORDER BY
       CASE i.properties->>'priority'
         WHEN 'urgent' THEN 1
         WHEN 'high' THEN 2
         WHEN 'medium' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END,
       COALESCE(latest_iteration.created_at, i.created_at) ASC,
       i.updated_at DESC
     LIMIT $5`,
    [
      input.workspaceId,
      input.sourceIssueId ?? null,
      input.sourceSprintId ?? null,
      input.includePrivate === true,
      input.limit ?? 250,
      viewerFilterEnabled,
      viewerUserId,
      viewerIsAdmin,
    ]
  );

  return result.rows;
}
