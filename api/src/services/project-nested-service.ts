// Project nested routes: issues/sprints under a project (writes use capability guards).
import { pool } from '../db/client.js';
import type { Principal } from '../security/principal.js';
import {
  guardDocumentMutation,
  type MutationGuardDenial,
} from './mutation-capability-guard.js';
import {
  extractSprintFromRow,
  mapProjectIssueRow,
  projectAccessible,
  type IdRow,
  type MaxSprintNumberRow,
  type ProjectIssueRow,
  type ProjectSprintCreateRow,
  type ProjectSprintRow,
  type ProjectWithProgramRow,
  type WorkspaceMemberUserRow,
} from '../db/projects-repository.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import type { createProjectSprintSchema } from '../schemas/projects.js';
import type { z } from 'zod';

export type ProjectNestedResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: Record<string, unknown> };

function mapNestedGuardDenial(denial: MutationGuardDenial): ProjectNestedResult<never> {
  return { ok: false, status: denial.status, body: denial.body };
}

const PROJECT_SPRINTS_SELECT = `
  SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
         p.title as program_name, p.properties->>'prefix' as program_prefix,
         w.sprint_start_date as workspace_sprint_start_date,
         proj.id as project_id, proj.title as project_name,
         u.id as owner_id, u.name as owner_name, u.email as owner_email,
         (SELECT COUNT(*) FROM documents i
          JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
          WHERE i.document_type = 'issue') as issue_count,
         (SELECT COUNT(*) FROM documents i
          JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
          WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
         (SELECT COUNT(*) FROM documents i
          JOIN document_associations da_i ON da_i.document_id = i.id AND da_i.related_id = d.id AND da_i.relationship_type = 'sprint'
          WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count
  FROM documents d
  JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
  LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
  LEFT JOIN documents p ON prog_da.related_id = p.id
  LEFT JOIN documents proj ON proj.id = $1
  JOIN workspaces w ON d.workspace_id = w.id
  LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
  WHERE d.workspace_id = $2 AND d.document_type = 'sprint'
    AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
  ORDER BY (d.properties->>'sprint_number')::int DESC`;

