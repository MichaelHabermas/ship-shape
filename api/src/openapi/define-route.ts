/**
 * Typed route wrapper: registers OpenAPI paths and parses request inputs once.
 * Pilot for collapsing split-brain between route handlers and OpenAPI schemas.
 */

import type { Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';

import { ERROR_CODES } from '@ship/shared';
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

type ZodOpenApiMetadata = {
  openapi?: {
    metadata?: {
      refId?: unknown;
      title?: unknown;
    };
  };
};

type InferParsedPart<TPart> = NonNullable<TPart> extends z.ZodTypeAny
  ? z.infer<NonNullable<TPart>>
  : undefined;

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
  validationError?: (res: Response, error: RouteValidationError) => void;
  handler: (
    req: Request,
    res: Response,
    parsed: {
      params: InferParsedPart<TParsed['params']>;
      query: InferParsedPart<TParsed['query']>;
      body: InferParsedPart<TParsed['body']>;
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
    const schemaDef = schema._def as ZodOpenApiMetadata;
    const schemaName = schemaDef.openapi?.metadata?.refId ?? schemaDef.openapi?.metadata?.title;
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

  const pathConfig: Parameters<typeof registry.registerPath>[0] = {
    method: config.method,
    path: config.path,
    tags: config.tags,
    summary: config.summary,
    security: config.security,
    request: config.request
      ? ({
          params: config.request.params,
          query: config.request.query,
          body: config.request.body
            ? { required: true, content: { 'application/json': { schema: config.request.body } } }
            : undefined,
        } as Parameters<typeof registry.registerPath>[0]['request'])
      : undefined,
    responses: openApiResponses,
  };

  if (config.description !== undefined) {
    pathConfig.description = config.description;
  }
  if (config.operationId !== undefined) {
    pathConfig.operationId = config.operationId;
  }

  registry.registerPath(pathConfig);

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
    throw new RouteValidationError(`${label} validation failed: ${message}`, parsed.error);
  }
  return parsed.data as T extends z.ZodTypeAny ? z.infer<T> : undefined;
}

export class RouteValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string, readonly zodError: z.ZodError) {
    super(message);
  }
}

export function defineRoute<T extends RouteRequestSchemas>(
  config: DefineRouteConfig<T>
): RequestHandler & { openApi: DefinedRouteMetadata } {
  const openApiResponses = registerOpenApiResponses(config);

  const handler: RequestHandler = async (req, res) => {
    try {
      const parsed = {
        params: parsePart(req.params, config.request?.params, 'params') as InferParsedPart<T['params']>,
        query: parsePart(req.query, config.request?.query, 'query') as InferParsedPart<T['query']>,
        body: parsePart(req.body, config.request?.body, 'body') as InferParsedPart<T['body']>,
      };
      await config.handler(req, res, {
        params: parsed.params,
        query: parsed.query,
        body: parsed.body,
      });
    } catch (error) {
      if (error instanceof RouteValidationError) {
        if (config.validationError) {
          config.validationError(res, error);
          return;
        }
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: error.message,
          },
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
