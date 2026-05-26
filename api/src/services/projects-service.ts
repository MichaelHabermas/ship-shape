// Project service owns project CRUD, rollups, and approval side effects.
import { pool } from '../db/client.js';
import {
  extractProjectFromRow,
  PROJECT_INFERRED_STATUS_SQL,
  projectAccessible,
  type DocumentTypeRow,
  type ProjectPropertiesRow,
  type ProjectRouteProperties,
  type ProjectRow,
  type UserRow,
} from '../db/projects-repository.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { visibleAssociatedDocumentCountSql } from './document-graph-visibility.js';
import { checkDocumentCompleteness } from '../utils/extractHypothesis.js';
import { logDocumentChange, syncProgramAssociation } from '../utils/document-crud.js';
import {
  applyChangedSinceApprovedOnEdit,
  asApprovalRecord,
  buildApprovedApprovalRecord,
  checkProjectAccountableAuth,
  resolveApprovedVersionId,
} from '../utils/approval-workflow.js';
import { broadcastToUser } from '../collaboration/index.js';
import type { createProjectSchema, updateProjectSchema } from '../schemas/projects.js';
import type { z } from 'zod';

export const VALID_PROJECT_SORT_FIELDS = [
  'ice_score',
  'impact',
  'confidence',
  'ease',
  'title',
  'updated_at',
  'created_at',
] as const;

export type ProjectServiceResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: true; status: 301; converted: { documentType: string; id: string } }
  | { ok: false; status: number; body: Record<string, unknown> };

export type ListProjectsInput = {
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
  includeArchived: boolean;
  sortField: string;
  sortDir: 'ASC' | 'DESC';
};

export async function listProjects(
  input: ListProjectsInput
): Promise<ProjectServiceResult<ReturnType<typeof extractProjectFromRow>[]>> {
  const { workspaceId, userId, isAdmin, includeArchived, sortField, sortDir } = input;

  if (!VALID_PROJECT_SORT_FIELDS.includes(sortField as (typeof VALID_PROJECT_SORT_FIELDS)[number])) {
    return {
      ok: false,
      status: 400,
      body: { error: `Invalid sort field. Valid fields: ${VALID_PROJECT_SORT_FIELDS.join(', ')}` },
    };
  }

  let orderByClause: string;
  if (sortField === 'ice_score') {
    orderByClause = `((COALESCE((d.properties->>'impact')::int, 3) * COALESCE((d.properties->>'confidence')::int, 3) * COALESCE((d.properties->>'ease')::int, 3))) ${sortDir}`;
  } else if (['impact', 'confidence', 'ease'].includes(sortField)) {
    orderByClause = `COALESCE((d.properties->>'${sortField}')::int, 3) ${sortDir}`;
  } else if (sortField === 'title') {
    orderByClause = `d.title ${sortDir}`;
  } else {
    orderByClause = `d.${sortField} ${sortDir}`;
  }

  let query = `
    SELECT d.id, d.title, d.properties, prog_da.related_id as program_id, d.archived_at, d.created_at, d.updated_at,
           d.converted_from_id,
           (d.properties->>'owner_id')::uuid as owner_id,
           u.name as owner_name, u.email as owner_email,
           (${visibleAssociatedDocumentCountSql('s', 'project', 'sprint', 'd', '$2', '$3')}) as sprint_count,
           (${visibleAssociatedDocumentCountSql('i', 'project', 'issue', 'd', '$2', '$3')}) as issue_count,
           (${PROJECT_INFERRED_STATUS_SQL}) as inferred_status
    FROM documents d
    LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
    LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
    WHERE d.workspace_id = $1 AND d.document_type = 'project'
      AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
  `;
  const params: (string | boolean)[] = [workspaceId, userId, isAdmin];

  if (!includeArchived) {
    query += ` AND d.archived_at IS NULL`;
  }

  query += ` ORDER BY ${orderByClause}`;

  const result = await pool.query<ProjectRow>(query, params);
  return { ok: true, status: 200, body: result.rows.map(extractProjectFromRow) };
}

