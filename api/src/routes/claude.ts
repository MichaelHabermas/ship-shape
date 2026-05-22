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
import { sendInternalError, sendLegacyError } from '../utils/route-http.js';

const router = Router();

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
    const workspaceId = req.workspaceId;

    if (!workspaceId) {
      res.status(401).json({ error: 'No workspace selected' });
      return;
    }

    if (!context_type) {
      sendLegacyError(res, 400, 'context_type is required');
      return;
    }

    let context: Record<string, unknown> = {};

    switch (context_type) {
      case 'standup':
        if (!sprint_id) {
          sendLegacyError(res, 400, 'sprint_id is required for standup context');
          return;
        }
        context = await getStandupContext(sprint_id, workspaceId);
        break;

      case 'review':
        if (!sprint_id) {
          sendLegacyError(res, 400, 'sprint_id is required for review context');
          return;
        }
        context = await getReviewContext(sprint_id, workspaceId);
        break;

      case 'retro':
        if (!project_id) {
          sendLegacyError(res, 400, 'project_id is required for retro context');
          return;
        }
        context = await getRetroContext(project_id, workspaceId);
        break;

      default:
        sendLegacyError(res, 400, 'Invalid context_type');
        return;
    }

    res.json(context);
  } catch (error) {
    sendInternalError(res, error, 'Error fetching Claude context:', { error: 'Failed to fetch context' });
  }
});

/**
 * Get comprehensive context for standup entry
 */
