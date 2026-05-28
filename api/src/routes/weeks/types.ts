import type { CanonicalWeekProperties, SprintRouteProperties } from '@ship/shared';

export type { CanonicalWeekProperties, SprintRouteProperties };

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

export type IdRow = { id: string };

export type WorkspaceSprintStartRow = {
  sprint_start_date: Date | string | null;
};

export type SprintIssueIdRow = { id: string };

export type UserIdRow = { id: string };

export type MaxSprintNumberRow = {
  max_sprint: number | string | null;
};

export type WorkspaceMemberUserRow = {
  id: string;
  name: string;
  email: string;
};

export type SprintExistsRow = {
  id: string;
  properties?: SprintRouteProperties | null;
  program_id?: string | null;
  sprint_start_date?: Date | string | null;
};

export type ProgramExistsRow = { id: string };

export type SprintPrefixRow = {
  id: string;
  prefix: string | null;
};

export type SprintScopeInfoRow = {
  id: string;
  sprint_number: string | number | null;
  workspace_sprint_start_date: Date | string | null;
};

export type SprintIssueEstimateRow = {
  id: string;
  estimate: string | number | null;
};

export type SprintHistoryRow = {
  document_id: string;
  created_at: Date;
  old_value: string | null;
  new_value: string | null;
};

export type SprintTitleRow = {
  id: string;
  title: string;
};

export type SprintReviewSprintRow = {
  id: string;
  title: string;
  properties: SprintRouteProperties | null;
  program_id: string | null;
  program_name: string | null;
};

export type SprintReviewDocumentRow = {
  id: string;
  title: string;
  content: unknown;
  properties: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  owner_name: string | null;
  owner_email: string | null;
};

export type WeeklyPlanContentRow = { content: unknown };

export type SprintReviewInsertRow = {
  id: string;
  title: string;
  content: unknown;
  properties: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

export type UserNameEmailRow = {
  name: string;
  email: string;
};

export type SprintPropertiesOnlyRow = {
  properties: SprintRouteProperties | null;
};

export type SprintCarryoverSprintRow = {
  id: string;
  title: string;
  properties: SprintRouteProperties | null;
};

export type SprintIssueListRow = {
  id: string;
  title: string;
  properties: {
    state?: string;
    priority?: string;
    assignee_id?: string | null;
    estimate?: number | null;
    carryover_from_sprint_id?: string | null;
  } | null;
  ticket_number: number | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  assignee_name: string | null;
  assignee_archived: boolean | 't' | 'f' | null;
};
