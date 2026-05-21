/**
 * Shared OpenAPI registration helpers (DRY response envelopes and params).
 */

import { z } from 'zod';
import { UuidSchema } from './common.js';

export const IdParamSchema = z.object({
  id: UuidSchema,
});

export const TokenParamSchema = z.object({
  token: z.string().min(1),
});

export function successEnvelope<T extends z.ZodTypeAny>(dataSchema: T, name?: string) {
  const schema = z.object({
    success: z.literal(true),
    data: dataSchema,
  });
  return name ? schema.openapi(name) : schema;
}

export const JsonObjectSchema = z.record(z.unknown());

export {
  ApiErrorBodySchema,
  ApiErrorResponseSchema,
  SuccessResponseSchema as SuccessOnlyResponseSchema,
} from './common.js';

export const EmptySuccessSchema = successEnvelope(z.object({}).passthrough(), 'EmptySuccessData');

export const standardErrorResponse = {
  400: { description: 'Validation error' },
  401: { description: 'Not authenticated' },
  403: { description: 'Forbidden' },
  404: { description: 'Not found' },
  500: { description: 'Internal server error' },
} as const;

export function jsonResponse(schema: z.ZodTypeAny, description: string) {
  return {
    description,
    content: {
      'application/json': { schema },
    },
  };
}
