// OPM 5-level performance rating scale
export const OPM_RATINGS = [
  { value: 5, label: 'Outstanding', color: 'text-green-500', bg: 'bg-green-500/10' },
  { value: 4, label: 'Exceeds Expectations', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { value: 3, label: 'Fully Successful', color: 'text-muted', bg: 'bg-border/50' },
  { value: 2, label: 'Minimally Satisfactory', color: 'text-orange-500', bg: 'bg-orange-500/10' },
  { value: 1, label: 'Unacceptable', color: 'text-red-500', bg: 'bg-red-500/10' },
] as const;

export type ReviewStatus = 'approved' | 'needs_review' | 'late' | 'changed' | 'changes_requested' | 'empty';

export const REVIEW_COLORS: Record<ReviewStatus, string> = {
  approved: '#22c55e',
  needs_review: '#eab308',
  late: '#ef4444',
  changed: '#f97316',
  changes_requested: '#ea580c',
  empty: '#6b7280',
};

export const REVIEW_STATUS_TEXT: Record<ReviewStatus, string> = {
  approved: 'approved',
  needs_review: 'needs review',
  late: 'late',
  changed: 'changed since approved',
  changes_requested: 'changes requested',
  empty: 'no submission',
};

export interface Week {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface ReviewPerson {
  personId: string;
  name: string;
  programId: string | null;
  programName: string | null;
  programColor: string | null;
  reportsTo?: string | null;
}

export interface ApprovalInfo {
  state: string;
  approved_by?: string | null;
  approved_at?: string | null;
  approved_version_id?: number | null;
  feedback?: string | null;
  comment?: string | null;
}

export interface RatingInfo {
  value: number;
  rated_by?: string;
  rated_at?: string;
}

export interface ReviewCell {
  planApproval: ApprovalInfo | null;
  reviewApproval: ApprovalInfo | null;
  reviewRating: RatingInfo | null;
  hasPlan: boolean;
  hasRetro: boolean;
  sprintId: string | null;
  planDocId: string | null;
  retroDocId: string | null;
}

export interface ReviewsData {
  people: ReviewPerson[];
  weeks: Week[];
  reviews: Record<string, Record<number, ReviewCell>>;
  currentSprintNumber: number;
}

export interface ProgramGroup {
  programId: string | null;
  programName: string;
  programColor: string | null;
  people: ReviewPerson[];
}

export interface WeeklyDoc {
  id: string;
  title: string;
  content: unknown;
  properties: Record<string, unknown>;
  person_name?: string;
  project_name?: string;
}

export interface SelectedCell {
  personId: string;
  personName: string;
  weekNumber: number;
  weekName: string;
  type: 'plan' | 'retro';
  sprintId: string;
  cell: ReviewCell;
}

export interface BatchMode {
  type: 'plans' | 'retros';
  queue: SelectedCell[];
  currentIndex: number;
}
