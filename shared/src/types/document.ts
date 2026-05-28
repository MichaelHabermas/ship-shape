// Document types

import type {
  AccountabilityType,
  BelongsToType,
  DocumentType,
  DocumentVisibility,
  IssuePriority,
  IssueSource,
  IssueState,
} from '../enums/document-enums.js';

export {
  DOCUMENT_TYPE_VALUES,
  DOCUMENT_VISIBILITY_VALUES,
  BELONGS_TO_TYPE_VALUES,
  ISSUE_STATE_VALUES,
  ISSUE_PRIORITY_VALUES,
  ISSUE_SOURCE_VALUES,
  ACCOUNTABILITY_TYPE_VALUES,
  INFERRED_PROJECT_STATUS_VALUES,
  ISSUE_STATE_OPTIONS,
  ISSUE_STATE_LABELS,
  ISSUE_PRIORITY_OPTIONS,
  ISSUE_PRIORITY_OPTIONS_FULL,
  ISSUE_PRIORITY_LABELS,
  type DocumentType,
  type DocumentVisibility,
  type BelongsToType,
  type IssueState,
  type IssuePriority,
  type IssueSource,
  type AccountabilityType,
  type InferredProjectStatus,
  type SelectableDocumentType,
  type ConversionDocumentType,
} from '../enums/document-enums.js';

// BelongsTo association entry - unified format for all document relationships
export interface BelongsTo {
  id: string;
  type: BelongsToType;
  // Optional display fields populated by API
  title?: string;
  color?: string;
}

/** HTTP/OpenAPI alias for {@link BelongsTo} (same wire shape). */
export type BelongsToResponse = BelongsTo;

// Cascade warning for incomplete children when closing parent issue
export interface IncompleteChild {
  id: string;
  title: string;
  ticket_number: number;
  state: string;
}

export interface CascadeWarning {
  error: 'incomplete_children';
  message: string;
  incomplete_children: IncompleteChild[];
  confirm_action: string;
}

// Sprint status - computed from dates, not stored
export type WeekStatus = 'active' | 'upcoming' | 'completed';

// Properties interfaces for each document type
// Each includes index signature for JSONB compatibility
export interface IssueProperties {
  state: IssueState;
  priority: IssuePriority;
  assignee_id?: string | null;
  estimate?: number | null;
  source: IssueSource;
  rejection_reason?: string | null;
  // Due date for issues (ISO date string, e.g., "2025-01-26")
  due_date?: string | null;
  // System-generated accountability issues (cannot be deleted)
  is_system_generated?: boolean;
  // Links to the document this accountability issue is about
  accountability_target_id?: string | null;
  // Type of accountability task
  accountability_type?: AccountabilityType | null;
  [key: string]: unknown;
}

export interface ProgramProperties {
  color: string;
  emoji?: string | null;  // Optional emoji for visual identification
  // RACI accountability fields
  owner_id?: string | null;        // R - Responsible (does the work)
  accountable_id?: string | null;  // A - Accountable (approver for hypotheses/reviews)
  consulted_ids?: string[];        // C - Consulted (passive metadata for display)
  informed_ids?: string[];         // I - Informed (passive metadata for display)
  [key: string]: unknown;
}

// ICE score type (1-5 scale for prioritization)
export type ICEScore = 1 | 2 | 3 | 4 | 5;

