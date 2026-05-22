/**
 * Feedback schemas - public submission and authenticated read
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema } from './common.js';
import { IdParamSchema } from './route-helpers.js';

export const FeedbackItemSchema = z.object({
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

export const CreateFeedbackRequestSchema = z.object({
  title: z.string().min(1).max(500),
  program_id: UuidSchema,
  submitter_email: z.string().email().optional(),
  content: z.unknown().optional(),
}).openapi('CreateFeedbackRequest');

registry.register('CreateFeedbackRequest', CreateFeedbackRequestSchema);

export const FeedbackProgramPublicSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  prefix: z.string().nullable(),
  color: z.string().nullable().optional(),
}).openapi('FeedbackProgramPublic');

registry.register('FeedbackProgramPublic', FeedbackProgramPublicSchema);

export const FeedbackIdParamsSchema = IdParamSchema.openapi('FeedbackIdParams');

export const FeedbackProgramParamsSchema = z.object({
  programId: UuidSchema,
}).openapi('FeedbackProgramParams');

export const FeedbackLegacyErrorSchema = z.object({
  error: z.string(),
  details: z.array(z.unknown()).optional(),
}).passthrough().openapi('FeedbackLegacyError');

registry.register('FeedbackLegacyError', FeedbackLegacyErrorSchema);
