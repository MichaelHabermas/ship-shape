// Public API v1 router mounts OAuth-authenticated public routes only.
import { Router, type Request, type Response } from 'express';
import { publicApiAuditMiddleware, publicApiRateLimitMiddleware } from './middleware.js';
import { publicMeRouter } from './me.js';
import { sendPublicApiError } from './errors.js';

export const publicApiV1Router = Router();

publicApiV1Router.use(publicApiRateLimitMiddleware);
publicApiV1Router.use(publicApiAuditMiddleware);
publicApiV1Router.use(publicMeRouter);
publicApiV1Router.use((req: Request, res: Response): void => {
  req.publicApiErrorCode = 'not_found';
  sendPublicApiError(res, 404, {
    code: 'not_found',
    message: 'Route not found',
    request_id: req.publicApiRequestId ?? 'unknown',
  });
});
