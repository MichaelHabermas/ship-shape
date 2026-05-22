import type { WeekProperties } from '@ship/shared';

export type CanonicalWeekProperties = Partial<Pick<WeekProperties, 'sprint_number' | 'owner_id'>> & {
  owner_id?: string | null;
};

export type SprintRouteProperties = CanonicalWeekProperties & {
  status?: string;
  plan?: string | null;
  success_criteria?: string[] | null;
  confidence?: number | null;
  plan_history?: unknown;
  is_complete?: boolean | null;
  missing_fields?: string[];
  planned_issue_ids?: string[] | null;
  snapshot_taken_at?: string | null;
  plan_approval?: unknown;
  review_approval?: unknown;
  review_rating?: string | null;
  accountable_id?: string | null;
};

export type SprintRow = {
  id: string;
  title: string;
  properties: SprintRouteProperties | null;
  owner_id?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  program_id?: string | null;
  program_name?: string | null;
  program_prefix?: string | null;
  program_accountable_id?: string | null;
  owner_reports_to?: string | null;
  workspace_sprint_start_date?: Date | string | null;
  issue_count?: string | number | null;
  completed_count?: string | number | null;
  started_count?: string | number | null;
  has_plan?: boolean | 't' | 'f' | null;
  has_retro?: boolean | 't' | 'f' | null;
  retro_outcome?: string | null;
  retro_id?: string | null;
};

export type StandupRow = {
  id: string;
  parent_id: string;
  title: string;
  content: unknown;
  author_id: string | null;
  author_name: string | null;
  author_email: string | null;
  created_at: Date;
  updated_at: Date;
};

export type SprintActionItemRow = {
  id: string;
  title: string;
  program_id: string | null;
  program_name: string | null;
  sprint_number: number | string;
  has_plan: boolean | 't' | 'f' | null;
  has_retro: boolean | 't' | 'f' | null;
};

export type MyWeekIssueRow = {
  issue_id: string;
  issue_title: string;
  issue_properties: {
    state?: string;
    priority?: string;
    assignee_id?: string | null;
    estimate?: number | null;
  } | null;
  ticket_number: number | null;
  issue_created_at: Date;
  issue_updated_at: Date;
  sprint_id: string;
  sprint_name: string;
  sprint_properties: CanonicalWeekProperties | null;
  program_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  assignee_name: string | null;
  assignee_archived: boolean | null;
};

export type MyWeekIssue = {
  id: string;
  title: string;
  state: string;
  priority: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_archived: boolean;
  estimate: number | null;
  ticket_number: number | null;
  display_id: string;
  created_at: Date;
  updated_at: Date;
};

export type PersonLookupRow = {
  id: string;
  title: string;
};

export type SprintLookupRow = {
  id: string;
  properties: SprintRouteProperties | null;
};

export type SprintInsertRow = {
  id: string;
  title: string;
  properties: SprintRouteProperties | null;
};

export type TipTapJsonContent = {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: TipTapJsonContent[];
};

export type TipTapJsonDoc = TipTapJsonContent & {
  content: TipTapJsonContent[];
};

export type SprintReviewSprintData = {
  sprint_number: number;
  program_name: string | null;
  plan: string | null;
};

export type SprintReviewIssueProperties = {
  state?: string | null;
  carryover_from_sprint_id?: string | null;
};

export type SprintReviewIssueRow = {
  id: string;
  title: string;
  properties: SprintReviewIssueProperties | null;
  ticket_number: number | null;
};
