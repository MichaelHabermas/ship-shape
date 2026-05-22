/**
 * Shared bootstrap SQL fragments for routes and performance evidence scripts.
 */

import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';

export { VISIBILITY_FILTER_SQL as visibilityFilterSql } from '../middleware/visibility.js';

export const INFERRED_PROJECT_STATUS_SUBQUERY = `
      CASE
        WHEN d.archived_at IS NOT NULL THEN 'archived'
        WHEN d.properties->>'plan_validated' IS NOT NULL THEN 'completed'
        ELSE COALESCE(
          (
            SELECT
              CASE MAX(
                CASE
                  WHEN CURRENT_DATE BETWEEN
                    (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                    AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                  THEN 3
                  WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                  THEN 2
                  ELSE 1
                END
              )
              WHEN 3 THEN 'active'
              WHEN 2 THEN 'planned'
              ELSE NULL
              END
            FROM documents sprint
            JOIN workspaces w ON w.id = sprint.workspace_id
            JOIN document_associations project_da ON project_da.document_id = sprint.id
              AND project_da.relationship_type = 'project'
              AND project_da.related_id = d.id
            WHERE sprint.document_type = 'sprint'
              AND sprint.workspace_id = d.workspace_id
              AND jsonb_array_length(COALESCE(sprint.properties->'assignee_ids', '[]'::jsonb)) > 0
          ),
          'backlog'
        )
      END
    `;

export interface BootstrapExplainContext {
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
  currentSprintNumber: number;
  todayIso: string;
  todayStr: string;
}

export interface BootstrapExplainQuery {
  name: string;
  endpoint: string;
  source: string;
  sql: string;
  params: unknown[];
}

