// Asserts API error JSON responses against OpenAPI-registered error schemas.
import type { z } from 'zod';
import { ApiErrorResponseSchema } from '../openapi/schemas/common.js';
import { expectOpenApiResponse } from './openapi-response.js';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type JsonResponse = {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type ExpectedApiErrorResponse<TData> = {
  method: HttpMethod;
  path: string;
  status: number;
  response: JsonResponse;
  openApiSchemaName?: string;
  schema?: z.ZodType<TData>;
};

export function expectApiErrorResponse<TData>({
  method,
  path,
  status,
  response,
  openApiSchemaName = 'ApiErrorResponse',
  schema,
}: ExpectedApiErrorResponse<TData>): TData {
  return expectOpenApiResponse({
    method,
    path,
    status,
    response,
    openApiSchemaName,
    schema: schema ?? (ApiErrorResponseSchema as z.ZodType<TData>),
  });
}
