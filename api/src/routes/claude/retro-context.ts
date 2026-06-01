import { pool } from '../../db/client.js';
import { visibilityPredicate, type DocumentActor } from '../../services/document-access.js';
import {
  generateRetroQuestions,
  calculateICE,
} from './prompt-questions.js';
import type {
  ClaudeIssueRow,
  ClaudeProjectContextRow,
  ClaudeRetroSprintRow,
  ClaudeSprintReviewDataRow,
  ClaudeRetroStandupRow,
} from './types.js';
export async function getRetroContext(projectId: string, actor: DocumentActor, isAdmin: boolean) {
  const { workspaceId, userId } = actor;

  // Get project with program info via junction table
  const projectResult = await pool.query<ClaudeProjectContextRow>(`
    SELECT
      proj.id as project_id,
      proj.title as project_name,
      proj.content as project_content,
      proj.properties->>'plan' as project_plan,
      proj.properties->>'ice_impact' as ice_impact,
      proj.properties->>'ice_confidence' as ice_confidence,
      proj.properties->>'ice_ease' as ice_ease,
      proj.properties->>'monetary_impact' as monetary_impact_expected,
      proj.properties->>'status' as project_status,
      proj.created_at as project_created_at,
      proj.properties->>'plan_validated' as plan_validated,
      proj.properties->>'monetary_impact_actual' as monetary_impact_actual,
      proj.properties->>'success_criteria' as success_criteria,
      proj.properties->>'key_learnings' as key_learnings,
      da_prog.related_id as program_id,
      p.title as program_name,
      p.properties->>'description' as program_description,
      p.properties->>'goals' as program_goals
    FROM documents proj
    LEFT JOIN document_associations da_prog ON da_prog.document_id = proj.id AND da_prog.relationship_type = 'program'
    LEFT JOIN documents p ON da_prog.related_id = p.id AND p.document_type = 'program'
    WHERE proj.id = $1
      AND proj.document_type = 'project'
      AND proj.workspace_id = $2
      AND ${visibilityPredicate('proj', '$3', '$4')}
  `, [projectId, workspaceId, userId, isAdmin]);

  if (projectResult.rows.length === 0) {
    throw new Error('Project not found');
  }

  const project = projectResult.rows[0];
  if (!project) {
    throw new Error('Project not found');
  }

  // Get all sprints for this project via junction table
  // Note: dates computed from sprint_number + workspace.sprint_start_date
  const sprintsResult = await pool.query<ClaudeRetroSprintRow>(`
    SELECT
      d.id,
      d.title,
      d.properties->>'sprint_number' as sprint_number,
      d.properties->>'status' as status,
      d.properties->>'plan' as plan
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
    WHERE d.document_type = 'sprint'
      AND d.workspace_id = $2
      AND ${visibilityPredicate('d', '$3', '$4')}
    ORDER BY (d.properties->>'sprint_number')::int
  `, [projectId, workspaceId, userId, isAdmin]);

  // Get all sprint reviews for this project's sprints via junction table
  const sprintIds = sprintsResult.rows.map(s => s.id);
  let reviewsData: ClaudeSprintReviewDataRow[] = [];

  if (sprintIds.length > 0) {
    const reviewsResult = await pool.query<ClaudeSprintReviewDataRow>(`
      SELECT
        da.related_id as sprint_id,
        d.content,
        d.properties->>'plan_validated' as plan_validated
      FROM documents d
      JOIN document_associations da ON da.document_id = d.id AND da.relationship_type = 'sprint'
      WHERE da.related_id = ANY($1)
        AND d.document_type = 'weekly_review'
        AND d.workspace_id = $2
        AND ${visibilityPredicate('d', '$3', '$4')}
    `, [sprintIds, workspaceId, userId, isAdmin]);
    reviewsData = reviewsResult.rows;
  }

  // Get all standups across all sprints via junction table
  let standupsData: ClaudeRetroStandupRow[] = [];
  if (sprintIds.length > 0) {
    const standupsResult = await pool.query<ClaudeRetroStandupRow>(`
      SELECT
        da.related_id as sprint_id,
        d.content,
        u.name as author_name,
        d.created_at
      FROM documents d
      JOIN document_associations da ON da.document_id = d.id AND da.relationship_type = 'sprint'
      LEFT JOIN users u ON (d.properties->>'author_id')::uuid = u.id
      WHERE da.related_id = ANY($1)
        AND d.document_type = 'standup'
        AND d.workspace_id = $2
        AND ${visibilityPredicate('d', '$3', '$4')}
      ORDER BY d.created_at DESC
      LIMIT 20
    `, [sprintIds, workspaceId, userId, isAdmin]);
    standupsData = standupsResult.rows;
  }

  // Get all issues for this project via junction table
  const issuesResult = await pool.query<ClaudeIssueRow>(`
    SELECT
      d.id,
      d.title,
      d.properties->>'status' as status,
      d.properties->>'priority' as priority
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
    WHERE d.document_type = 'issue'
      AND d.workspace_id = $2
      AND ${visibilityPredicate('d', '$3', '$4')}
  `, [projectId, workspaceId, userId, isAdmin]);

  // Calculate project-level stats
  const issueStats = {
    total: issuesResult.rows.length,
    completed: issuesResult.rows.filter(i => i.status === 'done').length,
    active: issuesResult.rows.filter(i => i.status != null && ['in_progress', 'todo'].includes(i.status)).length,
    cancelled: issuesResult.rows.filter(i => i.status === 'cancelled').length,
  };

  const existingRetro = project.plan_validated != null
    ? {
        id: project.project_id,
        content: project.project_content,
        plan_validated: project.plan_validated,
        monetary_impact_actual: project.monetary_impact_actual,
        success_criteria: project.success_criteria,
        key_learnings: project.key_learnings,
      }
    : null;

  // Calculate sprint outcomes
  const sprintOutcomes = sprintsResult.rows.map(sprint => {
    const review = reviewsData.find(r => r.sprint_id === sprint.id);
    return {
      ...sprint,
      plan_validated: review?.plan_validated,
      has_review: !!review,
    };
  });

  return {
    context_type: 'retro',
    project: {
      id: project.project_id,
      name: project.project_name,
      plan: project.project_plan,
      ice_scores: {
        impact: project.ice_impact,
        confidence: project.ice_confidence,
        ease: project.ice_ease,
        total: calculateICE(project.ice_impact, project.ice_confidence, project.ice_ease),
      },
      monetary_impact_expected: project.monetary_impact_expected,
      status: project.project_status,
      created_at: project.project_created_at,
    },
    program: project.program_id ? {
      id: project.program_id,
      name: project.program_name,
      description: project.program_description,
      goals: project.program_goals,
    } : null,
    weeks: sprintOutcomes,
    sprint_reviews: reviewsData.map(r => ({
      sprint_id: r.sprint_id,
      plan_validated: r.plan_validated,
      content: r.content,
    })),
    recent_standups: standupsData.map(s => ({
      sprint_id: s.sprint_id,
      content: s.content,
      author: s.author_name,
      created_at: s.created_at,
    })),
    issues: {
      stats: issueStats,
    },
    existing_retro: existingRetro,
    clarifying_questions_context: generateRetroQuestions(project, sprintOutcomes, issueStats),
  };
}