export function buildBootstrapExplainCatalog(ctx: BootstrapExplainContext): {
  old_protected_docs_startup_fanout: Array<{
    endpoint: string;
    constituent_query_names?: string[];
    note?: string;
  }>;
  current_bootstrap: BootstrapExplainQuery[];
} {
  const { workspaceId, userId, isAdmin, currentSprintNumber, todayIso, todayStr } = ctx;
  const visibilitySql = VISIBILITY_FILTER_SQL('d', '$2', '$3');

  const currentBootstrap: BootstrapExplainQuery[] = [
    {
      name: 'bootstrap_user',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts userResult',
      sql: 'SELECT id, email, name, is_super_admin FROM users WHERE id = $1',
      params: [userId],
    },
    {
      name: 'bootstrap_workspaces',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts workspacesResult',
      sql: `SELECT w.id, w.name, wm.role
            FROM workspaces w
            JOIN workspace_memberships wm ON w.id = wm.workspace_id
            WHERE wm.user_id = $1 AND w.archived_at IS NULL
            ORDER BY w.name`,
      params: [userId],
    },
    {
      name: 'bootstrap_current_workspace',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts currentWorkspaceResult',
      sql: `SELECT w.id, w.name, wm.role
            FROM workspaces w
            LEFT JOIN workspace_memberships wm ON w.id = wm.workspace_id AND wm.user_id = $2
            WHERE w.id = $1`,
      params: [workspaceId, userId],
    },
    {
      name: 'bootstrap_documents_wiki',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts documentsResult',
      sql: `SELECT id, workspace_id, document_type, title, parent_id, position,
                   ticket_number, properties, created_at, updated_at, created_by, visibility
            FROM documents d
            WHERE workspace_id = $1
              AND document_type = 'wiki'
              AND archived_at IS NULL
              AND deleted_at IS NULL
              AND ${visibilitySql}
            ORDER BY position ASC, created_at ASC`,
      params: [workspaceId, userId, isAdmin],
    },
    {
      name: 'bootstrap_programs',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts programsResult',
      sql: `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
                   COALESCE((d.properties->>'owner_id')::uuid, d.created_by) AS owner_id,
                   u.name AS owner_name, u.email AS owner_email,
                   (SELECT COUNT(*) FROM documents i
                    JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'program'
                    WHERE i.document_type = 'issue') AS issue_count,
                   (SELECT COUNT(*) FROM documents s
                    JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'program'
                    WHERE s.document_type = 'sprint') AS sprint_count
            FROM documents d
            LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
            WHERE d.workspace_id = $1 AND d.document_type = 'program'
              AND d.archived_at IS NULL
              AND ${visibilitySql}
            ORDER BY d.created_at DESC`,
      params: [workspaceId, userId, isAdmin],
    },
    {
      name: 'bootstrap_projects',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts projectsResult',
      sql: `SELECT d.id, d.title, d.properties, prog_da.related_id AS program_id,
                   d.archived_at, d.created_at, d.updated_at, d.converted_from_id,
                   (d.properties->>'owner_id')::uuid AS owner_id,
                   u.name AS owner_name, u.email AS owner_email,
                   (SELECT COUNT(*) FROM documents s
                    JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'project'
                    WHERE s.document_type = 'sprint') AS sprint_count,
                   (SELECT COUNT(*) FROM documents i
                    JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'project'
                    WHERE i.document_type = 'issue') AS issue_count,
                   (${INFERRED_PROJECT_STATUS_SUBQUERY}) AS inferred_status
            FROM documents d
            LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
            LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
            WHERE d.workspace_id = $1 AND d.document_type = 'project'
              AND d.archived_at IS NULL
              AND ${visibilitySql}
            ORDER BY ((COALESCE((d.properties->>'impact')::int, 3) * COALESCE((d.properties->>'confidence')::int, 3) * COALESCE((d.properties->>'ease')::int, 3))) DESC`,
      params: [workspaceId, userId, isAdmin],
    },
    {
      name: 'bootstrap_issues',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts issuesResult',
      sql: `SELECT d.id, d.title, d.properties, d.ticket_number,
                   d.created_at, d.updated_at, d.created_by,
                   d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
                   d.converted_from_id,
                   u.name AS assignee_name,
                   CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END AS assignee_archived
            FROM documents d
            LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
            LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
              AND person_doc.document_type = 'person'
              AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
            WHERE d.workspace_id = $1 AND d.document_type = 'issue'
              AND ${visibilitySql}
              AND d.archived_at IS NULL
              AND d.deleted_at IS NULL
            ORDER BY
              CASE d.properties->>'priority'
                WHEN 'urgent' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
              END,
              d.updated_at DESC`,
      params: [workspaceId, userId, isAdmin],
    },
    {
      name: 'bootstrap_workspace_sprint_start',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts workspaceResult',
      sql: 'SELECT sprint_start_date FROM workspaces WHERE id = $1',
      params: [workspaceId],
    },
    {
      name: 'bootstrap_active_sprints_for_standup',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts activeSprintsResult',
      sql: `SELECT DISTINCT s.id AS sprint_id
            FROM documents i
            JOIN document_associations da ON da.document_id = i.id AND da.relationship_type = 'sprint'
            JOIN documents s ON s.id = da.related_id AND s.document_type = 'sprint'
            WHERE i.workspace_id = $1
              AND i.document_type = 'issue'
              AND i.archived_at IS NULL
              AND i.deleted_at IS NULL
              AND (i.visibility = 'workspace' OR i.created_by = $4 OR $5 = TRUE)
              AND (i.properties->>'assignee_id')::uuid = $2
              AND (s.properties->>'sprint_number')::int = $3`,
      params: [workspaceId, userId, currentSprintNumber, userId, isAdmin],
    },
    {
      name: 'bootstrap_standup_last_posted_probe',
      endpoint: '/api/bootstrap',
      source: 'api/src/routes/bootstrap.ts standupResult',
      sql: `WITH active_sprints AS (
              SELECT DISTINCT s.id AS sprint_id
              FROM documents i
              JOIN document_associations da ON da.document_id = i.id AND da.relationship_type = 'sprint'
              JOIN documents s ON s.id = da.related_id AND s.document_type = 'sprint'
              WHERE i.workspace_id = $1
                AND i.document_type = 'issue'
                AND i.archived_at IS NULL
                AND i.deleted_at IS NULL
                AND (i.visibility = 'workspace' OR i.created_by = $4 OR $5 = TRUE)
                AND (i.properties->>'assignee_id')::uuid = $2
                AND (s.properties->>'sprint_number')::int = $3
            )
            SELECT MAX(created_at) AS last_posted
            FROM documents
            WHERE workspace_id = $1
              AND document_type = 'standup'
              AND (properties->>'author_id')::uuid = $2
              AND deleted_at IS NULL
              AND (
                (properties->>'date') = $6
                OR (parent_id IN (SELECT sprint_id FROM active_sprints) AND created_at >= $7)
              )`,
      params: [workspaceId, userId, currentSprintNumber, userId, isAdmin, todayStr, todayIso],
    },
  ];

  return {
    old_protected_docs_startup_fanout: [
      {
        endpoint: '/api/auth/me',
        constituent_query_names: ['bootstrap_user', 'bootstrap_workspaces', 'bootstrap_current_workspace'],
      },
      {
        endpoint: '/api/documents?type=wiki',
        constituent_query_names: ['bootstrap_documents_wiki'],
      },
      {
        endpoint: '/api/programs',
        constituent_query_names: ['bootstrap_programs'],
      },
      {
        endpoint: '/api/projects',
        constituent_query_names: ['bootstrap_projects'],
      },
      {
        endpoint: '/api/issues',
        constituent_query_names: ['bootstrap_issues'],
      },
      {
        endpoint: '/api/standups/status',
        constituent_query_names: [
          'bootstrap_workspace_sprint_start',
          'bootstrap_active_sprints_for_standup',
          'bootstrap_standup_last_posted_probe',
        ],
      },
      {
        endpoint: '/api/accountability/action-items',
        note: 'Shares checkMissingAccountability(userId, workspaceId) with bootstrap; the detailed service fanout is intentionally not duplicated in this evidence script.',
      },
    ],
    current_bootstrap: currentBootstrap,
  };
}

export function oldFanoutQueries(bootstrapEvidence: ReturnType<typeof buildBootstrapExplainCatalog>): BootstrapExplainQuery[] {
  const queriesByName = new Map(bootstrapEvidence.current_bootstrap.map((query) => [query.name, query]));
  const names: string[] = [];
  for (const request of bootstrapEvidence.old_protected_docs_startup_fanout) {
    for (const name of request.constituent_query_names || []) {
      if (!names.includes(name)) names.push(name);
    }
  }

  return names.map((name) => {
    const query = queriesByName.get(name);
    if (!query) throw new Error(`Missing bootstrap EXPLAIN query definition for old fanout constituent "${name}".`);
    return {
      ...query,
      endpoint: 'pre-bootstrap protected docs startup fanout',
      source: `${query.source}; equivalent constituent SQL used by legacy app-shell request fanout`,
    };
  });
}
