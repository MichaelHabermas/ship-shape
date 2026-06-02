// Public API v1 router mounts public contract and OAuth-authenticated resource routes.
import { Router, type Request, type Response } from 'express';
import { publicDocumentsRouter } from './documents.js';
import { publicIssuesRouter } from './issues.js';
import { publicApiAuditMiddleware, publicApiRateLimitMiddleware } from './middleware.js';
import { publicMeRouter } from './me.js';
import { publicSprintsRouter } from './sprints.js';
import { publicWebhooksRouter } from './webhooks.js';
import { sendPublicApiError } from './errors.js';
import { generatePublicOpenApiDocument } from './openapi.js';
import { publicOpenApiRouteMetadata } from './route-metadata.js';

export const publicApiV1Router = Router();

publicApiV1Router.use(publicApiRateLimitMiddleware);
publicApiV1Router.use(publicApiAuditMiddleware);
publicApiV1Router.get(publicOpenApiRouteMetadata.handlerMountPath, (req: Request, res: Response): void => {
  try {
    res.setHeader('Content-Type', 'application/json');
    res.json(generatePublicOpenApiDocument());
  } catch {
    req.publicApiErrorCode = 'server_error';
    sendPublicApiError(res, 500, {
      code: 'server_error',
      message: 'OpenAPI generation failed',
      request_id: req.publicApiRequestId ?? 'unknown',
    });
  }
});
publicApiV1Router.use(publicDocumentsRouter);
publicApiV1Router.use(publicIssuesRouter);
publicApiV1Router.use(publicMeRouter);
publicApiV1Router.use(publicSprintsRouter);
publicApiV1Router.use(publicWebhooksRouter);
publicApiV1Router.use((req: Request, res: Response): void => {
  req.publicApiErrorCode = 'not_found';
  sendPublicApiError(res, 404, {
    code: 'not_found',
    message: 'Route not found',
    request_id: req.publicApiRequestId ?? 'unknown',
  });
});
