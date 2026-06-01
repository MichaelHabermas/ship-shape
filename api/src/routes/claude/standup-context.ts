import { pool } from '../../db/client.js';
import { visibilityPredicate, type DocumentActor } from '../../services/document-access.js';
import {
  extractClaudeProgramFromRow,
  extractClaudeProjectFromRow,
  extractClaudeSprintFromRow,
  extractClaudeStandupFromRow,
} from './extract.js';
import {
  generateStandupQuestions,
} from './prompt-questions.js';
import type {
  ClaudeSprintContextRow,
  ClaudeStandupRow,
  ClaudeIssueRow,
} from './types.js';
export async function getStandupContext(sprintId: string, actor: DocumentActor, isAdmin: boolean) {
  const { workspaceId, userId } = actor;

  // Get sprint with program and project info via junction table
  const sprintResult = await pool.query<ClaudeSprintContextRow>(`
    SELECT
      s.id as sprint_id,
      s.title as sprint_title,
      s.properties->>'sprint_number' as sprint_number,
      s.properties->>'status' as sprint_status,
      s.properties->>'plan' as sprint_plan,
      da_prog.related_id as program_id,
      p.title as program_name,
      p.content as program_content,
      p.properties->>'description' as program_description,
      p.properties->>'goals' as program_goals,
      proj.id as project_id,
      proj.title as project_name,
      proj.properties->>'plan' as project_plan,
      proj.properties->>'ice_impact' as ice_impact,
      proj.properties->>'ice_confidence' as ice_confidence,
      proj.properties->>'ice_ease' as ice_ease,
      proj.properties->>'monetary_impact' as monetary_impact_expected
    FROM documents s
    LEFT JOIN document_associations da_proj ON da_proj.document_id = s.id AND da_proj.relationship_type = 'project'
    LEFT JOIN documents proj ON da_proj.related_id = proj.id AND proj.document_type = 'project'
    LEFT JOIN document_associations da_prog ON da_prog.document_id = proj.id AND da_prog.relationship_type = 'program'
    LEFT JOIN documents p ON da_prog.related_id = p.id AND p.document_type = 'program'
    WHERE s.id = $1
      AND s.document_type = 'sprint'
      AND s.workspace_id = $2
      AND ${visibilityPredicate('s', '$3', '$4')}
  `, [sprintId, workspaceId, userId, isAdmin]);

  if (sprintResult.rows.length === 0) {
    throw new Error('Week not found');
  }

  const sprint = sprintResult.rows[0];
  if (!sprint) {
    throw new Error('Week not found');
  }

  // Get recent standups for this sprint (last 5) via junction table
  const standupsResult = await pool.query<ClaudeStandupRow>(`
    SELECT
      d.id,
      d.title,
      d.content,
      d.created_at,
      d.properties->>'author_id' as author_id,
      u.name as author_name,
      u.email as author_email
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
    LEFT JOIN users u ON (d.properties->>'author_id')::uuid = u.id
    WHERE d.document_type = 'standup'
      AND d.workspace_id = $2
      AND ${visibilityPredicate('d', '$3', '$4')}
    ORDER BY d.created_at DESC
    LIMIT 5
  `, [sprintId, workspaceId, userId, isAdmin]);

  // Get issues assigned to this sprint via junction table
  const issuesResult = await pool.query<ClaudeIssueRow>(`
    SELECT
      d.id,
      d.title,
      d.properties->>'status' as status,
      d.properties->>'priority' as priority,
      d.properties->>'assignee_id' as assignee_id
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
    WHERE d.document_type = 'issue'
      AND d.workspace_id = $2
      AND ${visibilityPredicate('d', '$3', '$4')}
    ORDER BY
      CASE (d.properties->>'priority')
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END
  `, [sprintId, workspaceId, userId, isAdmin]);

  // Calculate issue stats
  const issueStats = {
    total: issuesResult.rows.length,
    completed: issuesResult.rows.filter(i => i.status === 'done').length,
    in_progress: issuesResult.rows.filter(i => i.status === 'in_progress').length,
    todo: issuesResult.rows.filter(i => i.status === 'todo' || i.status === 'backlog').length,
  };

  return {
    context_type: 'standup',
    sprint: extractClaudeSprintFromRow(sprint),
    program: extractClaudeProgramFromRow(sprint),
    project: extractClaudeProjectFromRow(sprint),
    recent_standups: standupsResult.rows.map(extractClaudeStandupFromRow),
    issues: {
      stats: issueStats,
      items: issuesResult.rows.slice(0, 10), // Top 10 issues
    },
    clarifying_questions_context: generateStandupQuestions(sprint, issueStats),
  };
}

/**
 * Get comprehensive context for sprint review
 */