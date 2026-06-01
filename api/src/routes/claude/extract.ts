import type {
  ClaudeProjectContextRow,
  ClaudeSprintContextRow,
  ClaudeStandupRow,
} from './types.js';

export function extractClaudeProgramFromRow(row: ClaudeSprintContextRow | ClaudeProjectContextRow) {
  if (!row.program_id) return null;
  return {
    id: row.program_id,
    name: row.program_name,
    description: 'program_description' in row ? row.program_description : null,
    goals: 'program_goals' in row ? row.program_goals : null,
  };
}

export function extractClaudeProjectFromRow(row: ClaudeSprintContextRow) {
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

export function extractClaudeSprintFromRow(row: ClaudeSprintContextRow) {
  return {
    id: row.sprint_id,
    title: row.sprint_title,
    number: row.sprint_number,
    status: row.sprint_status,
    plan: row.sprint_plan,
  };
}

export function extractClaudeStandupFromRow(row: ClaudeStandupRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    author: row.author_name || row.author_email,
    created_at: row.created_at,
  };
}
