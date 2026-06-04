import type { ApprovalTracking, SprintRouteProperties } from '@ship/shared';
import { asApprovalRecord } from '../../utils/approval-workflow.js';

export type EmptyRow = Record<string, never>;

export type IdRow = { id: string };

export type WorkspaceSprintStartRow = {
  sprint_start_date: Date | string | null;
};

export type SprintDocumentProperties = SprintRouteProperties & {
  project_id?: string;
  start_date?: string;
  end_date?: string;
};

export type SprintDocumentRow = {
  id: string;
  properties: SprintDocumentProperties | null;
};

export type PersonUserIdRow = {
  user_id: string | null;
};

export type ProjectWithProgramRow = {
  id: string;
  program_id: string | null;
};

export type TeamGridUserRow = {
  personId: string;
  id: string | null;
  name: string;
  email: string | null;
  isArchived: boolean;
  isPending: boolean;
  reportsTo: string | null;
};

export type TeamGridSprintRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  program_id: string | null;
  program_name: string | null;
  program_emoji: string | null;
  program_color: string | null;
};

export type TeamGridIssueRow = {
  id: string;
  title: string;
  sprint_id: string;
  assignee_id: string;
  state: string | null;
  ticket_number: number | null;
  sprint_start: string;
  sprint_end: string | null;
  program_id: string | null;
  program_name: string | null;
  program_emoji: string | null;
  program_color: string | null;
};

export type TeamProjectRow = {
  id: string;
  title: string;
  color: string | null;
  programId: string | null;
  programName: string | null;
  programEmoji: string | null;
  programColor: string | null;
};

export type TeamProgramRow = {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
};

export type ExplicitAssignmentRow = {
  person_id: string;
  sprint_number: number;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  program_id: string | null;
  program_name: string | null;
  program_emoji: string | null;
  program_color: string | null;
};

export type AssignmentInferenceIssueRow = {
  assignee_id: string;
  project_id: string;
  project_name: string;
  project_color: string | null;
  program_id: string | null;
  program_name: string | null;
  program_emoji: string | null;
  program_color: string | null;
  sprint_start: string;
};

export type TeamPersonRow = {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  isArchived: boolean;
  isPending: boolean;
  reportsTo: string | null;
  role: string | null;
};

export type AccountabilityPersonRow = {
  id: string | null;
  name: string;
};

export type AccountabilityIssueRow = {
  assignee_id: string;
  sprint_id: string;
  estimate: string | number;
  state: string | null;
  sprint_number: string;
};

export type PersonSprintMetricsIssueRow = {
  estimate: string | number;
  state: string | null;
  sprint_number: string;
};

export type ReviewPersonRow = {
  id: string;
  name: string;
  reportsTo: string | null;
};

export type ReviewSprintRow = {
  person_id: string;
  sprint_number: number;
  sprint_id: string;
  project_id: string | null;
  plan_approval: unknown;
  review_approval: unknown;
  review_rating: unknown;
  project_name: string | null;
  program_id: string | null;
  program_name: string | null;
  program_color: string | null;
};

export type ReviewWeeklyDocRow = {
  person_id: string;
  week_number: number;
  id: string;
  content: unknown;
};

export type ReviewPersonResponse = {
  personId: string;
  name: string;
  programId: string | null;
  programName: string | null;
  programColor: string | null;
  reportsTo: string | null;
};

export type ReviewRatingInfo = {
  value: number;
  rated_by: string;
  rated_at: string;
};

export type ReviewCellData = {
  planApproval: ApprovalTracking | null;
  reviewApproval: ApprovalTracking | null;
  reviewRating: ReviewRatingInfo | null;
  hasPlan: boolean;
  hasRetro: boolean;
  sprintId: string | null;
  planDocId: string | null;
  retroDocId: string | null;
};

export type ReviewSprintMapEntry = {
  sprintId: string;
  planApproval: ApprovalTracking | null;
  reviewApproval: ApprovalTracking | null;
  reviewRating: ReviewRatingInfo | null;
  programId: string | null;
  programName: string | null;
  programColor: string | null;
};

export type AccountabilityGridPersonRow = {
  id: string;
  name: string;
};

export type AccountabilityGridProgramRow = {
  id: string;
  name: string;
  color: string | null;
};

export type AccountabilityGridAssignmentRow = {
  person_id: string;
  sprint_number: number;
  project_id: string | null;
  plan_approval_state: string | null;
  review_approval_state: string | null;
  project_name: string | null;
  project_color: string | null;
  program_id: string | null;
  program_name: string | null;
  program_color: string | null;
};

export type AccountabilityGridWeeklyDocRow = {
  person_id: string;
  project_id: string | null;
  week_number: number;
  id: string;
  content: unknown;
};

export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function asReviewRatingInfo(value: unknown): ReviewRatingInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.value !== 'number'
    || typeof record.rated_by !== 'string'
    || typeof record.rated_at !== 'string'
  ) {
    return null;
  }
  return {
    value: record.value,
    rated_by: record.rated_by,
    rated_at: record.rated_at,
  };
}

export function mapReviewPersonResponse(
  person: ReviewPersonRow,
  currentSprintNumber: number,
  sprintMap: Map<string, ReviewSprintMapEntry>,
): ReviewPersonResponse {
  const currentSprint = sprintMap.get(`${person.id}_${currentSprintNumber}`);
  return {
    personId: person.id,
    name: person.name,
    programId: currentSprint?.programId || null,
    programName: currentSprint?.programName || null,
    programColor: currentSprint?.programColor || null,
    reportsTo: person.reportsTo || null,
  };
}

export function mapReviewSprintMapEntry(
  row: ReviewSprintRow,
): { key: string; entry: ReviewSprintMapEntry } | null {
  if (!row.person_id || !row.sprint_number) return null;
  return {
    key: `${row.person_id}_${row.sprint_number}`,
    entry: {
      sprintId: row.sprint_id,
      planApproval: asApprovalRecord(row.plan_approval),
      reviewApproval: asApprovalRecord(row.review_approval),
      reviewRating: asReviewRatingInfo(row.review_rating),
      programId: row.program_id || null,
      programName: row.program_name || null,
      programColor: row.program_color || null,
    },
  };
}