export async function getProject(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ProjectServiceResult<ReturnType<typeof extractProjectFromRow>>> {
  const { projectId, workspaceId, userId, isAdmin } = input;

  const result = await pool.query<ProjectRow>(
    `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id, d.archived_at, d.created_at, d.updated_at,
            d.converted_to_id, d.converted_from_id,
            (d.properties->>'owner_id')::uuid as owner_id,
            u.name as owner_name, u.email as owner_email,
            (${visibleAssociatedDocumentCountSql('s', 'project', 'sprint', 'd', '$3', '$4')}) as sprint_count,
            (${visibleAssociatedDocumentCountSql('i', 'project', 'issue', 'd', '$3', '$4')}) as issue_count,
            (${PROJECT_INFERRED_STATUS_SQL}) as inferred_status
     FROM documents d
     LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
     LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
     WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'
       AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
    [projectId, workspaceId, userId, isAdmin]
  );

  const row = result.rows[0];
  if (!row) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  if (row.converted_to_id) {
    const newDocResult = await pool.query<DocumentTypeRow>(
      'SELECT id, document_type FROM documents WHERE id = $1 AND workspace_id = $2',
      [row.converted_to_id, workspaceId]
    );
    const newDoc = newDocResult.rows[0];
    if (newDoc) {
      return { ok: true, status: 301, converted: { documentType: newDoc.document_type, id: newDoc.id } };
    }
  }

  return { ok: true, status: 200, body: extractProjectFromRow(row) };
}

export async function createProject(input: {
  workspaceId: string;
  userId: string;
  data: z.infer<typeof createProjectSchema>;
}): Promise<ProjectServiceResult<ReturnType<typeof extractProjectFromRow> & { owner: { id: string; name: string; email: string } | null }>> {
  const { workspaceId, userId, data } = input;
  const {
    title,
    impact,
    confidence,
    ease,
    owner_id,
    accountable_id,
    consulted_ids,
    informed_ids,
    color,
    emoji,
    program_id,
    plan,
    target_date,
  } = data;

  const properties: Record<string, unknown> = {
    impact,
    confidence,
    ease,
    owner_id,
    accountable_id,
    consulted_ids,
    informed_ids,
    color,
  };
  if (emoji) properties.emoji = emoji;
  if (plan) properties.plan = plan;
  if (target_date) properties.target_date = target_date;

  const completeness = checkDocumentCompleteness('project', properties, 0);
  properties.is_complete = completeness.isComplete;
  properties.missing_fields = completeness.missingFields;

  const result = await pool.query<ProjectRow>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
     VALUES ($1, 'project', $2, $3, $4)
     RETURNING id, title, properties, archived_at, created_at, updated_at`,
    [workspaceId, title, JSON.stringify(properties), userId]
  );

  const createdProject = result.rows[0];
  if (!createdProject) {
    throw new Error('Create project did not return a row');
  }

  if (program_id) {
    await syncProgramAssociation(createdProject.id, program_id);
  }

  let owner = null;
  if (owner_id) {
    const userResult = await pool.query<UserRow>(
      'SELECT id, name, email FROM users WHERE id = $1',
      [owner_id]
    );
    const user = userResult.rows[0];
    if (user) {
      owner = { id: user.id, name: user.name, email: user.email };
    }
  }

  return {
    ok: true,
    status: 201,
    body: {
      ...extractProjectFromRow({ ...createdProject, program_id: program_id || null, inferred_status: 'backlog' }),
      sprint_count: 0,
      issue_count: 0,
      owner,
    },
  };
}

export async function updateProject(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
  data: z.infer<typeof updateProjectSchema>;
}): Promise<ProjectServiceResult<ReturnType<typeof extractProjectFromRow>>> {
  const { projectId, workspaceId, userId, isAdmin, data } = input;

  const existing = await pool.query<ProjectPropertiesRow>(
    `SELECT id, properties FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [projectId, workspaceId, userId, isAdmin]
  );

  if (existing.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const currentProps = existing.rows[0]?.properties || {};
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    values.push(data.title);
  }

  const newProps = { ...currentProps };
  let propsChanged = false;

  if (data.impact !== undefined) {
    newProps.impact = data.impact as ProjectRouteProperties['impact'];
    propsChanged = true;
  }
  if (data.confidence !== undefined) {
    newProps.confidence = data.confidence as ProjectRouteProperties['confidence'];
    propsChanged = true;
  }
  if (data.ease !== undefined) {
    newProps.ease = data.ease as ProjectRouteProperties['ease'];
    propsChanged = true;
  }
  if (data.owner_id !== undefined) {
    newProps.owner_id = data.owner_id;
    propsChanged = true;
  }
  if (data.accountable_id !== undefined) {
    if (!isAdmin) {
      return { ok: false, status: 403, body: { error: 'Only workspace admins can change accountable_id' } };
    }
    newProps.accountable_id = data.accountable_id;
    propsChanged = true;
  }
  if (data.consulted_ids !== undefined) {
    newProps.consulted_ids = data.consulted_ids;
    propsChanged = true;
  }
  if (data.informed_ids !== undefined) {
    newProps.informed_ids = data.informed_ids;
    propsChanged = true;
  }
  if (data.color !== undefined) {
    newProps.color = data.color;
    propsChanged = true;
  }
  if (data.emoji !== undefined) {
    newProps.emoji = data.emoji;
    propsChanged = true;
  }
  if (data.plan !== undefined) {
    newProps.plan = data.plan;
    propsChanged = true;
    if (data.plan !== currentProps.plan) {
      Object.assign(
        newProps,
        applyChangedSinceApprovedOnEdit(
          newProps,
          'plan_approval',
          asApprovalRecord(currentProps.plan_approval),
          true,
        ),
      );
    }
  }
  if (data.target_date !== undefined) {
    newProps.target_date = data.target_date;
    propsChanged = true;
  }
  if (data.has_design_review !== undefined) {
    newProps.has_design_review = data.has_design_review;
    propsChanged = true;
  }
  if (data.design_review_notes !== undefined) {
    newProps.design_review_notes = data.design_review_notes;
    propsChanged = true;
  }

  if (propsChanged) {
    const completeness = checkDocumentCompleteness('project', newProps, 0);
    newProps.is_complete = completeness.isComplete;
    newProps.missing_fields = completeness.missingFields;
    updates.push(`properties = $${paramIndex++}`);
    values.push(JSON.stringify(newProps));
  }

  if (data.archived_at !== undefined) {
    updates.push(`archived_at = $${paramIndex++}`);
    values.push(data.archived_at);
  }

  if (updates.length === 0 && data.program_id === undefined) {
    return { ok: false, status: 400, body: { error: 'No fields to update' } };
  }

  if (updates.length > 0) {
    updates.push(`updated_at = now()`);
    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'project'`,
      [...values, projectId, workspaceId]
    );
  }

  if (data.plan && data.plan.trim() !== '') {
    broadcastToUser(userId, 'accountability:updated', { type: 'project_plan', targetId: projectId });
  }

  if (data.plan !== undefined && data.plan !== currentProps.plan) {
    await logDocumentChange(projectId, 'plan', currentProps.plan || null, data.plan || null, userId);
  }

  if (data.program_id !== undefined) {
    await syncProgramAssociation(projectId, data.program_id ?? null);
  }

  const result = await pool.query<ProjectRow>(
    `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id, d.archived_at, d.created_at, d.updated_at,
            d.converted_from_id,
            (d.properties->>'owner_id')::uuid as owner_id,
            u.name as owner_name, u.email as owner_email,
            (${visibleAssociatedDocumentCountSql('s', 'project', 'sprint', 'd', '$3', '$4')}) as sprint_count,
            (${visibleAssociatedDocumentCountSql('i', 'project', 'issue', 'd', '$3', '$4')}) as issue_count,
            (${PROJECT_INFERRED_STATUS_SQL}) as inferred_status
     FROM documents d
     LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
     LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
     WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'`,
    [projectId, workspaceId, userId, isAdmin]
  );

  const updatedProject = result.rows[0];
  if (!updatedProject) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  return { ok: true, status: 200, body: extractProjectFromRow(updatedProject) };
}