export async function listProjectIssues(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ProjectNestedResult<ReturnType<typeof mapProjectIssueRow>[]>> {
  const { projectId, workspaceId, userId, isAdmin } = input;

  if (!(await projectAccessible(projectId, workspaceId, userId, isAdmin))) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const result = await pool.query<ProjectIssueRow>(
    `SELECT d.id, d.title, d.properties, d.ticket_number,
            d.created_at, d.updated_at,
            d.started_at, d.completed_at, d.cancelled_at,
            u.name as assignee_name
     FROM documents d
     JOIN document_associations da ON da.document_id = d.id
       AND da.related_id = $1 AND da.relationship_type = 'project'
     LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
     WHERE d.workspace_id = $2 AND d.document_type = 'issue'
       AND d.archived_at IS NULL AND d.deleted_at IS NULL
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
     ORDER BY
       CASE d.properties->>'priority'
         WHEN 'urgent' THEN 1
         WHEN 'high' THEN 2
         WHEN 'medium' THEN 3
         WHEN 'low' THEN 4
         ELSE 5
       END,
       d.updated_at DESC`,
    [projectId, workspaceId, userId, isAdmin]
  );

  return { ok: true, status: 200, body: result.rows.map(mapProjectIssueRow) };
}

export async function listProjectSprints(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ProjectNestedResult<ReturnType<typeof extractSprintFromRow>[]>> {
  const { projectId, workspaceId, userId, isAdmin } = input;

  if (!(await projectAccessible(projectId, workspaceId, userId, isAdmin))) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const result = await pool.query<ProjectSprintRow>(PROJECT_SPRINTS_SELECT, [
    projectId,
    workspaceId,
    userId,
    isAdmin,
  ]);

  return { ok: true, status: 200, body: result.rows.map(extractSprintFromRow) };
}

export async function createProjectSprint(input: {
  principal: Principal;
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
  data: z.infer<typeof createProjectSprintSchema>;
}): Promise<ProjectNestedResult<Record<string, unknown>>> {
  const { principal, projectId, workspaceId, userId, data } = input;

  const writeDenied = await guardDocumentMutation(
    pool,
    principal,
    { action: 'write', documentId: projectId, expectedType: 'project' },
    { notFoundMessage: 'Project not found' }
  );
  if (!writeDenied.ok) return mapNestedGuardDenial(writeDenied);

  const projectCheck = await pool.query<ProjectWithProgramRow>(
    `SELECT d.id, prog_da.related_id as program_id, w.sprint_start_date
     FROM documents d
     JOIN workspaces w ON d.workspace_id = w.id
     LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
     WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'`,
    [projectId, workspaceId]
  );

  const project = projectCheck.rows[0];
  if (!project) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const { title, owner_id, plan, success_criteria, confidence } = data;
  let { sprint_number } = data;

  if (!sprint_number) {
    const maxSprintResult = await pool.query<MaxSprintNumberRow>(
      `SELECT MAX((d.properties->>'sprint_number')::int) as max_sprint
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
       WHERE d.document_type = 'sprint'`,
      [projectId]
    );
    sprint_number = (Number(maxSprintResult.rows[0]?.max_sprint) || 0) + 1;
  }

  const existingCheck = await pool.query<IdRow>(
    `SELECT d.id FROM documents d
     JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
     WHERE d.document_type = 'sprint' AND (d.properties->>'sprint_number')::int = $2`,
    [projectId, sprint_number]
  );

  if (existingCheck.rows.length > 0) {
    return { ok: false, status: 400, body: { error: `Week ${sprint_number} already exists for this project` } };
  }

  let ownerData: WorkspaceMemberUserRow | null = null;
  if (owner_id) {
    const ownerCheck = await pool.query<WorkspaceMemberUserRow>(
      `SELECT u.id, u.name, u.email FROM users u
       JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE u.id = $1 AND wm.workspace_id = $2`,
      [owner_id, workspaceId]
    );

    if (ownerCheck.rows.length === 0) {
      return { ok: false, status: 400, body: { error: 'Owner not found in workspace' } };
    }
    ownerData = ownerCheck.rows[0] ?? null;
  }

  const properties: Record<string, unknown> = { sprint_number };
  if (owner_id) properties.owner_id = owner_id;
  if (plan) {
    properties.plan = plan;
    properties.plan_history = [{
      plan,
      timestamp: new Date().toISOString(),
      author_id: userId,
    }];
  }
  if (success_criteria) properties.success_criteria = success_criteria;
  if (confidence !== undefined) properties.confidence = confidence;

  const defaultContent = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Hypothesis' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'What do we believe will happen? What are we trying to learn or prove?' }],
      },
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Success Criteria' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'How will we know if the plan is validated? What metrics or outcomes will we measure?' }],
      },
    ],
  };

  const result = await pool.query<ProjectSprintCreateRow>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, content)
     VALUES ($1, 'sprint', $2, $3, $4, $5)
     RETURNING id, title, properties`,
    [workspaceId, title, JSON.stringify(properties), userId, JSON.stringify(defaultContent)]
  );

  const sprint = result.rows[0];
  if (!sprint) {
    throw new Error('Create sprint did not return a row');
  }

  await pool.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
     VALUES ($1, $2, 'project', $3)
     ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
    [sprint.id, projectId, JSON.stringify({ created_via: 'POST /api/projects/:id/sprints' })]
  );

  if (project.program_id) {
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')
       ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
      [sprint.id, project.program_id]
    );
  }

  return {
    ok: true,
    status: 201,
    body: {
      id: sprint.id,
      name: sprint.title,
      sprint_number,
      owner: ownerData ? {
        id: ownerData.id,
        name: ownerData.name,
        email: ownerData.email,
      } : null,
      project_id: projectId,
      program_id: project.program_id,
      workspace_sprint_start_date: project.sprint_start_date,
      issue_count: 0,
      completed_count: 0,
      started_count: 0,
      plan: properties.plan || null,
      success_criteria: properties.success_criteria || null,
      confidence: properties.confidence ?? null,
    },
  };
}