export interface ProjectProperties {
  // ICE prioritization scores (1-5 scale, null = not yet set)
  impact: ICEScore | null;      // How much will this move the needle?
  confidence: ICEScore | null;  // How certain are we this will achieve the impact?
  ease: ICEScore | null;        // How easy is this to implement? (inverse of effort)
  // RACI accountability fields
  owner_id?: string | null;        // R - Responsible (does the work)
  accountable_id?: string | null;  // A - Accountable (approver for hypotheses/reviews)
  consulted_ids?: string[];        // C - Consulted (passive metadata for display)
  informed_ids?: string[];         // I - Informed (passive metadata for display)
  // Visual identification
  color: string;
  emoji?: string | null;
  // Project retro properties - track plan validation and outcomes
  plan_validated?: boolean | null;  // null = not yet determined, true = validated, false = invalidated
  monetary_impact_expected?: string | null;  // Expected monetary value (e.g., "$50K annual savings")
  monetary_impact_actual?: string | null;    // Actual monetary impact after completion
  success_criteria?: string[] | null;        // Array of measurable success criteria
  next_steps?: string | null;                // Recommended follow-up actions
  // Approval tracking for accountability workflow
  plan_approval?: ApprovalTracking | null;  // Approval status for project plan
  retro_approval?: ApprovalTracking | null;       // Approval status for project retro
  // Design review tracking
  has_design_review?: boolean | null;  // Whether design review has been completed
  design_review_notes?: string | null; // Optional notes from design review
  [key: string]: unknown;
}

// Plan history entry for tracking plan changes over time
export interface PlanHistoryEntry {
  plan: string;
  timestamp: string;  // ISO 8601 date string
  author_id: string;
  author_name?: string;
}

// Approval tracking state for accountability workflows
export type ApprovalState = null | 'approved' | 'changed_since_approved' | 'changes_requested';

// Approval tracking structure for hypotheses, reviews, and retros
export interface ApprovalTracking {
  state: ApprovalState;                   // null = pending, 'approved' = current version approved, 'changed_since_approved' = needs re-review, 'changes_requested' = manager requested revisions
  approved_by: string | null;             // User ID who approved
  approved_at: string | null;             // ISO 8601 timestamp of approval
  approved_version_id: number | null;     // document_history.id that was approved
  feedback?: string | null;               // Manager's feedback when requesting changes
  comment?: string | null;                // Optional manager note when approving
}

export interface WeekProperties {
  sprint_number: number;  // References implicit 1-week window, dates computed from this
  owner_id: string;       // REQUIRED - person accountable for this sprint
  status?: 'planning' | 'active' | 'completed';  // Sprint workflow status (default: 'planning')
  // Plan tracking (for Ship-Claude integration)
  plan?: string | null;           // Current plan statement
  success_criteria?: string[] | null;   // Array of measurable success criteria
  confidence?: number | null;           // Confidence level 0-100
  plan_history?: PlanHistoryEntry[] | null;  // History of plan changes
  // Approval tracking for accountability workflow
  plan_approval?: ApprovalTracking | null;  // Approval status for sprint plan
  review_approval?: ApprovalTracking | null;      // Approval status for sprint review
  // Performance rating (OPM 5-level scale: 1=Unacceptable, 2=Minimally Satisfactory, 3=Fully Successful, 4=Exceeds Expectations, 5=Outstanding)
  review_rating?: {
    value: number;         // 1-5
    rated_by: string;      // User ID who rated
    rated_at: string;      // ISO 8601 timestamp
  } | null;
  [key: string]: unknown;
}

export interface PersonProperties {
  email?: string | null;
  role?: string | null;
  capacity_hours?: number | null;
  reports_to?: string | null;
  [key: string]: unknown;
}

// Wiki properties - optional maintainer
export interface WikiProperties {
  maintainer_id?: string | null;
  [key: string]: unknown;
}
// Weekly plan properties - per-person-per-week accountability document
export interface WeeklyPlanProperties {
  person_id: string;       // REQUIRED - person document ID who wrote this plan
  project_id?: string;     // OPTIONAL - legacy field, no longer used for uniqueness
  week_number: number;     // REQUIRED - week number (same as sprint_number concept)
  submitted_at?: string | null;  // ISO timestamp when first saved with content
  [key: string]: unknown;
}

// Weekly retro properties - per-person-per-week retrospective document
export interface WeeklyRetroProperties {
  person_id: string;       // REQUIRED - person document ID who wrote this retro
  project_id?: string;     // OPTIONAL - legacy field, no longer used for uniqueness
  week_number: number;     // REQUIRED - week number (same as sprint_number concept)
  submitted_at?: string | null;  // ISO timestamp when first saved with content
  [key: string]: unknown;
}

