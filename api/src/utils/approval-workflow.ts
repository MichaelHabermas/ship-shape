/**
 * Shared approval workflow helpers for project and sprint documents.
 */

import { logDocumentChange, getLatestDocumentFieldHistory } from './document-crud.js';

// =============================================================================
// Types
// =============================================================================

export type ApprovalState = 'approved' | 'changed_since_approved' | 'changes_requested';

export type ApprovalRecord = {
  state: ApprovalState | null;
  approved_by: string | null;
  approved_at: string | null;
  approved_version_id: number | null;
  feedback?: string | null;
  comment?: string | null;
};

export type ApprovalHistoryField = 'plan_approval' | 'review_approval' | 'retro_approval';

export type ParsedApprovalComment = {
  provided: boolean;
  value: string | null;
  error?: string;
};

export type ApprovalAuthResult =
  | { authorized: true }
  | { authorized: false; error: string };

export type ReviewRatingRecord = {
  value: number;
  rated_by: string;
  rated_at: string;
};

type ReviewRatingValidationResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

const APPROVAL_STATES = new Set<ApprovalState>([
  'approved',
  'changed_since_approved',
  'changes_requested',
]);

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasApprovalShape(value: Record<string, unknown>): boolean {
  return [
    'state',
    'approved_by',
    'approved_at',
    'approved_version_id',
    'feedback',
    'comment',
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string') {
    return value;
  }
  return undefined;
}

function parseNullableVersionId(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  return undefined;
}

// =============================================================================
// Authorization
// =============================================================================

export function checkProjectAccountableAuth(
  accountableId: string | null | undefined,
  userId: string,
  isAdmin: boolean,
  resource: 'plans' | 'retros',
): ApprovalAuthResult {
  if (accountableId === userId || isAdmin) {
    return { authorized: true };
  }
  const noun = resource === 'plans' ? 'plans' : 'retros';
  return {
    authorized: false,
    error: `Only the project accountable person or admin can approve ${noun}`,
  };
}

export function checkSprintSupervisorAuth(
  programAccountableId: string | null | undefined,
  ownerReportsTo: string | null | undefined,
  userId: string,
  isAdmin: boolean,
  action: 'approve_plans' | 'unapprove_plans' | 'approve_reviews' | 'request_changes',
): ApprovalAuthResult {
  if (programAccountableId === userId || ownerReportsTo === userId || isAdmin) {
    return { authorized: true };
  }
  const verbByAction: Record<typeof action, string> = {
    approve_plans: 'approve plans',
    unapprove_plans: 'unapprove plans',
    approve_reviews: 'approve reviews',
    request_changes: 'request changes',
  };
  return {
    authorized: false,
    error: `Only the supervisor, program accountable person, or admin can ${verbByAction[action]}`,
  };
}

// =============================================================================
// Approval property shapes
// =============================================================================

export function buildApprovedApprovalRecord(
  userId: string,
  versionId: number | null,
  comment?: string | null,
): ApprovalRecord {
  const record: ApprovalRecord = {
    state: 'approved',
    approved_by: userId,
    approved_at: new Date().toISOString(),
    approved_version_id: versionId,
  };
  if (comment !== undefined) {
    record.comment = comment;
  }
  return record;
}

export function buildChangesRequestedApprovalRecord(
  userId: string,
  feedback: string,
): ApprovalRecord {
  return {
    state: 'changes_requested',
    approved_by: userId,
    approved_at: new Date().toISOString(),
    approved_version_id: null,
    feedback,
  };
}

export function buildReviewRatingRecord(
  rating: number,
  userId: string,
): ReviewRatingRecord {
  return {
    value: rating,
    rated_by: userId,
    rated_at: new Date().toISOString(),
  };
}

export function validateReviewRating(rating: unknown): ReviewRatingValidationResult {
  if (rating === undefined || rating === null) {
    return { ok: false, error: 'Rating is required when approving retros' };
  }
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return { ok: false, error: 'Rating must be an integer between 1 and 5' };
  }
  return { ok: true, value: ratingNum };
}

// =============================================================================
// Invalidate on edit
// =============================================================================

export function markChangedSinceApproved(
  currentApproval: ApprovalRecord | null | undefined,
): ApprovalRecord | undefined {
  if (currentApproval?.state !== 'approved') {
    return undefined;
  }
  return {
    ...currentApproval,
    state: 'changed_since_approved',
  };
}