async function getStandupContext(sprintId: string, workspaceId: string) {
  // Get sprint with program and project info via junction table
  const sprintResult = await pool.query(`
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
  `, [sprintId, workspaceId]);

  if (sprintResult.rows.length === 0) {
    throw new Error('Week not found');
  }

  const sprint = sprintResult.rows[0];

  // Get recent standups for this sprint (last 5) via junction table
  const standupsResult = await pool.query(`
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
    ORDER BY d.created_at DESC
    LIMIT 5
  `, [sprintId, workspaceId]);

  // Get issues assigned to this sprint via junction table
  const issuesResult = await pool.query(`
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
    ORDER BY
      CASE (d.properties->>'priority')
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END
  `, [sprintId, workspaceId]);

  // Calculate issue stats
  const issueStats = {
    total: issuesResult.rows.length,
    completed: issuesResult.rows.filter(i => i.status === 'done').length,
    in_progress: issuesResult.rows.filter(i => i.status === 'in_progress').length,
    todo: issuesResult.rows.filter(i => i.status === 'todo' || i.status === 'backlog').length,
  };

  return {
    context_type: 'standup',
    sprint: {
      id: sprint.sprint_id,
      title: sprint.sprint_title,
      number: sprint.sprint_number,
      status: sprint.sprint_status,
      plan: sprint.sprint_plan,
    },
    program: sprint.program_id ? {
      id: sprint.program_id,
      name: sprint.program_name,
      description: sprint.program_description,
      goals: sprint.program_goals,
    } : null,
    project: sprint.project_id ? {
      id: sprint.project_id,
      name: sprint.project_name,
      plan: sprint.project_plan,
      ice_scores: {
        impact: sprint.ice_impact,
        confidence: sprint.ice_confidence,
        ease: sprint.ice_ease,
      },
      monetary_impact_expected: sprint.monetary_impact_expected,
    } : null,
    recent_standups: standupsResult.rows.map(s => ({
      id: s.id,
      title: s.title,
      content: s.content,
      author: s.author_name || s.author_email,
      created_at: s.created_at,
    })),
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
async function getReviewContext(sprintId: string, workspaceId: string) {
  // Get sprint with program and project info via junction table
  const sprintResult = await pool.query(`
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
  `, [sprintId, workspaceId]);

  if (sprintResult.rows.length === 0) {
    throw new Error('Week not found');
  }

  const sprint = sprintResult.rows[0];

  // Get ALL standups for this sprint (for review we want the full history) via junction table
  const standupsResult = await pool.query(`
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
    ORDER BY d.created_at DESC
  `, [sprintId, workspaceId]);

  // Get issues with scope change tracking via junction table
  const issuesResult = await pool.query(`
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
  `, [sprintId, workspaceId]);

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
  const reviewResult = await pool.query(`
    SELECT
      d.id,
      d.content,
      d.properties->>'plan_validated' as plan_validated,
      d.properties->>'owner_id' as owner_id
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'sprint'
    WHERE d.document_type = 'weekly_review'
      AND d.workspace_id = $2
    LIMIT 1
  `, [sprintId, workspaceId]);

  const existingReview = reviewResult.rows[0] || null;

  return {
    context_type: 'review',
    sprint: {
      id: sprint.sprint_id,
      title: sprint.sprint_title,
      number: sprint.sprint_number,
      status: sprint.sprint_status,
      plan: sprint.sprint_plan,
    },
    program: sprint.program_id ? {
      id: sprint.program_id,
      name: sprint.program_name,
      description: sprint.program_description,
      goals: sprint.program_goals,
    } : null,
    project: sprint.project_id ? {
      id: sprint.project_id,
      name: sprint.project_name,
      plan: sprint.project_plan,
      ice_scores: {
        impact: sprint.ice_impact,
        confidence: sprint.ice_confidence,
        ease: sprint.ice_ease,
      },
      monetary_impact_expected: sprint.monetary_impact_expected,
    } : null,
    standups: standupsResult.rows.map(s => ({
      id: s.id,
      title: s.title,
      content: s.content,
      author: s.author_name || s.author_email,
      created_at: s.created_at,
    })),
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
async function getRetroContext(projectId: string, workspaceId: string) {
  // Get project with program info via junction table
  const projectResult = await pool.query(`
    SELECT
      proj.id as project_id,
      proj.title as project_name,
      proj.properties->>'plan' as project_plan,
      proj.properties->>'ice_impact' as ice_impact,
      proj.properties->>'ice_confidence' as ice_confidence,
      proj.properties->>'ice_ease' as ice_ease,
      proj.properties->>'monetary_impact' as monetary_impact_expected,
      proj.properties->>'status' as project_status,
      proj.created_at as project_created_at,
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
  `, [projectId, workspaceId]);

  if (projectResult.rows.length === 0) {
    throw new Error('Project not found');
  }

  const project = projectResult.rows[0];

  // Get all sprints for this project via junction table
  // Note: dates computed from sprint_number + workspace.sprint_start_date
  const sprintsResult = await pool.query(`
    SELECT
      d.id,
      d.title,
      d.sprint_number,
      d.properties->>'status' as status,
      d.properties->>'plan' as plan
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
    WHERE d.document_type = 'sprint'
      AND d.workspace_id = $2
    ORDER BY d.sprint_number
  `, [projectId, workspaceId]);

  // Get all sprint reviews for this project's sprints via junction table
  const sprintIds = sprintsResult.rows.map(s => s.id);
  let reviewsData: Array<{sprint_id: string; content: unknown; plan_validated: string}> = [];

  if (sprintIds.length > 0) {
    const reviewsResult = await pool.query(`
      SELECT
        da.related_id as sprint_id,
        d.content,
        d.properties->>'plan_validated' as plan_validated
      FROM documents d
      JOIN document_associations da ON da.document_id = d.id AND da.relationship_type = 'sprint'
      WHERE da.related_id = ANY($1)
        AND d.document_type = 'weekly_review'
        AND d.workspace_id = $2
    `, [sprintIds, workspaceId]);
    reviewsData = reviewsResult.rows;
  }

  // Get all standups across all sprints via junction table
  let standupsData: Array<{sprint_id: string; content: unknown; author_name: string; created_at: Date}> = [];
  if (sprintIds.length > 0) {
    const standupsResult = await pool.query(`
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
      ORDER BY d.created_at DESC
      LIMIT 20
    `, [sprintIds, workspaceId]);
    standupsData = standupsResult.rows;
  }

  // Get all issues for this project via junction table
  const issuesResult = await pool.query(`
    SELECT
      d.id,
      d.title,
      d.properties->>'status' as status,
      d.properties->>'priority' as priority
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
    WHERE d.document_type = 'issue'
      AND d.workspace_id = $2
  `, [projectId, workspaceId]);

  // Calculate project-level stats
  const issueStats = {
    total: issuesResult.rows.length,
    completed: issuesResult.rows.filter(i => i.status === 'done').length,
    active: issuesResult.rows.filter(i => ['in_progress', 'todo'].includes(i.status)).length,
    cancelled: issuesResult.rows.filter(i => i.status === 'cancelled').length,
  };

  // Get existing retro if any via junction table
  const retroResult = await pool.query(`
    SELECT
      d.id,
      d.content,
      d.properties->>'plan_validated' as plan_validated,
      d.properties->>'monetary_impact_actual' as monetary_impact_actual,
      d.properties->>'success_criteria' as success_criteria,
      d.properties->>'key_learnings' as key_learnings
    FROM documents d
    JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
    WHERE d.document_type = 'project_retro'
      AND d.workspace_id = $2
    LIMIT 1
  `, [projectId, workspaceId]);

  const existingRetro = retroResult.rows[0] || null;

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
function generateStandupQuestions(sprint: Record<string, unknown>, issueStats: StandupIssueStats) {
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
  sprint: Record<string, unknown>,
  issueStats: ReviewIssueStats,
  standups: Array<Record<string, unknown>>
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
  project: Record<string, unknown>,
  sprints: Array<Record<string, unknown>>,
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
