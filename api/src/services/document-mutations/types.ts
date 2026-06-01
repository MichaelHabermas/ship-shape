import type { BelongsTo, DocumentType, DocumentVisibility } from '@ship/shared';
import type { DocumentMutationCapability } from '../../security/capabilities.js';
import type { Principal } from '../../security/principal.js';
import type { DocumentActor } from '../document-access.js';

export type MutationResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: { error: string; [key: string]: unknown } };

export type DocumentProperties = Record<string, unknown> & {
  is_complete?: boolean;
  missing_fields?: string[];
};

export type DocumentAccessRow = {
  id: string;
  workspace_id: string;
  document_type: DocumentType;
  title: string;
  parent_id: string | null;
  position: number | null;
  ticket_number: number | null;
  properties: DocumentProperties | null;
  content?: unknown;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: DocumentVisibility;
  archived_at?: Date | null;
  deleted_at?: Date | null;
  converted_to_id?: string | null;
  converted_by?: string | null;
};

export type DocumentContentRow = {
  id: string;
  title: string;
  content: unknown;
};

export type PersonOwnerRow = {
  id: string;
  name: string;
  email: string;
};

export type UpdateDocumentPatch = {
  title?: string;
  content?: unknown;
  parent_id?: string | null;
  position?: number;
  properties?: Record<string, unknown>;
  visibility?: DocumentVisibility;
  document_type?: DocumentType;
  state?: string;
  priority?: string;
  estimate?: number | null;
  assignee_id?: string | null;
  source?: 'internal' | 'external' | 'action_items';
  rejection_reason?: string | null;
  belongs_to?: BelongsTo[];
  confirm_orphan_children?: boolean;
  impact?: number | null;
  confidence?: number | null;
  ease?: number | null;
  color?: string;
  owner_id?: string | null;
  has_design_review?: boolean | null;
  design_review_notes?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  program_id?: string | null;
  sprint_id?: string | null;
  status?: 'planning' | 'active' | 'completed';
  hypothesis?: string;
  plan?: string;
};

export type CreateDocumentInput = {
  actor: DocumentActor;
  principal: Principal;
  input: {
    title: string;
    document_type: DocumentType;
    parent_id?: string | null;
    program_id?: string | null;
    sprint_id?: string | null;
    properties?: Record<string, unknown>;
    visibility?: DocumentVisibility;
    content?: unknown;
    belongs_to?: BelongsTo[];
  };
  source: 'rest' | 'collaboration' | 'system';
};

export type UpdateDocumentContentInput = {
  actor: DocumentActor;
  principal: Principal;
  documentId: string;
  content: { type?: unknown; content?: unknown };
  source: 'rest' | 'collaboration' | 'system';
};

export type UpdateDocumentInput = {
  actor: DocumentActor;
  principal: Principal;
  documentId: string;
  patch: UpdateDocumentPatch;
  capability?: DocumentMutationCapability;
  source: 'rest' | 'collaboration' | 'system';
};

export type DeleteDocumentInput = {
  actor: DocumentActor;
  principal: Principal;
  documentId: string;
  source: 'rest' | 'collaboration' | 'system';
};

export type ConvertDocumentInput = {
  actor: DocumentActor;
  principal: Principal;
  documentId: string;
  targetType: 'issue' | 'project';
  source: 'rest' | 'collaboration' | 'system';
};
