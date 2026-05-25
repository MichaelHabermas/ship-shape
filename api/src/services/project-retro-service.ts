import { pool } from '../db/client.js';
import type {
  ProjectRetroIssueRow,
  ProjectRetroProjectRow,
  ProjectRetroSprintRow,
  ProjectPropertiesRow,
  ProjectRow,
  ProjectRouteProperties,
  TipTapJsonDoc,
} from '../db/projects-repository.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { logDocumentChange } from '../utils/document-crud.js';
import {
  applyChangedSinceApprovedOnEdit,
  asApprovalRecord,
} from '../utils/approval-workflow.js';
import { broadcastToUser } from '../collaboration/index.js';
import type { projectRetroSchema } from '../schemas/projects.js';
import type { z } from 'zod';

export type ProjectRetroResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: Record<string, unknown> };

type RetroResponseBody = {
  is_draft: boolean;
  plan_validated: boolean | null | undefined;
  monetary_impact_expected: string | null;
  monetary_impact_actual: string | null;
  success_criteria: string[];
  next_steps: string | null;
  content: unknown;
  weeks: ProjectRetroSprintRow[];
  issues_summary: {
    total: number;
    completed: number;
    cancelled: number;
    active: number;
  };
};

function buildIssuesSummary(issues: ProjectRetroIssueRow[]) {
  return {
    total: issues.length,
    completed: issues.filter(i => i.state === 'done').length,
    cancelled: issues.filter(i => i.state === 'cancelled').length,
    active: issues.filter(i => !['done', 'cancelled'].includes(i.state ?? '')).length,
  };
}