// Standup properties - standalone daily entries per user
export interface StandupProperties {
  author_id: string;  // REQUIRED - who posted this standup (user ID)
  date?: string;      // OPTIONAL - ISO date string (e.g., '2026-02-24') for standalone standups
  submitted_at?: string | null;  // ISO timestamp when first saved with content
  [key: string]: unknown;
}

// Weekly review properties - one per week, tracks plan validation
export interface WeeklyReviewProperties {
  sprint_id: string;          // REQUIRED - which sprint/week this reviews
  owner_id: string;           // REQUIRED - who is accountable for this review
  plan_validated: boolean | null;  // null = not yet determined
  [key: string]: unknown;
}

// Union of all properties types
export type DocumentProperties =
  | IssueProperties
  | ProgramProperties
  | ProjectProperties
  | WeekProperties
  | PersonProperties
  | WikiProperties
  | WeeklyPlanProperties
  | WeeklyRetroProperties
  | StandupProperties
  | WeeklyReviewProperties;

// Base document interface
export interface Document {
  id: string;
  workspace_id: string;
  document_type: DocumentType;
  title: string;
  content: Record<string, unknown>;
  yjs_state?: Uint8Array | null;
  parent_id?: string | null;
  position: number;
  // Note: program_id, project_id, and sprint_id removed - use belongs_to array instead
  // These columns were dropped by migrations 027 and 029
  properties: Record<string, unknown>;
  ticket_number?: number | null;
  archived_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by?: string | null;
  // Document visibility (private = creator only, workspace = all members)
  visibility: DocumentVisibility;
  // Status timestamps (primarily for issues)
  started_at?: Date | null;
  completed_at?: Date | null;
  cancelled_at?: Date | null;
  reopened_at?: Date | null;
  // Document conversion tracking (issue <-> project)
  converted_to_id?: string | null;    // Points to new doc (set on archived original)
  converted_from_id?: string | null;  // Points to original (set on new doc)
  converted_at?: Date | null;         // When conversion occurred
  converted_by?: string | null;       // User who performed conversion
}

// Typed document variants for type safety in application code
export interface WikiDocument extends Document {
  document_type: 'wiki';
  properties: WikiProperties;
}

export interface IssueDocument extends Document {
  document_type: 'issue';
  properties: IssueProperties;
  ticket_number: number;
}

export interface ProgramDocument extends Document {
  document_type: 'program';
  properties: ProgramProperties;
}

export interface ProjectDocument extends Document {
  document_type: 'project';
  properties: ProjectProperties;
}

export interface WeekDocument extends Document {
  document_type: 'sprint';
  properties: WeekProperties;
}

export interface PersonDocument extends Document {
  document_type: 'person';
  properties: PersonProperties;
}

export interface WeeklyPlanDocument extends Document {
  document_type: 'weekly_plan';
  properties: WeeklyPlanProperties;
}

export interface WeeklyRetroDocument extends Document {
  document_type: 'weekly_retro';
  properties: WeeklyRetroProperties;
}

export interface StandupDocument extends Document {
  document_type: 'standup';
  properties: StandupProperties;
}

export interface WeeklyReviewDocument extends Document {
  document_type: 'weekly_review';
  properties: WeeklyReviewProperties;
}

// Default project properties - ICE and owner start as null (not yet set)
export const DEFAULT_PROJECT_PROPERTIES: Partial<ProjectProperties> = {
  impact: null,
  confidence: null,
  ease: null,
  owner_id: null,
  color: '#6366f1',
};

// Note: Sprint properties require sprint_number and owner_id at creation time
// There is no sensible default - these must be provided

// ICE Prioritization helpers

/**
 * Compute ICE score from impact, confidence, and ease values.
 * ICE Score = Impact × Confidence × Ease
 * With 1-5 scale, max score is 125 (5 × 5 × 5).
 * Returns null if any value is null (unset).
 */
export function computeICEScore(impact: number | null, confidence: number | null, ease: number | null): number | null {
  if (impact === null || confidence === null || ease === null) {
    return null;
  }
  return impact * confidence * ease;
}
