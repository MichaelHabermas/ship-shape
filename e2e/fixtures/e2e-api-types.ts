// Shared Playwright API response shapes for E2E JSON parsing (no-unsafe-call).

export type ApiId = { id: string };

export type CsrfTokenResponse = { token: string };

export type SimpleErrorBody = { error: string };

export type ApiErrorEnvelope = { error: { code?: string; message?: string } };

export type ApiDocument = ApiId;

export type ApiDocumentWithVisibility = ApiId & {
  title?: string;
  visibility?: string;
};

export type PersonDocument = ApiId & {
  properties?: { user_id?: string };
};

export type IssueCreateResponse = ApiId & { ticket_number?: number };

export type WeekWithId = { id: string };

export type WeeksWithIdListResponse = { weeks: WeekWithId[] };

export type WeeklyDocumentProperties = {
  person_id: string;
  project_id: string;
  week_number: number;
  sprint_number?: number;
  submitted_at: string | null;
};

export type WeeklyPlanDocument = ApiId & {
  document_type: 'weekly_plan';
  title: string;
  properties: WeeklyDocumentProperties;
};

export type WeeklyRetroDocument = ApiId & {
  document_type: 'weekly_retro';
  title: string;
  properties: WeeklyDocumentProperties;
};

export type WeeklyPlansListResponse = { plans: WeeklyPlanDocument[] };

export type WeeklyRetrosListResponse = { retros: WeeklyRetroDocument[] };

export type TeamReviewPerson = {
  personId: string;
  name?: string;
  programId?: string | null;
  programName?: string | null;
  programColor?: string | null;
};

export type ApprovalTracking = {
  state?: string;
  feedback?: string;
  comment?: string;
  approved_at?: string;
};

export type ReviewRating = {
  value?: number;
};

export type WeekSprintResponse = {
  id?: string;
  plan_approval?: ApprovalTracking | null;
  review_approval?: ApprovalTracking | null;
  review_rating?: ReviewRating | null;
};

export type ApproveReviewResponse = {
  success?: boolean;
  approval?: ApprovalTracking;
  review_rating?: ReviewRating;
};

export type RequestChangesResponse = {
  success?: boolean;
  approval?: ApprovalTracking;
};

export type TeamReviewWeek = {
  number: number;
  name?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
};

export type TeamReviewsResponse = {
  people: TeamReviewPerson[];
  weeks: TeamReviewWeek[];
  reviews?: Record<string, Record<string, unknown>>;
  currentSprintNumber?: number;
  projectId?: string;
  projectTitle?: string;
};

export type MentionSearchFullResponse = {
  people: Array<{ id?: string; name?: string }>;
  documents: Array<{ id: string; title: string; document_type: string }>;
};

export type SearchDocumentsResponse = {
  results?: Array<{ id: string; title?: string }>;
};

export type AiStatusResponse = { available: boolean };

export type AiValidationErrorResponse = { error: string; details?: unknown };

export type AiAnalyzeResultResponse = {
  overall_score?: number;
  error?: string;
};

export type AiAnalysisResponse = {
  error?: string;
  analysis?: unknown;
  result?: { error?: string };
};

export type HealthResponse = { status: string };

export type AuthSessionData = {
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
  absoluteExpiresAt: string;
};

export type AuthSessionResponse = {
  success: boolean;
  data: AuthSessionData;
};

export type ApiAuthErrorResponse = {
  success: false;
  error: { code: string; message: string };
};

export type FileMetadataResponse = {
  cdn_url: string;
  status: string;
};

export type DocumentBacklinksResponse = unknown[];

export type FleetGraphAttentionResponse = {
  findings?: Array<{ id: string }>;
  blocked?: boolean;
};

export type DocumentCreateResponse = ApiId & {
  title?: string;
  document_type?: string;
  properties?: Record<string, unknown>;
};

export type AuthLoginResponse = {
  data?: { user?: { id: string } };
};

