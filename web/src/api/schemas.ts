// API schema aliases expose generated OpenAPI component types to the web client.
import type { components } from './generated/ship-openapi';

export type Document = components['schemas']['Document'];
export type Standup = components['schemas']['Standup'];
export type UpdatedStandup = components['schemas']['UpdatedStandup'];
export type StandupStatus = components['schemas']['StandupStatus'];
export type MentionSearchResult = components['schemas']['MentionSearchResult'];
export type DocumentSearchResponse = components['schemas']['DocumentSearchResponse'];

export type IssueListItem = components['schemas']['IssueListItem'];
export type Issue = components['schemas']['Issue'];
export type BulkUpdatedIssue = components['schemas']['BulkUpdatedIssue'];
export type BulkUpdateIssuesResponse = components['schemas']['BulkUpdateIssuesResponse'];
export type Project = components['schemas']['Project'];
export type ProjectIssueListItem = components['schemas']['ProjectIssueListItem'];
export type ProjectWeekListItem = components['schemas']['ProjectWeekListItem'];
export type Program = components['schemas']['Program'];
export type UserReference = components['schemas']['UserReference'];
export type Week = components['schemas']['Week'];
export type ProgramSprintListItem = components['schemas']['ProgramSprintListItem'];
export type ProgramSprintsResponse = components['schemas']['ProgramSprintsResponse'];
export type ActiveWeekItem = components['schemas']['ActiveWeekItem'];
export type ActiveWeeksResponse = components['schemas']['ActiveWeeksResponse'];

export type MyWeekResponse = components['schemas']['MyWeekResponse'];
export type StandupSlot = components['schemas']['StandupSlot'];
export type WeekProject = components['schemas']['WeekProject'];
export type TeamAssignment = components['schemas']['TeamAssignment'];
export type TeamAssignmentError = components['schemas']['TeamAssignmentError'];
export type TeamAssignmentsResponse = components['schemas']['TeamAssignmentsResponse'];
export type TeamAssignResponse = components['schemas']['TeamAssignResponse'];
export type TeamGridResponse = components['schemas']['TeamGridResponse'];
export type TeamUnassignResponse = components['schemas']['TeamUnassignResponse'];
export type ReviewCell = components['schemas']['ReviewCell'];
export type ReviewsResponse = components['schemas']['ReviewsResponse'];
export type SprintPeriod = components['schemas']['SprintPeriod'];
export type ApprovalTracking = components['schemas']['ApprovalTracking'];
export type ApprovalState = ApprovalTracking['state'];

/** Issue row from GET /weeks/:id/issues (sprint issue list). */
export interface WeekSprintIssue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  display_id: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_archived?: boolean;
  estimate: number | null;
  carryover_from_sprint_id?: string | null;
  carryover_from_sprint_name?: string | null;
}

export type WeekDetail = Pick<
  Week,
  | 'id'
  | 'name'
  | 'sprint_number'
  | 'workspace_sprint_start_date'
  | 'owner'
  | 'issue_count'
  | 'completed_count'
  | 'plan'
>;

export interface SetupStatusData {
  needsSetup: boolean;
}

export interface AuthProviderStatusData {
  available: boolean;
}

export interface AuthProviderLoginData {
  authorizationUrl: string;
}

export interface AiStatusResponse {
  available: boolean;
  error?: string;
}

export interface CsrfTokenResponse {
  token: string;
}

export interface LegacyErrorResponse {
  error?: string;
}
