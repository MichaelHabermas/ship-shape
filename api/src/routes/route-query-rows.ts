// Shared PostgreSQL row types and response mappers for route handlers.
import type { StandupProperties } from '@ship/shared';
import { requireFirstRow } from '../utils/query-rows.js';

export type IdRow = { id: string };

export type UserReferenceRow = {
  id: string;
  name: string;
  email: string;
};

export type CommentRow = {
  id: string;
  document_id: string;
  comment_id: string;
  parent_id: string | null;
  author_id: string | null;
  workspace_id: string;
  content: string;
  resolved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CommentWithAuthorRow = CommentRow & {
  author_name: string;
  author_email: string;
};

export type CommentResponse = {
  id: string;
  document_id: string;
  comment_id: string;
  parent_id: string | null;
  content: string;
  resolved_at: string | null;
  author: UserReferenceRow;
  created_at: string;
  updated_at: string;
};

export type StandupDocumentRow = {
  id: string;
  title: string;
  content: unknown;
  properties: StandupProperties | Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SprintIterationRow = {
  id: string;
  sprint_id: string;
  workspace_id: string;
  story_id: string | null;
  story_title: string;
  status: 'pass' | 'fail' | 'in_progress';
  what_attempted: string | null;
  blockers_encountered: string | null;
  author_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SprintIterationWithAuthorRow = SprintIterationRow & {
  author_name: string;
  author_email: string;
};

export type SprintIterationResponse = {
  id: string;
  sprint_id: string;
  story_id: string | null;
  story_title: string;
  status: 'pass' | 'fail' | 'in_progress';
  what_attempted: string | null;
  blockers_encountered: string | null;
  author: UserReferenceRow;
  created_at: string;
  updated_at: string;
};

function toIsoDateTime(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function mapCommentResponse(row: CommentWithAuthorRow): CommentResponse {
  return {
    id: row.id,
    document_id: row.document_id,
    comment_id: row.comment_id,
    parent_id: row.parent_id,
    content: row.content,
    resolved_at: toIsoDateTime(row.resolved_at),
    author: {
      id: row.author_id ?? '',
      name: row.author_name,
      email: row.author_email,
    },
    created_at: toIsoDateTime(row.created_at) ?? '',
    updated_at: toIsoDateTime(row.updated_at) ?? '',
  };
}

export function mapCommentWithAuthor(
  comment: CommentRow,
  author: UserReferenceRow
): CommentResponse {
  return mapCommentResponse({
    ...comment,
    author_name: author.name,
    author_email: author.email,
  });
}

export function mapSprintIterationResponse(row: SprintIterationWithAuthorRow): SprintIterationResponse {
  return {
    id: row.id,
    sprint_id: row.sprint_id,
    story_id: row.story_id,
    story_title: row.story_title,
    status: row.status,
    what_attempted: row.what_attempted,
    blockers_encountered: row.blockers_encountered,
    author: {
      id: row.author_id,
      name: row.author_name,
      email: row.author_email,
    },
    created_at: toIsoDateTime(row.created_at) ?? '',
    updated_at: toIsoDateTime(row.updated_at) ?? '',
  };
}

export function asStandupProperties(raw: unknown): StandupProperties {
  if (!raw || typeof raw !== 'object') {
    return { author_id: '' };
  }
  const record = raw as Record<string, unknown>;
  const authorId = typeof record.author_id === 'string' ? record.author_id : '';
  const date = typeof record.date === 'string' ? record.date : undefined;
  const submittedAt =
    record.submitted_at === null || typeof record.submitted_at === 'string'
      ? record.submitted_at
      : undefined;
  return {
    author_id: authorId,
    ...(date !== undefined ? { date } : {}),
    ...(submittedAt !== undefined ? { submitted_at: submittedAt } : {}),
  };
}

export function mapStandupDocumentResponse(row: StandupDocumentRow) {
  return {
    id: row.id,
    title: row.title,
    document_type: 'standup' as const,
    content: row.content,
    properties: asStandupProperties(row.properties),
    created_at: toIsoDateTime(row.created_at) ?? '',
    updated_at: toIsoDateTime(row.updated_at) ?? '',
  };
}

export { requireFirstRow };
