/**
 * Claude Context API
 *
 * Provides comprehensive context for Claude skills when interviewing users
 * for standups, sprint reviews, and project retrospectives.
 *
 * This endpoint returns the full context chain:
 * - Program document (goals, description)
 * - Project document (plan, goals, ICE scores)
 * - Sprint details and progress
 * - Standup history
 * - Sprint reviews
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  getActor,
  getDocumentAccessContext,
  requireReadableDocument,
  visibilityPredicate,
  type DocumentActor,
} from '../services/document-access.js';
import { sendInternalError, sendLegacyError } from '../utils/route-http.js';

const router = Router();

type ClaudeSprintContextRow = {
  sprint_id: string;
  sprint_title: string;
  sprint_number: string | null;
  sprint_status: string | null;
  sprint_plan: string | null;
  program_id: string | null;
  program_name: string | null;
  program_content: unknown;
  program_description: string | null;
  program_goals: string | null;
  project_id: string | null;
  project_name: string | null;
  project_plan: string | null;
  ice_impact: string | null;
  ice_confidence: string | null;
  ice_ease: string | null;
  monetary_impact_expected: string | null;
};

type ClaudeStandupRow = {
  id: string;
  title: string;
  content: unknown;
  created_at: Date;
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
};

type ClaudeIssueRow = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  assignee_id?: string | null;
  added_mid_sprint?: string | null;
  cancelled?: string | null;
};

type ClaudeReviewRow = {
  id: string;
  content: unknown;
  plan_validated: string | null;
  owner_id: string | null;
};

type ClaudeProjectContextRow = {
  project_id: string;
  project_name: string;
  project_plan: string | null;
  project_content: unknown;
  ice_impact: string | null;
  ice_confidence: string | null;
  ice_ease: string | null;
  monetary_impact_expected: string | null;
  project_status: string | null;
  project_created_at: Date;
  program_id: string | null;
  program_name: string | null;
  program_description: string | null;
  program_goals: string | null;
  plan_validated: string | null;
  monetary_impact_actual: string | null;
  success_criteria: string | null;
  key_learnings: string | null;
};

type ClaudeRetroSprintRow = {
  id: string;
  title: string;
  sprint_number: string | number | null;
  status: string | null;
  plan: string | null;
};

type ClaudeSprintReviewDataRow = {
  sprint_id: string;
  content: unknown;
  plan_validated: string | null;
};

type ClaudeRetroStandupRow = {
  sprint_id: string;
  content: unknown;
  author_name: string | null;
  created_at: Date;
};

function extractClaudeProgramFromRow(row: ClaudeSprintContextRow | ClaudeProjectContextRow) {
  if (!row.program_id) return null;
  return {
    id: row.program_id,
    name: row.program_name,
    description: 'program_description' in row ? row.program_description : null,
    goals: 'program_goals' in row ? row.program_goals : null,
  };
}

function extractClaudeProjectFromRow(row: ClaudeSprintContextRow) {
  if (!row.project_id) return null;
  return {
    id: row.project_id,
    name: row.project_name,
    plan: row.project_plan,
    ice_scores: {
      impact: row.ice_impact,
      confidence: row.ice_confidence,
      ease: row.ice_ease,
    },
    monetary_impact_expected: row.monetary_impact_expected,
  };
}

function extractClaudeSprintFromRow(row: ClaudeSprintContextRow) {
  return {
    id: row.sprint_id,
    title: row.sprint_title,
    number: row.sprint_number,
    status: row.sprint_status,
    plan: row.sprint_plan,
  };
}

function extractClaudeStandupFromRow(row: ClaudeStandupRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    author: row.author_name || row.author_email,
    created_at: row.created_at,
  };
}

interface ClaudeContextRequest {
  context_type: 'standup' | 'review' | 'retro';
  sprint_id?: string;
  project_id?: string;
}

interface StandupIssueStats {
  total: number;
  completed: number;
  in_progress: number;
  todo: number;
}

interface ReviewIssueStats {
  total: number;
  completed: number;
  in_progress: number;
  planned_at_start: number;
  added_mid_sprint: number;
  cancelled: number;
}

interface RetroIssueStats {
  total: number;
  completed: number;
  active: number;
  cancelled: number;
}

/**
 * GET /api/claude/context
 *
 * Query params:
 * - context_type: 'standup' | 'review' | 'retro'
 * - sprint_id: Sprint ID (required for standup/review)
 * - project_id: Project ID (required for retro)
 *
 * Returns comprehensive context for Claude to ask intelligent questions.
 */
