// Parses supertest JSON bodies with Zod when OpenAPI response metadata is not registered.
import { expect } from 'vitest';
import type { z } from 'zod';

type JsonResponse = {
  status: number;
  body: unknown;
};

export function expectJsonBody<TData>(
  response: JsonResponse,
  status: number,
  schema: z.ZodType<TData>
): TData {
  expect(response.status).toBe(status);
  const parsed = schema.safeParse(response.body);
  expect(
    parsed.success,
    parsed.success ? undefined : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n')
  ).toBe(true);
  if (!parsed.success) {
    throw new Error('Response body schema validation failed');
  }
  return parsed.data;
}
