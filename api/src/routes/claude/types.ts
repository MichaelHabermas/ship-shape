export type ClaudeSprintContextRow = {
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

export type ClaudeStandupRow = {
  id: string;
  title: string;
  content: unknown;
  created_at: Date;
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
};

export type ClaudeIssueRow = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  assignee_id?: string | null;
  added_mid_sprint?: string | null;
  cancelled?: string | null;
};

export type ClaudeReviewRow = {
  id: string;
  content: unknown;
  plan_validated: string | null;
  owner_id: string | null;
};

export type ClaudeProjectContextRow = {
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

export type ClaudeRetroSprintRow = {
  id: string;
  title: string;
  sprint_number: string | number | null;
  status: string | null;
  plan: string | null;
};

export type ClaudeSprintReviewDataRow = {
  sprint_id: string;
  content: unknown;
  plan_validated: string | null;
};

export type ClaudeRetroStandupRow = {
  sprint_id: string;
  content: unknown;
  author_name: string | null;
  created_at: Date;
};

export interface ClaudeContextRequest {
  context_type: 'standup' | 'review' | 'retro';
  sprint_id?: string;
  project_id?: string;
}

export interface StandupIssueStats {
  total: number;
  completed: number;
  in_progress: number;
  todo: number;
}

export interface ReviewIssueStats {
  total: number;
  completed: number;
  in_progress: number;
  planned_at_start: number;
  added_mid_sprint: number;
  cancelled: number;
}

export interface RetroIssueStats {
  total: number;
  completed: number;
  active: number;
  cancelled: number;
}