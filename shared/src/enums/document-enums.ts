/** Single source of truth for document enum values (shared across API Zod, OpenAPI, and web). */

export const DOCUMENT_TYPE_VALUES = [
  'wiki',
  'issue',
  'program',
  'project',
  'sprint',
  'person',
  'weekly_plan',
  'weekly_retro',
  'standup',
  'weekly_review',
] as const;

export const DOCUMENT_VISIBILITY_VALUES = ['private', 'workspace'] as const;

export const BELONGS_TO_TYPE_VALUES = ['program', 'project', 'sprint', 'parent'] as const;

export const ISSUE_STATE_VALUES = [
  'triage',
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
] as const;

export const ISSUE_PRIORITY_VALUES = ['urgent', 'high', 'medium', 'low', 'none'] as const;

export const ISSUE_SOURCE_VALUES = ['internal', 'external', 'action_items'] as const;

export const ACCOUNTABILITY_TYPE_VALUES = [
  'standup',
  'weekly_plan',
  'weekly_retro',
  'weekly_review',
  'week_start',
  'week_issues',
  'project_plan',
  'project_retro',
  'changes_requested_plan',
  'changes_requested_retro',
] as const;

export const INFERRED_PROJECT_STATUS_VALUES = [
  'active',
  'planned',
  'completed',
  'backlog',
  'archived',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPE_VALUES)[number];
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITY_VALUES)[number];
export type BelongsToType = (typeof BELONGS_TO_TYPE_VALUES)[number];
export type IssueState = (typeof ISSUE_STATE_VALUES)[number];
export type IssuePriority = (typeof ISSUE_PRIORITY_VALUES)[number];
export type IssueSource = (typeof ISSUE_SOURCE_VALUES)[number];
export type AccountabilityType = (typeof ACCOUNTABILITY_TYPE_VALUES)[number];
export type InferredProjectStatus = (typeof INFERRED_PROJECT_STATUS_VALUES)[number];

/** Document types selectable in the type picker UI. */
export type SelectableDocumentType = Extract<DocumentType, 'wiki' | 'issue' | 'project' | 'sprint'>;

/** Document types that support issue ↔ project conversion. */
export type ConversionDocumentType = Extract<DocumentType, 'issue' | 'project'>;

/** Issue state labels for UI selectors and context menus. */
export const ISSUE_STATE_OPTIONS = [
  { value: 'triage', label: 'Needs Triage' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
] as const satisfies ReadonlyArray<{ value: IssueState; label: string }>;

function labelsFromOptions<const T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>
): Record<T, string> {
  return Object.fromEntries(options.map((option) => [option.value, option.label])) as Record<T, string>;
}

/** Map of issue state values to display labels (derived from ISSUE_STATE_OPTIONS). */
export const ISSUE_STATE_LABELS = labelsFromOptions(ISSUE_STATE_OPTIONS);

/** Issue priority labels for UI selectors (subset omits "none" in context menus). */
export const ISSUE_PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const satisfies ReadonlyArray<{ value: IssuePriority; label: string }>;

/** Full priority labels including "none" for property sidebars. */
export const ISSUE_PRIORITY_OPTIONS_FULL = [
  ...ISSUE_PRIORITY_OPTIONS,
  { value: 'none', label: 'No Priority' },
] as const satisfies ReadonlyArray<{ value: IssuePriority; label: string }>;

/** Map of issue priority values to display labels. */
export const ISSUE_PRIORITY_LABELS = labelsFromOptions(ISSUE_PRIORITY_OPTIONS_FULL);