export function applyChangedSinceApprovedOnEdit<T extends Record<string, unknown>>(
  props: T,
  approvalKey: ApprovalHistoryField,
  currentApproval: ApprovalRecord | null | undefined,
  contentChanged: boolean,
): T {
  if (!contentChanged) {
    return props;
  }
  const updated = markChangedSinceApproved(currentApproval);
  if (!updated) {
    return props;
  }
  return {
    ...props,
    [approvalKey]: updated,
  };
}

// =============================================================================
// Comments (sprint approvals)
// =============================================================================

/**
 * Parse optional approval comment from request body.
 * `comment` is considered "provided" only when the key exists in the payload.
 */
export function parseApprovalComment(body: unknown): ParsedApprovalComment {
  if (!body || typeof body !== 'object') {
    return { provided: false, value: null };
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'comment')) {
    return { provided: false, value: null };
  }

  const raw = (body as Record<string, unknown>).comment;
  if (raw === null || raw === undefined) {
    return { provided: true, value: null };
  }

  if (typeof raw !== 'string') {
    return { provided: true, value: null, error: 'Comment must be a string' };
  }

  if (raw.length > 2000) {
    return { provided: true, value: null, error: 'Comment must be 2000 characters or less' };
  }

  const trimmed = raw.trim();
  return { provided: true, value: trimmed.length > 0 ? trimmed : null };
}

export function resolveApprovalComment(
  parsed: ParsedApprovalComment,
  previousApproval: ApprovalRecord | null,
): string | null {
  const previousComment = typeof previousApproval?.comment === 'string'
    ? previousApproval.comment
    : null;
  return parsed.provided ? parsed.value : (previousComment ?? null);
}

export function getApprovalComment(previousApproval: ApprovalRecord | null): string | null {
  return typeof previousApproval?.comment === 'string' ? previousApproval.comment : null;
}

// =============================================================================
// Version + history logging
// =============================================================================

export async function resolveApprovedVersionId(
  documentId: string,
  historyField: string,
): Promise<number | null> {
  const historyEntry = await getLatestDocumentFieldHistory(documentId, historyField);
  return historyEntry?.id ?? null;
}

export async function logApprovalPropertyChangeIfCommentChanged(
  documentId: string,
  historyField: ApprovalHistoryField,
  previousApproval: ApprovalRecord | null,
  previousComment: string | null,
  newApproval: ApprovalRecord,
  userId: string,
): Promise<void> {
  const resolvedComment = typeof newApproval.comment === 'string' ? newApproval.comment : null;
  if (previousComment === resolvedComment) {
    return;
  }
  await logDocumentChange(
    documentId,
    historyField,
    previousApproval ? JSON.stringify(previousApproval) : null,
    JSON.stringify(newApproval),
    userId,
  );
}

export async function logApprovalRevoked(
  documentId: string,
  historyField: ApprovalHistoryField,
  previousApproval: ApprovalRecord | null | undefined,
  userId: string,
): Promise<void> {
  await logDocumentChange(
    documentId,
    historyField,
    previousApproval ? JSON.stringify(previousApproval) : null,
    null,
    userId,
  );
}

export function asApprovalRecord(value: unknown): ApprovalRecord | null {
  if (!isJsonRecord(value) || !hasApprovalShape(value)) {
    return null;
  }

  const rawState = value.state ?? null;
  if (rawState !== null && (typeof rawState !== 'string' || !APPROVAL_STATES.has(rawState as ApprovalState))) {
    return null;
  }
  const state = rawState as ApprovalState | null;

  const approvedBy = hasOwn(value, 'approved_by')
    ? parseNullableString(value.approved_by)
    : null;
  const approvedAt = hasOwn(value, 'approved_at')
    ? parseNullableString(value.approved_at)
    : null;
  const approvedVersionId = hasOwn(value, 'approved_version_id')
    ? parseNullableVersionId(value.approved_version_id)
    : null;
  if (approvedBy === undefined || approvedAt === undefined || approvedVersionId === undefined) {
    return null;
  }

  let feedback: string | null | undefined;
  if (hasOwn(value, 'feedback')) {
    feedback = parseNullableString(value.feedback);
    if (feedback === undefined) {
      return null;
    }
  }

  let comment: string | null | undefined;
  if (hasOwn(value, 'comment')) {
    comment = parseNullableString(value.comment);
    if (comment === undefined) {
      return null;
    }
  }

  const record: ApprovalRecord = {
    state,
    approved_by: approvedBy ?? null,
    approved_at: approvedAt ?? null,
    approved_version_id: approvedVersionId ?? null,
  };

  if (hasOwn(value, 'feedback')) {
    record.feedback = feedback;
  }
  if (hasOwn(value, 'comment')) {
    record.comment = comment;
  }

  return record;
}
