/**
 * Standup schemas - Standalone daily updates (date-based)
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, DateSchema } from './common.js';
import { IdParamSchema } from './route-helpers.js';

// ============== Standup Response ==============

export const StandupResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  document_type: z.literal('standup'),
  content: z.record(z.unknown()).nullable(),
  properties: z.record(z.unknown()).nullable().openapi({
    description: 'Properties including author_id and date',
  }),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('Standup');

registry.register('Standup', StandupResponseSchema);

export const StandupsListResponseSchema = z.array(StandupResponseSchema).openapi('StandupsList');

registry.register('StandupsList', StandupsListResponseSchema);

// ============== Standup Status ==============

export const StandupStatusSchema = z.object({
  due: z.boolean().openapi({
    description: 'True if user has active sprint but has not posted today',
  }),
  lastPosted: DateTimeSchema.nullable().openapi({
    description: 'Timestamp of last standup posted',
  }),
}).openapi('StandupStatus');

registry.register('StandupStatus', StandupStatusSchema);

// ============== Create/Update Standup ==============

export const CreateStandupSchema = z.object({
  date: DateSchema.openapi({ description: 'Date for the standup (YYYY-MM-DD)' }),
}).openapi('CreateStandup');

registry.register('CreateStandup', CreateStandupSchema);

export const UpdateStandupSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.record(z.unknown()).optional(),
}).openapi('UpdateStandup');

registry.register('UpdateStandup', UpdateStandupSchema);

export const ListStandupsQuerySchema = z.object({
  date_from: DateSchema.openapi({ description: 'Start date (YYYY-MM-DD)' }),
  date_to: DateSchema.openapi({ description: 'End date (YYYY-MM-DD)' }),
}).openapi('ListStandupsQuery');

registry.register('ListStandupsQuery', ListStandupsQuerySchema);

export const StandupIdParamsSchema = IdParamSchema.openapi('StandupIdParams');

export const UpdatedStandupResponseSchema = z.object({
  id: UuidSchema,
  sprint_id: UuidSchema.nullable(),
  title: z.string(),
  content: z.record(z.unknown()).nullable(),
  author_id: z.string(),
  author_name: z.string().nullable(),
  author_email: z.string().nullable(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('UpdatedStandup');

registry.register('UpdatedStandup', UpdatedStandupResponseSchema);

export const StandupLegacyErrorSchema = z.object({
  error: z.string(),
}).openapi('StandupLegacyError');

registry.register('StandupLegacyError', StandupLegacyErrorSchema);
