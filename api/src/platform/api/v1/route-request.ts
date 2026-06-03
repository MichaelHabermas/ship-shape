// OperationId-keyed request parsers keep handlers aligned with OpenAPI contracts.
import type { z } from 'zod';
import {
  publicRouteOpenApiContracts,
  type PublicRouteOpenApiContract,
  type RegistryOperationId,
} from './route-openapi-contracts.js';

export type PublicRouteParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

function contractFor(operationId: RegistryOperationId): PublicRouteOpenApiContract {
  const contract = publicRouteOpenApiContracts[operationId];
  if (!contract) throw new Error(`Missing OpenAPI contract for ${operationId}`);
  return contract;
}

export function parsePublicRouteQuery<T extends z.ZodTypeAny>(
  operationId: RegistryOperationId,
  query: unknown,
  schema: T
): PublicRouteParseResult<z.infer<T>> {
  const contractSchema = contractFor(operationId).request?.query;
  if (contractSchema !== schema) {
    throw new Error(`Route request query schema mismatch for ${operationId}`);
  }
  const parsed = schema.safeParse(query);
  if (!parsed.success) return { success: false, error: parsed.error };
  return { success: true, data: parsed.data as z.infer<T> };
}

export function parsePublicRouteParams<T extends z.ZodTypeAny>(
  operationId: RegistryOperationId,
  params: unknown,
  schema: T
): PublicRouteParseResult<z.infer<T>> {
  const contractSchema = contractFor(operationId).request?.params;
  if (contractSchema !== schema) {
    throw new Error(`Route request params schema mismatch for ${operationId}`);
  }
  const parsed = schema.safeParse(params);
  if (!parsed.success) return { success: false, error: parsed.error };
  return { success: true, data: parsed.data as z.infer<T> };
}

export function parsePublicRouteBody<T extends z.ZodTypeAny>(
  operationId: RegistryOperationId,
  body: unknown,
  schema: T
): PublicRouteParseResult<z.infer<T>> {
  const contractSchema = contractFor(operationId).request?.body;
  if (contractSchema !== schema) {
    throw new Error(`Route request body schema mismatch for ${operationId}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { success: false, error: parsed.error };
  return { success: true, data: parsed.data as z.infer<T> };
}
