/**
 * Comment schemas - Inline document comments with threading and resolve
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, UserReferenceSchema } from './common.js';

// ============== Comment Response ==============

export const CommentResponseSchema = z.object({
  id: UuidSchema,
  document_id: UuidSchema,
  comment_id: UuidSchema.openapi({ description: 'Thread identifier matching TipTap mark commentId' }),
  parent_id: UuidSchema.nullable().openapi({ description: 'Parent comment ID for replies, null for root comments' }),
  content: z.string(),
  resolved_at: DateTimeSchema.nullable().openapi({ description: 'When the thread was resolved, null if unresolved' }),
  author: UserReferenceSchema,
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('CommentResponse');

registry.register('CommentResponse', CommentResponseSchema);

// ============== Create Comment ==============

export const CreateCommentSchema = z.object({
  comment_id: UuidSchema.openapi({ description: 'Thread identifier (generated client-side, matches TipTap mark)' }),
  content: z.string().min(1).max(10000),
  parent_id: UuidSchema.optional().openapi({ description: 'Parent comment ID to reply to' }),
}).openapi('CreateComment');

registry.register('CreateComment', CreateCommentSchema);

// ============== Update Comment ==============

export const UpdateCommentSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  resolved_at: DateTimeSchema.nullable().optional().openapi({
    description: 'Set to ISO datetime to resolve, null to un-resolve',
  }),
}).openapi('UpdateComment');

registry.register('UpdateComment', UpdateCommentSchema);

// ============== Register Paths ==============

registry.registerPath({
  method: 'get',
  path: '/documents/{id}/comments',
  operationId: 'list_document_comments',
  summary: 'List comments for a document',
  tags: ['Comments'],
  request: {
    params: z.object({ id: UuidSchema }),
  },
  responses: {
    200: {
      description: 'List of comments grouped by thread',
      content: { 'application/json': { schema: z.array(CommentResponseSchema) } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/documents/{id}/comments',
  operationId: 'create_document_comment',
  summary: 'Create a comment on a document',
  tags: ['Comments'],
  request: {
    params: z.object({ id: UuidSchema }),
    body: { content: { 'application/json': { schema: CreateCommentSchema } } },
  },
  responses: {
    201: {
      description: 'Created comment',
      content: { 'application/json': { schema: CommentResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/comments/{id}',
  operationId: 'update_comment',
  summary: 'Update a comment (edit content or resolve/un-resolve)',
  tags: ['Comments'],
  request: {
    params: z.object({ id: UuidSchema }),
    body: { content: { 'application/json': { schema: UpdateCommentSchema } } },
  },
  responses: {
    200: {
      description: 'Updated comment',
      content: { 'application/json': { schema: CommentResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/comments/{id}',
  operationId: 'delete_comment',
  summary: 'Delete a comment',
  tags: ['Comments'],
  request: {
    params: z.object({ id: UuidSchema }),
  },
  responses: {
    200: {
      description: 'Comment deleted',
      content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
    },
  },
});
