// Public API middleware validates OAuth bearer tokens and records per-request audit rows.
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../../../db/client.js';
import { isDevEnv, isTestEnv } from '../../../config/runtime.js';
import { logHotError } from '../../../utils/hot-log.js';
import { validateOAuthAccessToken, type OAuthAccessTokenContext } from '../../oauth/tokens.js';
import type { PublicApiScope } from '../../scopes/registry.js';
import { sendPublicApiError, type PublicApiErrorCode } from './errors.js';

export type PublicApiRequestContext = OAuthAccessTokenContext & {
  requestId: string;
  routePath?: string;
  requiredScope: PublicApiScope | null;
};

const MAX_PUBLIC_API_REQUEST_ID_LENGTH = 128;

declare global {
  namespace Express {
    interface Request {
      publicApi?: PublicApiRequestContext;
      publicApiErrorCode?: PublicApiErrorCode;
      publicApiRequestId?: string;
    }
  }
}

export function publicApiAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.publicApiRequestId = publicApiRequestIdFromRequest(req);
  const startedAt = Date.now();
  const originalEnd = res.end;
  const originalEndCall = originalEnd as unknown as (...args: unknown[]) => Response;
  let recorded = false;

  res.end = function publicApiAuditEnd(...args: unknown[]): Response {
    if (recorded) {
      return originalEndCall.apply(res, args);
    }
    recorded = true;
    const context = req.publicApi;
    const route = context?.routePath ?? `${req.baseUrl}${req.path}`;
    const latencyMs = Math.max(0, Date.now() - startedAt);
    void pool.query(
      `INSERT INTO public_api_audit_logs (
         request_id,
         app_id,
         client_id,
         user_id,
         workspace_id,
         method,
         route,
         scope_used,
         status,
         latency_ms,
         error_code
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        context?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req),
        context?.appId ?? null,
        context?.clientId ?? null,
        context?.userId ?? null,
        context?.workspaceId ?? null,
        req.method,
        route,
        context?.requiredScope ?? null,
        res.statusCode,
        latencyMs,
        req.publicApiErrorCode ?? null,
      ]
    ).then(() => {
      originalEndCall.apply(res, args);
    }).catch((error) => {
      logHotError('public_api.audit', 'Failed to record public API audit row', error, {
        route,
        status: res.statusCode,
      });
      if (res.headersSent) {
        originalEndCall.apply(res, args);
        return;
      }

      req.publicApiErrorCode = 'server_error';
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      const body = JSON.stringify({
        code: 'server_error',
        message: 'Audit logging failed',
        request_id: context?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req),
      });
      res.setHeader('content-length', Buffer.byteLength(body));
      originalEndCall.call(res, body);
    });
    return res;
  } as Response['end'];

  next();
}

export const publicApiRateLimitMiddleware = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv() ? 10000 : isDevEnv() ? 1000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const requestId = req.publicApiRequestId ?? publicApiRequestIdFromRequest(req);
    req.publicApiRequestId = requestId;
    req.publicApiErrorCode = 'rate_limited';
    sendPublicApiError(res, 429, {
      code: 'rate_limited',
      message: 'Too many requests. Please slow down.',
      request_id: requestId,
    });
  },
});

export function requirePublicApiBearer(requiredScope: PublicApiScope | null) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = publicApiRequestIdFromRequest(req);
    req.publicApiRequestId = requestId;
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      sendUnauthorized(req, res, requestId, 'Missing bearer token');
      return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      sendUnauthorized(req, res, requestId, 'Missing bearer token');
      return;
    }

    try {
      const validation = await validateOAuthAccessToken(token);
      if (!validation.ok) {
        sendUnauthorized(req, res, requestId, 'Invalid bearer token', validation.reason);
        return;
      }

      req.publicApi = {
        ...validation.context,
        requestId,
        requiredScope,
      };

      if (requiredScope && !validation.context.grantedScopes.includes(requiredScope)) {
        req.publicApiErrorCode = 'forbidden';
        sendPublicApiError(res, 403, {
          code: 'forbidden',
          message: `Missing required scope: ${requiredScope}`,
          details: { missing_scope: requiredScope },
          request_id: requestId,
        });
        return;
      }

      next();
    } catch (error) {
      logHotError('public_api.auth', 'Public API bearer validation failed', error);
      req.publicApiErrorCode = 'server_error';
      sendPublicApiError(res, 500, {
        code: 'server_error',
        message: 'Authentication failed',
        request_id: requestId,
      });
    }
  };
}

export function markPublicApiRoute(req: Request, routePath: string): void {
  if (req.publicApi) {
    req.publicApi.routePath = routePath;
  }
}

export function publicApiAsyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      logHotError('public_api.route', 'Public API route failed', error, {
        route: req.publicApi?.routePath,
      });
      req.publicApiErrorCode = 'server_error';
      sendPublicApiError(res, 500, {
        code: 'server_error',
        message: 'Request failed',
        request_id: req.publicApi?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req),
      });
    }
  };
}

export function publicApiRequestIdFromRequest(req: Request): string {
  const header = req.headers['x-request-id'];
  const requestId = Array.isArray(header) ? header[0] : header;
  if (
    typeof requestId === 'string' &&
    requestId.trim() &&
    requestId.length <= MAX_PUBLIC_API_REQUEST_ID_LENGTH
  ) {
    return requestId;
  }
  return crypto.randomUUID();
}

function sendUnauthorized(
  req: Request,
  res: Response,
  requestId: string,
  message: string,
  reason?: string
): void {
  req.publicApiErrorCode = 'unauthorized';
  sendPublicApiError(res, 401, {
    code: 'unauthorized',
    message,
    ...(reason === 'access_token_expired' ? { details: { reason } } : {}),
    request_id: requestId,
  });
}