export async function deleteProject(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ProjectServiceResult<null>> {
  const { projectId, workspaceId, userId, isAdmin } = input;

  if (!(await projectAccessible(projectId, workspaceId, userId, isAdmin))) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  await pool.query(
    `DELETE FROM document_associations WHERE related_id = $1 AND relationship_type = 'project'`,
    [projectId]
  );

  await pool.query(
    `DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'`,
    [projectId, workspaceId]
  );

  return { ok: true, status: 204, body: null };
}

export async function approveProjectPlan(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ProjectServiceResult<{ success: true; approval: unknown }>> {
  const { projectId, workspaceId, userId, isAdmin } = input;

  const projectResult = await pool.query<ProjectPropertiesRow>(
    `SELECT id, properties FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [projectId, workspaceId, userId, isAdmin]
  );

  const project = projectResult.rows[0];
  if (!project) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const currentProps = project.properties || {};
  const auth = checkProjectAccountableAuth(currentProps.accountable_id, userId, isAdmin, 'plans');
  if (!auth.authorized) {
    return { ok: false, status: 403, body: { error: auth.error } };
  }

  const versionId = await resolveApprovedVersionId(projectId, 'plan');
  const planApproval = buildApprovedApprovalRecord(userId, versionId);
  const newProps = { ...currentProps, plan_approval: planApproval };

  await pool.query(
    `UPDATE documents SET properties = $1, updated_at = now()
     WHERE id = $2 AND document_type = 'project'`,
    [JSON.stringify(newProps), projectId]
  );

  return { ok: true, status: 200, body: { success: true, approval: newProps.plan_approval } };
}

export async function approveProjectRetro(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ProjectServiceResult<{ success: true; approval: unknown }>> {
  const { projectId, workspaceId, userId, isAdmin } = input;

  const projectResult = await pool.query<ProjectPropertiesRow>(
    `SELECT id, properties FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [projectId, workspaceId, userId, isAdmin]
  );

  const project = projectResult.rows[0];
  if (!project) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const currentProps = project.properties || {};
  const auth = checkProjectAccountableAuth(currentProps.accountable_id, userId, isAdmin, 'retros');
  if (!auth.authorized) {
    return { ok: false, status: 403, body: { error: auth.error } };
  }

  const versionId = await resolveApprovedVersionId(projectId, 'retro_content');
  const retroApproval = buildApprovedApprovalRecord(userId, versionId);
  const newProps = { ...currentProps, retro_approval: retroApproval };

  await pool.query(
    `UPDATE documents SET properties = $1, updated_at = now()
     WHERE id = $2 AND document_type = 'project'`,
    [JSON.stringify(newProps), projectId]
  );

  return { ok: true, status: 200, body: { success: true, approval: newProps.retro_approval } };
}
