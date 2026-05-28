/**
 * Web-facing document view types derived from @ship/shared domain types.
 * Use these in editor/sidebar layers instead of re-declaring per-component unions.
 */

import type {
  BelongsTo,
  DocumentType,
  DocumentVisibility,
  IssuePriority,
  IssueState,
} from './types/document.js';
import { ISSUE_PRIORITY_VALUES, ISSUE_STATE_VALUES } from './enums/document-enums.js';

/** Document types rendered in UnifiedEditor (excludes standup/review-only types). */
export type EditorDocumentType =
  | 'wiki'
  | 'issue'
  | 'project'
  | 'sprint'
  | 'program'
  | 'person'
  | 'weekly_plan'
  | 'weekly_retro'
  | 'standup'
  | 'weekly_review';

/** Document types with a properties panel in UnifiedEditor. */
export type PanelDocumentType = Extract<
  EditorDocumentType,
  'wiki' | 'issue' | 'project' | 'sprint' | 'program' | 'weekly_plan' | 'weekly_retro'
>;

/** Active document in shell navigation (all editor-rendered types, or none). */
export type CurrentDocumentType = EditorDocumentType | null;

const EDITOR_DOCUMENT_TYPES: readonly EditorDocumentType[] = [
  'wiki',
  'issue',
  'project',
  'sprint',
  'program',
  'person',
  'weekly_plan',
  'weekly_retro',
  'standup',
  'weekly_review',
];

const PANEL_DOCUMENT_TYPES: readonly PanelDocumentType[] = [
  'wiki',
  'issue',
  'project',
  'sprint',
  'program',
  'weekly_plan',
  'weekly_retro',
];

export function isEditorDocumentType(value: unknown): value is EditorDocumentType {
  return typeof value === 'string' && (EDITOR_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isPanelDocumentType(value: unknown): value is PanelDocumentType {
  return typeof value === 'string' && (PANEL_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isCurrentDocumentType(value: unknown): value is EditorDocumentType {
  return isEditorDocumentType(value);
}

export interface BaseDocumentView {
  id: string;
  title: string;
  document_type: EditorDocumentType;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
}

export interface WikiDocumentView extends BaseDocumentView {
  document_type: 'wiki';
  parent_id?: string | null;
  visibility?: DocumentVisibility;
}

export function asIssueState(value: unknown): IssueState {
  if (typeof value === 'string' && (ISSUE_STATE_VALUES as readonly string[]).includes(value)) {
    return value as IssueState;
  }
  return 'backlog';
}

export function asIssuePriority(value: unknown): IssuePriority {
  if (typeof value === 'string' && (ISSUE_PRIORITY_VALUES as readonly string[]).includes(value)) {
    return value as IssuePriority;
  }
  return 'medium';
}

export interface IssueDocumentView extends BaseDocumentView {
  document_type: 'issue';
  state: IssueState;
  priority: IssuePriority;
  estimate: number | null;
  assignee_id: string | null;
  assignee_name?: string | null;
  assignee_archived?: boolean;
  program_id: string | null;
  sprint_id: string | null;
  source?: 'internal' | 'external';
  rejection_reason?: string | null;
  converted_from_id?: string | null;
  display_id?: string;
  belongs_to?: BelongsTo[];
}

export interface ProjectDocumentView extends BaseDocumentView {
  document_type: 'project';
  impact: number | null;
  confidence: number | null;
  ease: number | null;
  ice_score?: number | null;
  color: string;
  emoji: string | null;
  program_id: string | null;
  owner?: { id: string; name: string; email: string } | null;
  owner_id?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  sprint_count?: number;
  issue_count?: number;
  converted_from_id?: string | null;
}

export interface SprintDocumentView extends BaseDocumentView {
  document_type: 'sprint';
  start_date: string;
  end_date: string;
  status: 'planning' | 'active' | 'completed';
  program_id: string | null;
  program_name?: string;
  issue_count?: number;
  completed_count?: number;
  plan?: string;
}

export interface ProgramDocumentView extends BaseDocumentView {
  document_type: 'program';
  color?: string;
  emoji?: string | null;
}

export interface PersonDocumentView extends BaseDocumentView {
  document_type: 'person';
}

export type UnifiedDocumentView =
  | WikiDocumentView
  | IssueDocumentView
  | ProjectDocumentView
  | SprintDocumentView
  | ProgramDocumentView
  | PersonDocumentView
  | BaseDocumentView;

/** Map persisted document_type to collaboration room prefix (server-authoritative). */
export function collaborationRoomPrefixForType(documentType: DocumentType): string {
  return documentType;
}
