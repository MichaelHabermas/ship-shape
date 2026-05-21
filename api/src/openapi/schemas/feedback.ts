/**
 * Feedback schemas - public submission and authenticated read
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema } from './common.js';
import { jsonResponse, successEnvelope, IdParamSchema } from './route-helpers.js';

const FeedbackItemSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  state: z.string(),
  ticket_number: z.number().int().nullable().optional(),
  program_id: UuidSchema.nullable().optional(),
  program_name: z.string().nullable().optional(),
  program_prefix: z.string().nullable().optional(),
  program_color: z.string().nullable().optional(),
  content: z.unknown().optional(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
  created_by_name: z.string().nullable().optional(),
}).passthrough().openapi('FeedbackItem');

registry.register('FeedbackItem', FeedbackItemSchema);

const CreateFeedbackRequestSchema = z.object({
  title: z.string().min(1).max(500),
  program_id: UuidSchema,
  submitter_email: z.string().email().optional(),
  content: z.unknown().optional(),
}).openapi('CreateFeedbackRequest');

registry.register('CreateFeedbackRequest', CreateFeedbackRequestSchema);

const FeedbackResponseSchema = successEnvelope(FeedbackItemSchema, 'FeedbackResponse');
registry.register('FeedbackResponse', FeedbackResponseSchema);

export const FeedbackProgramPublicSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  prefix: z.string().nullable(),
  color: z.string().nullable().optional(),
}).openapi('FeedbackProgramPublic');

registry.register('FeedbackProgramPublic', FeedbackProgramPublicSchema);

registry.registerPath({
  method: 'post',
  path: '/feedback',
  tags: ['Feedback'],
  summary: 'Submit public feedback',
  security: [],
  request: {
    body: {
      content: {
        'application/json': { schema: CreateFeedbackRequestSchema },
      },
    },
  },
  responses: {
    201: jsonResponse(FeedbackItemSchema, 'Feedback created'),
    400: { description: 'Validation error' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/feedback/program/{programId}',
  tags: ['Feedback'],
  summary: 'Get public program info for feedback form',
  security: [],
  request: {
    params: z.object({ programId: UuidSchema }),
  },
  responses: {
    200: jsonResponse(FeedbackProgramPublicSchema, 'Program metadata'),
    404: { description: 'Program not found' },
    500: { description: 'Internal server error' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/feedback/{id}',
  tags: ['Feedback'],
  summary: 'Get feedback by ID',
  request: { params: IdParamSchema },
  responses: {
    200: jsonResponse(FeedbackResponseSchema, 'Feedback details'),
    404: { description: 'Feedback not found' },
    500: { description: 'Internal server error' },
  },
});
