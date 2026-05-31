// Validates supertest JSON responses against registered OpenAPI schemas via Zod.
import { expect } from 'vitest';
import type { z } from 'zod';

import { swaggerSpec } from '../swagger.js';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type JsonResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type ExpectedOpenApiResponse<TData> = {
  method: HttpMethod;
  path: string;
  status: number;
  response: JsonResponse;
  openApiSchemaName: string;
  schema: z.ZodType<TData>;
  /** When the OpenAPI response is an array of $ref items instead of a top-level $ref */
  arrayItemSchemaName?: string;
};

function getRecordValue(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

export function expectOpenApiResponse<TData>({
  method,
  path,
  status,
  response,
  openApiSchemaName,
  schema,
  arrayItemSchemaName,
}: ExpectedOpenApiResponse<TData>): TData {
  expect(response.status).toBe(status);

  const pathSpec = getRecordValue(swaggerSpec.paths, path);
  const operation = getRecordValue(pathSpec, method);
  expect(operation, `${method.toUpperCase()} ${path} must be registered in OpenAPI`).toBeDefined();

  const responses = getRecordValue(operation, 'responses');
  const responseSpec = getRecordValue(responses, String(status)) ?? getRecordValue(responses, 'default');
  expect(
    responseSpec,
    `${method.toUpperCase()} ${path} must declare OpenAPI response ${status}`
  ).toBeDefined();

  const content = getRecordValue(responseSpec, 'content');
  const jsonContent = getRecordValue(content, 'application/json');
  const responseSchema = getRecordValue(jsonContent, 'schema');
  expect(
    responseSchema,
    `${method.toUpperCase()} ${path} ${status} must declare an application/json schema`
  ).toBeDefined();

  if (arrayItemSchemaName) {
    expect(responseSchema).toEqual({
      type: 'array',
      items: { $ref: `#/components/schemas/${arrayItemSchemaName}` },
    });
  } else {
    expect(
      responseSchema,
      `${method.toUpperCase()} ${path} ${status} must use OpenAPI schema ${openApiSchemaName}`
    ).toEqual({ $ref: `#/components/schemas/${openApiSchemaName}` });
  }

  expect(response.headers['content-type']).toMatch(/application\/json/);

  const parsed = schema.safeParse(response.body);
  expect(
    parsed.success,
    parsed.success ? undefined : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n')
  ).toBe(true);

  if (!parsed.success) {
    throw new Error('OpenAPI response schema validation failed');
  }
  return parsed.data;
}