export type SetupStatusResponse = {
  setupComplete?: boolean;
  hasUsers?: boolean;
};

export type InviteAcceptResponse = {
  success?: boolean;
  data?: { workspace?: { id: string } };
};

export type UsersListResponse = {
  data?: { users?: Array<{ id: string; email: string }> };
};

export type AccountabilityActionItem = {
  accountability_type: string;
  project_id?: string | null;
  accountability_target_id?: string;
  days_overdue?: number;
  title?: string;
  target_title?: string;
  is_system_generated?: boolean;
  id?: string;
};

export type ActionItemsResponse = {
  items: AccountabilityActionItem[];
  has_overdue?: boolean;
  has_due_today?: boolean;
};

export type BulkIssueUpdateResponse = {
  updated: Array<{ id: string }>;
  failed: Array<{ id: string; error: string }>;
};

export type TeamGridUser = {
  email: string;
  isPending?: boolean;
  id: string | null;
  personId?: string;
  name?: string;
};

export type TeamGridResponse = { users: TeamGridUser[] };

export type TeamGridWithSprint = TeamGridResponse & { currentSprintNumber: number };

export type TeamPerson = {
  email: string;
  isPending?: boolean;
  user_id: string | null;
  name?: string;
};

export type TeamProgram = { id: string };

export type WeeksListResponse = { weeks: Array<{ sprint_number: number }> };

export type UserReference = {
  id: string;
  name: string;
  email?: string;
};

export type ProgramSprintListItem = {
  id: string;
  sprint_number: number;
  owner: UserReference | null;
  sprint_status?: undefined;
  start_date?: undefined;
  end_date?: undefined;
};

export type ProgramSprintsResponse = {
  workspace_sprint_start_date: string;
  weeks: ProgramSprintListItem[];
};

export type WeekResponse = ApiId & {
  owner: UserReference | null;
};

export type AllocationWeekColumn = {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
};

export type AllocationWeekStatus = {
  isAllocated: boolean;
  planId?: string | null;
  planStatus?: string;
  retroId?: string | null;
  retroStatus?: string;
};

export type AllocationGridPerson = {
  id: string;
  name: string;
  weeks: Record<string, AllocationWeekStatus>;
};

export type ProjectAllocationGridResponse = {
  projectId: string;
  projectTitle: string;
  currentSprintNumber: number;
  weeks: AllocationWeekColumn[];
  people: AllocationGridPerson[];
};

export type ContentHistoryResponse = unknown[];

export type TeamWeekColumn = { isCurrent: boolean };

export type TeamGridFullResponse = TeamGridWithSprint & {
  weeks: TeamWeekColumn[];
  associations?: unknown;
};

export type AccountabilityGridV3Response = {
  programs: Array<{ id: string; name: string; people: unknown }>;
  weeks: TeamWeekColumn[];
  currentSprintNumber: number;
};

export type IssueListItem = { source?: string };

export type IssueDetail = ApiId & {
  source?: string;
  state?: string;
  rejection_reason?: string;
};

export type TeamAccountabilityPerson = {
  id: string | null;
};

export type TeamAccountabilityResponse = {
  people: TeamAccountabilityPerson[];
};

export type WorkspaceCurrentResponse = {
  data?: { workspace?: { id: string } };
};

export type MentionSearchResponse = { people: Array<{ name: string }> };

export type FileUploadInitResponse = { fileId: string; uploadUrl: string; s3Key?: string };

export type AuthMeResponse = { data: { user: { id: string } } };

export type InviteCreateResponse = { data: { invite: { token: string } } };

export type AssignResponse = { success: boolean; sprintId?: string };

export type SprintAssignment = { programId: string };

export type TeamAssignmentsResponse = Record<string, Record<string, SprintAssignment>>;

export function sprintAssignmentForPerson(
  assignments: TeamAssignmentsResponse,
  personId: string,
  sprintNumber: number,
): SprintAssignment | undefined {
  return assignments[personId]?.[String(sprintNumber)];
}
