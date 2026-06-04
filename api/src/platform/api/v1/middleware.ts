// Public API middleware validates OAuth bearer tokens, rate limits, and records audit rows.
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type { PublicApiErrorCode, PublicApiScope } from '@ship/shared';
import { pool } from '../../../db/client.js';
import { isDevEnv, isTestEnv } from '../../../config/runtime.js';
import { logHotError } from '../../../utils/hot-log.js';
import type { Principal } from '../../../security/principal.js';
import { validateOAuthAccessToken, type OAuthAccessTokenContext } from '../../oauth/tokens.js';
import {
  RATE_LIMIT_HEADER_LIMIT,
  RATE_LIMIT_HEADER_REMAINING,
  RATE_LIMIT_HEADER_RESET,
  RATE_LIMIT_HEADER_RETRY_AFTER,
} from '../../ratelimit/headers.js';
import { sendPublicApiError } from './errors.js';

export type PublicApiRequestContext = OAuthAccessTokenContext & {
  requestId: string;
  routePath?: string;
  requiredScopes: readonly PublicApiScope[];
};

const MAX_PUBLIC_API_REQUEST_ID_LENGTH = 128;
const PUBLIC_API_RATE_LIMIT_WINDOW_MS = 60_000;
const PUBLIC_API_TOKEN_LIMIT = isTestEnv() ? 10_000 : isDevEnv() ? 1_000 : 100;
const PUBLIC_API_APP_LIMIT = isTestEnv() ? 20_000 : isDevEnv() ? 2_000 : 500;

type RateBucket = {
  remaining: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

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
        auditScopeUsed(context?.requiredScopes),
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

export function publicApiRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { requestId, result } = consumePublicApiPreAuthRateLimit(req, res);

  if (!result.allowed) {
    req.publicApiErrorCode = 'rate_limited';
    res.setHeader(RATE_LIMIT_HEADER_RETRY_AFTER, String(result.retryAfterSeconds));
    sendPublicApiError(res, 429, {
      code: 'rate_limited',
      message: 'Too many requests. Please slow down.',
      details: { retry_after_seconds: result.retryAfterSeconds },
      request_id: requestId,
    });
    return;
  }

  next();
}

export function consumePublicApiPreAuthRateLimit(
  req: Request,
  res: Response
): {
  requestId: string;
  result: ReturnType<typeof consumePublicApiBucket>;
} {
  const requestId = req.publicApiRequestId ?? publicApiRequestIdFromRequest(req);
  req.publicApiRequestId = requestId;
  const result = consumePublicApiBucket(`ip:${req.ip}`, PUBLIC_API_TOKEN_LIMIT);
  setPublicApiRateLimitHeaders(res, result.limit, result.remaining, result.resetAt);
  return { requestId, result };
}

export function setPublicApiRateLimitBucketForTest(key: string, bucket: RateBucket): void {
  if (!isTestEnv()) throw new Error('setPublicApiRateLimitBucketForTest is test-only');
  rateBuckets.set(key, bucket);
}

export function requirePublicApiBearer(requiredScopes: readonly PublicApiScope[]) {
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
        requiredScopes,
      };

      const tokenLimit = consumePublicApiBucket(`token:${validation.context.tokenId}`, PUBLIC_API_TOKEN_LIMIT);
      mergePublicApiRateLimitHeaders(res, tokenLimit.limit, tokenLimit.remaining, tokenLimit.resetAt);
      if (!tokenLimit.allowed) {
        req.publicApiErrorCode = 'rate_limited';
        res.setHeader(RATE_LIMIT_HEADER_RETRY_AFTER, String(tokenLimit.retryAfterSeconds));
        sendPublicApiError(res, 429, {
          code: 'rate_limited',
          message: 'Too many requests. Please slow down.',
          details: { retry_after_seconds: tokenLimit.retryAfterSeconds },
          request_id: requestId,
        });
        return;
      }

      const appLimit = consumePublicApiBucket(`app:${validation.context.appId}`, PUBLIC_API_APP_LIMIT);
      mergePublicApiRateLimitHeaders(res, appLimit.limit, appLimit.remaining, appLimit.resetAt);
      if (!appLimit.allowed) {
        req.publicApiErrorCode = 'rate_limited';
        res.setHeader(RATE_LIMIT_HEADER_RETRY_AFTER, String(appLimit.retryAfterSeconds));
        sendPublicApiError(res, 429, {
          code: 'rate_limited',
          message: 'Too many requests. Please slow down.',
          details: { retry_after_seconds: appLimit.retryAfterSeconds },
          request_id: requestId,
        });
        return;
      }

      const missingScope = requiredScopes.find((scope) => !validation.context.grantedScopes.includes(scope));
      if (missingScope) {
        req.publicApiErrorCode = 'forbidden';
        sendPublicApiError(res, 403, {
          code: 'forbidden',
          message: `Missing required scope: ${missingScope}`,
          details: { missing_scope: missingScope, required_scopes: requiredScopes },
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

function auditScopeUsed(requiredScopes: readonly PublicApiScope[] | undefined): string | null {
  return requiredScopes && requiredScopes.length > 0 ? requiredScopes.join(' ') : null;
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

export function publicApiPrincipalFromRequest(req: Request): Principal {
  if (!req.publicApi) {
    throw new Error('Public API route is missing OAuth context');
  }
  return {
    kind: 'oauth_access_token',
    tokenId: req.publicApi.tokenId,
    appId: req.publicApi.appId,
    clientId: req.publicApi.clientId,
    userId: req.publicApi.userId,
    workspaceId: req.publicApi.workspaceId,
    isSuperAdmin: false,
    scopes: req.publicApi.grantedScopes,
  };
}

function consumePublicApiBucket(key: string, limit: number): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { remaining: limit, resetAt: now + PUBLIC_API_RATE_LIMIT_WINDOW_MS };

  const allowed = bucket.remaining > 0;
  if (allowed) {
    bucket.remaining -= 1;
  }
  rateBuckets.set(key, bucket);
  return {
    allowed,
    limit,
    remaining: Math.max(0, bucket.remaining),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function setPublicApiRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number
): void {
  res.setHeader(RATE_LIMIT_HEADER_LIMIT, String(limit));
  res.setHeader(RATE_LIMIT_HEADER_REMAINING, String(remaining));
  res.setHeader(RATE_LIMIT_HEADER_RESET, String(Math.ceil(resetAt / 1000)));
}

function mergePublicApiRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number
): void {
  const currentRemaining = Number(res.getHeader(RATE_LIMIT_HEADER_REMAINING));
  const nextRemaining = Number.isFinite(currentRemaining)
    ? Math.min(currentRemaining, remaining)
    : remaining;
  setPublicApiRateLimitHeaders(res, limit, nextRemaining, resetAt);
}

function sendUnauthorized(
  req: Request,
  res: Response,
  requestId: string,
  message: string,
  reason?: string
): void {
  if (reason === 'access_token_expired') {
    req.publicApiErrorCode = 'expired_token';
    sendPublicApiError(res, 401, {
      code: 'expired_token',
      message: 'Bearer token expired',
      request_id: requestId,
    });
    return;
  }

  req.publicApiErrorCode = 'unauthorized';
  sendPublicApiError(res, 401, {
    code: 'unauthorized',
    message,
    request_id: requestId,
  });
}