router.get('/context', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { context_type, sprint_id, project_id } = req.query as unknown as ClaudeContextRequest;
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    if (!actor.workspaceId) {
      res.status(401).json({ error: 'No workspace selected' });
      return;
    }

    if (!context_type) {
      sendLegacyError(res, 400, 'context_type is required');
      return;
    }

    let context: Record<string, unknown> = {};

    try {
      switch (context_type) {
        case 'standup':
          if (!sprint_id) {
            sendLegacyError(res, 400, 'sprint_id is required for standup context');
            return;
          }
          await requireReadableDocument(pool, actor, sprint_id, 'sprint');
          context = await getStandupContext(sprint_id, actor, isAdmin);
          break;

        case 'review':
          if (!sprint_id) {
            sendLegacyError(res, 400, 'sprint_id is required for review context');
            return;
          }
          await requireReadableDocument(pool, actor, sprint_id, 'sprint');
          context = await getReviewContext(sprint_id, actor, isAdmin);
          break;

        case 'retro':
          if (!project_id) {
            sendLegacyError(res, 400, 'project_id is required for retro context');
            return;
          }
          await requireReadableDocument(pool, actor, project_id, 'project');
          context = await getRetroContext(project_id, actor, isAdmin);
          break;

        default:
          sendLegacyError(res, 400, 'Invalid context_type');
          return;
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'DOCUMENT_NOT_READABLE') {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      throw error;
    }

    res.json(context);
  } catch (error) {
    sendInternalError(res, error, 'Error fetching Claude context:', { error: 'Failed to fetch context' });
  }
});

/**
 * Get comprehensive context for standup entry
 */
async function getStandupContext(sprintId: string, actor: DocumentActor, isAdmin: boolean) {
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
async function getReviewContext(sprintId: string, actor: DocumentActor, isAdmin: boolean) {
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

  // Get ALL standups for this sprint (for review we want the full history) via junction table
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
  `, [sprintId, workspaceId, userId, isAdmin]);

  // Get issues with scope change tracking via junction table
  const issuesResult = await pool.query<ClaudeIssueRow>(`
    SELECT
      d.id,
      d.title,
      d.properties->>'status' as status,
      d.properties->>'priority' as priority,
      d.properties->>'added_mid_sprint' as added_mid_sprint,
      d.properties->>'cancelled' as cancelled
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
    WHERE d.document_type = 'issue'
      AND d.workspace_id = $2
      AND ${visibilityPredicate('d', '$3', '$4')}
  `, [sprintId, workspaceId, userId, isAdmin]);

  // Calculate detailed issue stats
  const issueStats = {
    total: issuesResult.rows.length,
    completed: issuesResult.rows.filter(i => i.status === 'done').length,
    in_progress: issuesResult.rows.filter(i => i.status === 'in_progress').length,
    planned_at_start: issuesResult.rows.filter(i => i.added_mid_sprint !== 'true').length,
    added_mid_sprint: issuesResult.rows.filter(i => i.added_mid_sprint === 'true').length,
    cancelled: issuesResult.rows.filter(i => i.cancelled === 'true').length,
  };

  // Get existing review if any via junction table
  const reviewResult = await pool.query<ClaudeReviewRow>(`
    SELECT
      d.id,
      d.content,
      d.properties->>'plan_validated' as plan_validated,
      d.properties->>'owner_id' as owner_id
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
    WHERE d.document_type = 'weekly_review'
      AND d.workspace_id = $2
      AND ${visibilityPredicate('d', '$3', '$4')}
    LIMIT 1
  `, [sprintId, workspaceId, userId, isAdmin]);

  const existingReview = reviewResult.rows[0] || null;

  return {
    context_type: 'review',
    sprint: extractClaudeSprintFromRow(sprint),
    program: extractClaudeProgramFromRow(sprint),
    project: extractClaudeProjectFromRow(sprint),
    standups: standupsResult.rows.map(extractClaudeStandupFromRow),
    issues: {
      stats: issueStats,
      completed_items: issuesResult.rows.filter(i => i.status === 'done'),
      incomplete_items: issuesResult.rows.filter(i => i.status !== 'done' && i.cancelled !== 'true'),
    },
    existing_review: existingReview,
    clarifying_questions_context: generateReviewQuestions(sprint, issueStats, standupsResult.rows),
  };
}

/**
 * Get comprehensive context for project retrospective
 */
async function getRetroContext(projectId: string, actor: DocumentActor, isAdmin: boolean) {
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

/**
 * Generate context-aware clarifying questions for standup
 */
function generateStandupQuestions(sprint: ClaudeSprintContextRow, issueStats: StandupIssueStats) {
  const questions: string[] = [];

  // Plan-related questions
  if (sprint.sprint_plan) {
    questions.push(`How does today's work relate to the sprint plan: "${sprint.sprint_plan}"?`);
  }

  // Progress questions
  if (issueStats.in_progress > 0) {
    questions.push(`You have ${issueStats.in_progress} issues in progress. What's the status of each?`);
  }

  // Plan alignment
  if (sprint.sprint_plan) {
    questions.push(`Are you making progress toward validating the sprint plan: "${sprint.sprint_plan}"?`);
  }

  // Blockers
  questions.push('Are there any blockers preventing progress on your issues?');
  questions.push('Do you need help from anyone to complete your current work?');

  return questions;
}

