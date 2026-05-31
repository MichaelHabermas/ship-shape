// Shared Playwright API response shapes for E2E JSON parsing (no-unsafe-call).

export type ApiId = { id: string };

export type AccountabilityActionItem = {
  accountability_type: string;
  project_id?: string | null;
  accountability_target_id?: string;
  days_overdue?: number;
  title?: string;
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

export type ProjectAllocationGridResponse = {
  people: Array<{
    id: string;
    weeks: Record<number, { isAllocated?: boolean; planId?: string }>;
  }>;
};

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

export type MentionSearchResponse = { people: Array<{ name: string }> };

export type FileUploadInitResponse = { fileId: string; uploadUrl: string };

export type AuthMeResponse = { data: { user: { id: string } } };

export type InviteCreateResponse = { data: { invite: { token: string } } };

export type AssignResponse = { success: boolean };

export type SprintAssignment = { programId: string };

export type TeamAssignmentsResponse = Record<string, Record<string, SprintAssignment>>;

export function sprintAssignmentForPerson(
  assignments: TeamAssignmentsResponse,
  personId: string,
  sprintNumber: number,
): SprintAssignment | undefined {
  return assignments[personId]?.[String(sprintNumber)];
}