export async function getProjectRetro(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ProjectRetroResult<RetroResponseBody>> {
  const { projectId, workspaceId, userId, isAdmin } = input;

  const projectResult = await pool.query<ProjectRetroProjectRow>(
    `SELECT id, title, content, properties FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [projectId, workspaceId, userId, isAdmin]
  );

  const projectData = projectResult.rows.at(0);
  if (!projectData) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const props = projectData.properties || {};
  const hasRetro = props.plan_validated !== undefined && props.plan_validated !== null;

  const sprintsResult = await pool.query<ProjectRetroSprintRow>(
    `SELECT d.id, d.title, d.properties->>'sprint_number' as sprint_number
     FROM documents d
     JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
     WHERE d.document_type = 'sprint'
     ORDER BY (d.properties->>'sprint_number')::int ASC`,
    [projectId]
  );

  const issuesResult = await pool.query<ProjectRetroIssueRow>(
    `SELECT d.id, d.title, d.properties->>'state' as state
     FROM documents d
     JOIN document_associations da ON da.document_id = d.id
       AND da.related_id = $1 AND da.relationship_type = 'project'
     WHERE d.document_type = 'issue'
       AND d.archived_at IS NULL AND d.deleted_at IS NULL`,
    [projectId]
  );

  const issuesSummary = buildIssuesSummary(issuesResult.rows);

  if (hasRetro) {
    return {
      ok: true,
      status: 200,
      body: {
        is_draft: false,
        plan_validated: props.plan_validated,
        monetary_impact_expected: props.monetary_impact_expected || null,
        monetary_impact_actual: props.monetary_impact_actual || null,
        success_criteria: props.success_criteria || [],
        next_steps: props.next_steps || null,
        content: projectData.content || {},
        weeks: sprintsResult.rows,
        issues_summary: issuesSummary,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      is_draft: true,
      plan_validated: null,
      monetary_impact_expected: props.monetary_impact_expected || null,
      monetary_impact_actual: null,
      success_criteria: [],
      next_steps: null,
      content: generatePrefilledRetroContent(projectData, sprintsResult.rows, issuesResult.rows),
      weeks: sprintsResult.rows,
      issues_summary: issuesSummary,
    },
  };
}

export async function createProjectRetro(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
  data: z.infer<typeof projectRetroSchema>;
}): Promise<ProjectRetroResult<Omit<RetroResponseBody, 'weeks' | 'issues_summary'>>> {
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
  const { plan_validated, monetary_impact_actual, success_criteria, next_steps, content } = data;

  const newProps = {
    ...currentProps,
    plan_validated: plan_validated ?? currentProps.plan_validated,
    monetary_impact_actual: monetary_impact_actual ?? currentProps.monetary_impact_actual,
    success_criteria: success_criteria ?? currentProps.success_criteria,
    next_steps: next_steps ?? currentProps.next_steps,
  };

  const updates: string[] = ['properties = $1', 'updated_at = now()'];
  const values: unknown[] = [JSON.stringify(newProps)];

  if (content) {
    updates.push('content = $2');
    values.push(JSON.stringify(content));
  }

  await pool.query(
    `UPDATE documents SET ${updates.join(', ')}
     WHERE id = $${values.length + 1} AND workspace_id = $${values.length + 2} AND document_type = 'project'`,
    [...values, projectId, workspaceId]
  );

  broadcastToUser(userId, 'accountability:updated', { type: 'project_retro', targetId: projectId });

  if (content) {
    await logDocumentChange(projectId, 'retro_content', null, JSON.stringify(content), userId);
  }

  const result = await pool.query<ProjectRow>(
    `SELECT id, title, content, properties FROM documents WHERE id = $1`,
    [projectId]
  );

  const updatedRow = result.rows[0];
  if (!updatedRow) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const updatedProps = updatedRow.properties || {};
  return {
    ok: true,
    status: 201,
    body: {
      is_draft: false,
      plan_validated: updatedProps.plan_validated,
      monetary_impact_expected: updatedProps.monetary_impact_expected || null,
      monetary_impact_actual: updatedProps.monetary_impact_actual || null,
      success_criteria: updatedProps.success_criteria || [],
      next_steps: updatedProps.next_steps || null,
      content: updatedRow.content || {},
    },
  };
}

export async function updateProjectRetro(input: {
  projectId: string;
  workspaceId: string;
  userId: string;
  isAdmin: boolean;
  data: z.infer<typeof projectRetroSchema>;
}): Promise<ProjectRetroResult<Omit<RetroResponseBody, 'weeks' | 'issues_summary'>>> {
  const { projectId, workspaceId, userId, isAdmin, data } = input;

  const existing = await pool.query<ProjectPropertiesRow>(
    `SELECT id, properties, content FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [projectId, workspaceId, userId, isAdmin]
  );

  if (existing.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const currentProps = existing.rows[0]?.properties || {};
  const currentContent = existing.rows[0]?.content;
  const { plan_validated, monetary_impact_actual, success_criteria, next_steps, content } = data;

  const newProps: ProjectRouteProperties = { ...currentProps };
  if (plan_validated !== undefined) newProps.plan_validated = plan_validated;
  if (monetary_impact_actual !== undefined) newProps.monetary_impact_actual = monetary_impact_actual;
  if (success_criteria !== undefined) newProps.success_criteria = success_criteria;
  if (next_steps !== undefined) newProps.next_steps = next_steps;

  const retroFieldsChanged = plan_validated !== undefined ||
    monetary_impact_actual !== undefined ||
    success_criteria !== undefined ||
    next_steps !== undefined ||
    content !== undefined;

  Object.assign(
    newProps,
    applyChangedSinceApprovedOnEdit(
      newProps,
      'retro_approval',
      asApprovalRecord(currentProps.retro_approval),
      retroFieldsChanged,
    ),
  );

  const updates: string[] = ['properties = $1', 'updated_at = now()'];
  const values: unknown[] = [JSON.stringify(newProps)];

  if (content !== undefined) {
    updates.push('content = $2');
    values.push(JSON.stringify(content));
  }

  await pool.query(
    `UPDATE documents SET ${updates.join(', ')}
     WHERE id = $${values.length + 1} AND workspace_id = $${values.length + 2} AND document_type = 'project'`,
    [...values, projectId, workspaceId]
  );

  if (content !== undefined) {
    const oldContent = currentContent ? JSON.stringify(currentContent) : null;
    const newContent = JSON.stringify(content);
    if (oldContent !== newContent) {
      await logDocumentChange(projectId, 'retro_content', oldContent, newContent, userId);
    }
  }

  const result = await pool.query<ProjectPropertiesRow>(
    `SELECT id, title, content, properties FROM documents WHERE id = $1`,
    [projectId]
  );

  const updatedRow = result.rows[0];
  const updatedProps = updatedRow?.properties || {};
  return {
    ok: true,
    status: 200,
    body: {
      is_draft: false,
      plan_validated: updatedProps.plan_validated,
      monetary_impact_expected: updatedProps.monetary_impact_expected || null,
      monetary_impact_actual: updatedProps.monetary_impact_actual || null,
      success_criteria: updatedProps.success_criteria || [],
      next_steps: updatedProps.next_steps || null,
      content: updatedRow?.content || {},
    },
  };
}

export function generatePrefilledRetroContent(
  projectData: ProjectRetroProjectRow,
  sprints: ProjectRetroSprintRow[],
  issues: ProjectRetroIssueRow[]
): TipTapJsonDoc {
  const props = projectData.properties || {};

  const completedIssues = issues.filter(i => i.state === 'done');
  const cancelledIssues = issues.filter(i => i.state === 'cancelled');
  const activeIssues = issues.filter(i => !['done', 'cancelled'].includes(i.state ?? ''));

  const content: TipTapJsonDoc = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Project Summary' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Project: ${projectData.title}` }],
      },
    ],
  };

  const impact = props.impact ?? null;
  const confidence = props.confidence ?? null;
  const ease = props.ease ?? null;
  const iceScore = (impact !== null && confidence !== null && ease !== null)
    ? impact * confidence * ease
    : null;

  const formatIceValue = (val: number | null) => val !== null ? `${val}/5` : 'Not set';
  const formatIceScore = (val: number | null) => val !== null ? String(val) : 'Not set';

  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'ICE Scores' }],
  });
  content.content.push({
    type: 'bulletList',
    content: [
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Impact: ${formatIceValue(impact)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Confidence: ${formatIceValue(confidence)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Ease: ${formatIceValue(ease)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `ICE Score: ${formatIceScore(iceScore)}` }] }],
      },
    ],
  });

  if (props.monetary_impact_expected) {
    content.content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `Expected Impact: ${props.monetary_impact_expected}` }],
    });
  }

  if (sprints.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Weeks (${sprints.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: sprints.map(s => ({
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: `Week ${s.sprint_number}: ${s.title}` }],
        }],
      })),
    });
  }

  if (completedIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Completed Issues (${completedIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: completedIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: i.title }] }],
      })),
    });
  }

  if (activeIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Outstanding Issues (${activeIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: activeIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `${i.title} (${i.state})` }] }],
      })),
    });
  }

  if (cancelledIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Cancelled Issues (${cancelledIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: cancelledIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: i.title }] }],
      })),
    });
  }

  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Hypothesis Validation' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'Was the plan validated? (Set in properties)' }],
  });

  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Actual Monetary Impact' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'Document the actual monetary impact here.' }],
  });

  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Key Learnings' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'What did we learn from this project?' }],
  });

  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Next Steps' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'What follow-up actions are recommended?' }],
  });

  return content;
}
