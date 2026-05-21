/**
 * Typed route wrapper: registers OpenAPI paths and parses request inputs once.
 * Pilot for collapsing split-brain between route handlers and OpenAPI schemas.
 */

import type { Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';

import { registry } from './registry.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type RouteRequestSchemas = {
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
};

type RouteResponseSchema = {
  schema: z.ZodTypeAny;
  description?: string;
};

export type DefineRouteConfig<TParsed extends RouteRequestSchemas> = {
  method: HttpMethod;
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  operationId?: string;
  security?: Array<Record<string, string[]>>;
  request?: TParsed;
  responses: Record<number, RouteResponseSchema>;
  handler: (
    req: Request,
    res: Response,
    parsed: {
      params: TParsed['params'] extends z.ZodTypeAny ? z.infer<TParsed['params']> : undefined;
      query: TParsed['query'] extends z.ZodTypeAny ? z.infer<TParsed['query']> : undefined;
      body: TParsed['body'] extends z.ZodTypeAny ? z.infer<TParsed['body']> : undefined;
    }
  ) => void | Promise<void>;
};

export type DefinedRouteMetadata = {
  method: HttpMethod;
  path: string;
  responses: Record<number, { openApiSchemaName: string; schema: z.ZodTypeAny }>;
};

function registerOpenApiResponses(
  config: DefineRouteConfig<RouteRequestSchemas>
): DefinedRouteMetadata['responses'] {
  const metadata: DefinedRouteMetadata['responses'] = {};

  const openApiResponses: Record<number, { description: string; content?: Record<string, { schema: z.ZodTypeAny }> }> = {};
  for (const [statusCode, responseConfig] of Object.entries(config.responses)) {
    const status = Number(statusCode);
    const schema = responseConfig.schema;
    const schemaName = schema._def.openapi?.metadata?.refId ?? schema._def.openapi?.metadata?.title;
    if (typeof schemaName === 'string') {
      metadata[status] = { openApiSchemaName: schemaName, schema };
    }
    openApiResponses[status] = {
      description: responseConfig.description ?? `Response ${status}`,
      content: {
        'application/json': { schema },
      },
    };
  }

  registry.registerPath({
    method: config.method,
    path: config.path,
    tags: config.tags,
    summary: config.summary,
    description: config.description,
    operationId: config.operationId,
    security: config.security,
    request: config.request
      ? ({
          params: config.request.params,
          query: config.request.query,
          body: config.request.body
            ? { content: { 'application/json': { schema: config.request.body } } }
            : undefined,
        } as Parameters<typeof registry.registerPath>[0]['request'])
      : undefined,
    responses: openApiResponses,
  });

  return metadata;
}

function parsePart<T extends z.ZodTypeAny | undefined>(
  value: unknown,
  schema: T,
  label: string
): T extends z.ZodTypeAny ? z.infer<T> : undefined {
  if (!schema) {
    return undefined as T extends z.ZodTypeAny ? z.infer<T> : undefined;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new RouteValidationError(`${label} validation failed: ${message}`);
  }
  return parsed.data;
}

export class RouteValidationError extends Error {
  readonly statusCode = 400;
}

export function defineRoute<T extends RouteRequestSchemas>(
  config: DefineRouteConfig<T>
): RequestHandler & { openApi: DefinedRouteMetadata } {
  const openApiResponses = registerOpenApiResponses(config);

  const handler: RequestHandler = async (req, res) => {
    try {
      await config.handler(req, res, {
        params: parsePart(req.params, config.request?.params, 'params'),
        query: parsePart(req.query, config.request?.query, 'query'),
        body: parsePart(req.body, config.request?.body, 'body'),
      });
    } catch (error) {
      if (error instanceof RouteValidationError) {
        res.status(error.statusCode).json({
          error: 'validation_error',
          message: error.message,
        });
        return;
      }
      throw error;
    }
  };

  return Object.assign(handler, {
    openApi: {
      method: config.method,
      path: config.path,
      responses: openApiResponses,
    },
  });
}
