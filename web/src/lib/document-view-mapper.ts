import type {
  EditorDocumentType,
  IssueDocumentView,
  ProgramDocumentView,
  ProjectDocumentView,
  SprintDocumentView,
  UnifiedDocumentView,
} from '@ship/shared';
import type { DocumentResponse } from '@/lib/document-tabs';
import {
  getBelongsTo,
  getBelongsToId,
  getNullableString,
  getNumber,
  getRecord,
  getString,
  getStringArray,
  isEditorDocumentType,
} from '@/lib/document-view-guards';

type Owner = { id: string; name: string; email: string };

function getOwner(value: unknown): Owner | null {
  if (!value || typeof value !== 'object') return null;

  const owner = value as Record<string, unknown>;
  if (
    typeof owner.id !== 'string' ||
    typeof owner.name !== 'string' ||
    typeof owner.email !== 'string'
  ) {
    return null;
  }

  return {
    id: owner.id,
    name: owner.name,
    email: owner.email,
  };
}

function getIssueSource(value: unknown): IssueDocumentView['source'] {
  return value === 'internal' || value === 'external' ? value : undefined;
}

function getSprintStatus(value: unknown): SprintDocumentView['status'] {
  return value === 'active' || value === 'completed' || value === 'planning'
    ? value
    : 'planning';
}

export function getDocumentAssociationId(
  document: Pick<DocumentResponse, 'belongs_to'>,
  type: 'program' | 'project' | 'sprint' | 'parent'
): string | null {
  return getBelongsToId(document.belongs_to, type);
}

export function getDocumentProgramId(document: Pick<DocumentResponse, 'belongs_to'>): string | null {
  return getDocumentAssociationId(document, 'program');
}

export function getProjectView(document: DocumentResponse): ProjectDocumentView {
  const view: ProjectDocumentView = {
    id: document.id,
    title: document.title,
    document_type: 'project',
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: getNullableString(document.created_by),
    properties: getRecord(document.properties),
    impact: getNumber(document.impact),
    confidence: getNumber(document.confidence),
    ease: getNumber(document.ease),
    color: getString(document.color) || '#3b82f6',
    emoji: getString(document.emoji) ?? null,
    program_id: getDocumentProgramId(document),
    owner: getOwner(document.owner),
    owner_id: getNullableString(document.owner_id),
    accountable_id: getNullableString(document.accountable_id),
    consulted_ids: getStringArray(document.consulted_ids),
    informed_ids: getStringArray(document.informed_ids),
    converted_from_id: getNullableString(document.converted_from_id),
  };

  return Object.assign(view, {
    has_design_review: typeof document.has_design_review === 'boolean' ? document.has_design_review : null,
    design_review_notes: getNullableString(document.design_review_notes),
  });
}

export function getSprintView(document: DocumentResponse): SprintDocumentView {
  const view: SprintDocumentView = {
    id: document.id,
    title: document.title,
    document_type: 'sprint',
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: getNullableString(document.created_by),
    properties: getRecord(document.properties),
    start_date: getString(document.start_date) || '',
    end_date: getString(document.end_date) || '',
    status: getSprintStatus(document.status),
    program_id: getDocumentProgramId(document),
    plan: getString(document.plan) || '',
  };

  return Object.assign(view, {
    owner_id: getNullableString(document.owner_id),
  });
}

export function getProgramView(document: DocumentResponse): ProgramDocumentView {
  const view: ProgramDocumentView = {
    id: document.id,
    title: document.title,
    document_type: 'program',
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: getNullableString(document.created_by),
    properties: getRecord(document.properties),
    color: getString(document.color) || '#6366f1',
    emoji: getString(document.emoji) ?? null,
  };

  return Object.assign(view, {
    owner_id: getNullableString(document.owner_id),
    accountable_id: getNullableString(document.accountable_id),
    consulted_ids: getStringArray(document.consulted_ids),
    informed_ids: getStringArray(document.informed_ids),
  });
}

export function mapApiDocumentToUnifiedDocumentView(document: DocumentResponse): UnifiedDocumentView {
  const documentType: EditorDocumentType = isEditorDocumentType(document.document_type)
    ? document.document_type
    : 'wiki';

  const base = {
    id: document.id,
    title: document.title,
    document_type: documentType,
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: getNullableString(document.created_by),
    properties: getRecord(document.properties),
  };

  if (documentType === 'issue') {
    const ticketNumber = getNumber(document.ticket_number);

    return {
      ...base,
      document_type: 'issue',
      state: getString(document.state) || 'backlog',
      priority: getString(document.priority) || 'medium',
      estimate: getNumber(document.estimate),
      assignee_id: getNullableString(document.assignee_id),
      assignee_name: getNullableString(document.assignee_name),
      program_id: getDocumentProgramId(document),
      sprint_id: getDocumentAssociationId(document, 'sprint'),
      source: getIssueSource(document.source),
      converted_from_id: getNullableString(document.converted_from_id),
      display_id: ticketNumber ? `#${ticketNumber}` : undefined,
      belongs_to: getBelongsTo(document.belongs_to),
    };
  }

  if (documentType === 'project') {
    return getProjectView(document);
  }

  if (documentType === 'sprint') {
    return getSprintView(document);
  }

  if (documentType === 'wiki') {
    return {
      ...base,
      document_type: 'wiki',
      parent_id: getNullableString(document.parent_id),
      visibility: document.visibility === 'private' || document.visibility === 'workspace'
        ? document.visibility
        : undefined,
    };
  }

  if (documentType === 'program') {
    return getProgramView(document);
  }

  return base;
}
