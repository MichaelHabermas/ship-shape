import type {
  ClaudeProjectContextRow,
  ClaudeRetroSprintRow,
  ClaudeSprintContextRow,
  ClaudeStandupRow,
  RetroIssueStats,
  ReviewIssueStats,
  StandupIssueStats,
} from './types.js';

export function generateStandupQuestions(sprint: ClaudeSprintContextRow, issueStats: StandupIssueStats) {
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
export function generateReviewQuestions(
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
export function generateRetroQuestions(
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
export function calculateICE(impact: string | null, confidence: string | null, ease: string | null): number | null {
  if (!impact || !confidence || !ease) return null;
  const i = parseFloat(impact);
  const c = parseFloat(confidence);
  const e = parseFloat(ease);
  if (isNaN(i) || isNaN(c) || isNaN(e)) return null;
  return i * c * e;
}