/**
 * Generate context-aware clarifying questions for sprint review
 */
function generateReviewQuestions(
  sprint: ClaudeSprintContextRow,
  issueStats: ReviewIssueStats,
  standups: ClaudeStandupRow[]
) {
  const questions: string[] = [];

  // Plan validation
  if (sprint.sprint_plan) {
    questions.push(`The sprint plan was: "${sprint.sprint_plan}". Was this validated or invalidated?`);
    questions.push('What evidence supports your conclusion about the plan?');
  }

  // Completion rate
  const completionRate = issueStats.total > 0
    ? Math.round((issueStats.completed / issueStats.total) * 100)
    : 0;

  if (completionRate < 100) {
    questions.push(`Only ${completionRate}% of issues were completed. What prevented full completion?`);
  }

  // Mid-sprint additions
  if (issueStats.added_mid_sprint > 0) {
    questions.push(`${issueStats.added_mid_sprint} issues were added mid-sprint. Why were they added and how did they affect the original plan?`);
  }

  // Standups analysis
  if (standups.length > 0) {
    questions.push('Looking at the standup history, what were the main themes or patterns?');
  }

  // Lessons learned
  questions.push('What would you do differently next sprint?');
  questions.push('What worked well that should be repeated?');

  return questions;
}

/**
 * Generate context-aware clarifying questions for project retro
 */
function generateRetroQuestions(
  project: ClaudeProjectContextRow,
  sprints: Array<ClaudeRetroSprintRow & { plan_validated?: string | null; has_review: boolean }>,
  issueStats: RetroIssueStats
) {
  const questions: string[] = [];

  // Project plan validation
  if (project.project_plan) {
    questions.push(`The project plan was: "${project.project_plan}". Was this validated or invalidated?`);
    questions.push('What evidence from the sprints supports this conclusion?');
  }

  // Monetary impact
  if (project.monetary_impact_expected) {
    questions.push(`Expected monetary impact was: ${project.monetary_impact_expected}. What was the actual impact?`);
    questions.push('How did you measure this impact?');
  }

  // Sprint pattern analysis
  const validatedSprints = sprints.filter((s: Record<string, unknown>) => s.plan_validated === 'true').length;
  const invalidatedSprints = sprints.filter((s: Record<string, unknown>) => s.plan_validated === 'false').length;

  if (sprints.length > 1) {
    questions.push(`Of ${sprints.length} sprints, ${validatedSprints} plans were validated and ${invalidatedSprints} were invalidated. What patterns do you see?`);
  }

  // Completion analysis
  const completionRate = issueStats.total > 0
    ? Math.round((issueStats.completed / issueStats.total) * 100)
    : 0;
  questions.push(`${completionRate}% of project issues were completed. Was this sufficient to validate the plan?`);

  // Key learnings
  questions.push('What were the most important things the team learned from this project?');
  questions.push('What recommendations do you have for future similar projects?');

  return questions;
}

/**
 * Calculate ICE score total
 */
function calculateICE(impact: string | null, confidence: string | null, ease: string | null): number | null {
  if (!impact || !confidence || !ease) return null;
  const i = parseFloat(impact);
  const c = parseFloat(confidence);
  const e = parseFloat(ease);
  if (isNaN(i) || isNaN(c) || isNaN(e)) return null;
  return i * c * e;
}

export default router;
