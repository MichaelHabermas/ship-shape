/**
 * Shared allocation detection logic.
 *
 * Determines a person's project allocations for a given sprint.
 * Used by the accountability service to find all projects a person
 * is responsible for in a given week.
 *
 * Sources (deduplicated by project):
 * 1. Explicit sprint assignee_ids (person listed in sprint.properties.assignee_ids)
 * 2. Issue-based inference (person has issues assigned in a sprint for a project)
 *
 * Note: The heatmap (team.ts) only displays ONE allocation per person per week
 * due to its grid layout. The accountability service uses ALL allocations so
 * no action items are missed.
 */

import { pool } from '../db/client.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';

export interface Allocation {
  projectId: string;
  projectName: string;
}

/**
 * Get all project allocations for a person in a specific sprint.
 *
 * @param workspaceId - Workspace ID
 * @param personId - Person document ID (used for assignee_ids lookup)
 * @param userId - Auth user ID (used for issue assignee_id lookup)
 * @param sprintNumber - Sprint/week number to check
 * @returns All project allocations (deduplicated by project ID)
 */
export async function getAllocations(
  workspaceId: string,
  personId: string,
  userId: string,
  sprintNumber: number,
  isAdmin = false
): Promise<Allocation[]> {
  // Find all projects via explicit assignee_ids OR issue assignments (deduplicated)
  const result = await pool.query(
    `SELECT DISTINCT ON (project_id) project_id, project_name FROM (
       -- Explicit sprint assignee_ids
       SELECT (s.properties->>'project_id')::uuid as project_id, proj.title as project_name
       FROM documents s
       JOIN documents proj ON (s.properties->>'project_id')::uuid = proj.id
        AND proj.workspace_id = s.workspace_id
        AND proj.document_type = 'project'
       WHERE s.workspace_id = $1
         AND s.document_type = 'sprint'
         AND (s.properties->>'sprint_number')::int = $3
         AND s.properties->'assignee_ids' @> to_jsonb($2::text)
         AND s.deleted_at IS NULL
         AND s.archived_at IS NULL
         AND proj.deleted_at IS NULL
         AND proj.archived_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('s', '$4', '$5')}
         AND ${VISIBILITY_FILTER_SQL('proj', '$4', '$5')}
       UNION
       -- Issue-based inference
       SELECT proj.id as project_id, proj.title as project_name
       FROM documents i
       JOIN document_associations sprint_da ON sprint_da.document_id = i.id AND sprint_da.relationship_type = 'sprint'
       JOIN documents s ON s.id = sprint_da.related_id AND s.document_type = 'sprint' AND s.workspace_id = i.workspace_id
       JOIN document_associations proj_da ON proj_da.document_id = s.id AND proj_da.relationship_type = 'project'
       JOIN documents proj ON proj.id = proj_da.related_id AND proj.document_type = 'project' AND proj.workspace_id = i.workspace_id
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND (i.properties->>'assignee_id')::uuid = $4
         AND (s.properties->>'sprint_number')::int = $3
         AND i.deleted_at IS NULL
         AND s.deleted_at IS NULL
         AND proj.deleted_at IS NULL
         AND i.archived_at IS NULL
         AND s.archived_at IS NULL
         AND proj.archived_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('i', '$4', '$5')}
         AND ${VISIBILITY_FILTER_SQL('s', '$4', '$5')}
         AND ${VISIBILITY_FILTER_SQL('proj', '$4', '$5')}
     ) allocations
     ORDER BY project_id`,
    [workspaceId, personId, sprintNumber, userId, isAdmin]
  );

  return result.rows.map(row => ({
    projectId: row.project_id,
    projectName: row.project_name || 'Untitled Project',
  }));
}
