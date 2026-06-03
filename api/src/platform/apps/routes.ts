// OAuth app control-plane routes manage credentials, webhooks, and audit visibility for workspace admins.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ERROR_CODES,
  HTTP_STATUS,
  PUBLIC_API_SCOPES,
  PublicWebhookCreateSchema,
  PublicWebhookListQuerySchema,
} from '@ship/shared';
import { authMiddleware, workspaceAdminMiddleware } from '../../middleware/auth.js';
import { logAuditEvent } from '../../services/audit.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import {
  createOAuthApp,
  listOAuthApps,
  listPublicApiAuditLogs,
  requireOAuthAppInWorkspace,
  revokeOAuthAppSecret,
  rotateOAuthAppSecret,
} from './service.js';
import {
  createWebhookSubscription,
  isWebhookSubscriptionScopeError,
  isWebhookTargetUrlError,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  replayWebhookDelivery,
} from '../webhooks/service.js';
import {
  decodePublicCursor,
  encodePublicCursor,
  publicListLimitFromQuery,
} from '../api/v1/pagination.js';

const createOAuthAppSchema = z.object({
  name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(z.string().url().refine(isAllowedOAuthRedirectUri, {
    message: 'OAuth redirect URI must be HTTPS, or HTTP localhost for local development, and must not include a fragment',
  })).min(1),
  requested_scopes: z.array(z.enum(PUBLIC_API_SCOPES)).min(1),
});

const appParamsSchema = z.object({
  appId: z.string().uuid(),
});

const appSecretParamsSchema = z.object({
  appId: z.string().uuid(),
  secretId: z.string().uuid(),
});

const appDeliveryParamsSchema = z.object({
  appId: z.string().uuid(),
  deliveryId: z.string().uuid(),
});

const rotateSecretSchema = z.object({
  revoke_previous_immediately: z.boolean().optional().default(false),
});

const router = Router();

router.use(authMiddleware, requireSessionCredential, workspaceAdminMiddleware);

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = getAuthenticatedRouteContext(req);
  const apps = await listOAuthApps({ workspaceId });
  res.json({ success: true, data: { apps } });
});

router.post(
  '/',
  async (req: Request, res: Response): Promise<void> => {
    const parsed = createOAuthAppSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Invalid OAuth app request',
          details: parsed.error.flatten(),
        },
      });
      return;
    }

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    try {
      const app = await createOAuthApp({
        workspaceId,
        ownerUserId: userId,
        name: parsed.data.name,
        redirectUris: parsed.data.redirect_uris,
        requestedScopes: parsed.data.requested_scopes,
      });

      await logAuditEvent({
        workspaceId,
        actorUserId: userId,
        action: 'oauth_app.created',
        resourceType: 'oauth_app',
        resourceId: app.id,
        details: {
          name: app.name,
          client_id: app.client_id,
          requested_scopes: app.requested_scopes,
          redirect_uris: app.redirect_uris,
        },
        req,
      });

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        data: {
          id: app.id,
          name: app.name,
          client_id: app.client_id,
          client_secret_id: app.client_secret_id,
          client_secret: app.client_secret,
          redirect_uris: app.redirect_uris,
          requested_scopes: app.requested_scopes,
          is_active: app.is_active,
          created_at: app.created_at,
          updated_at: app.updated_at,
          warning: 'Save this client_secret now. It will not be shown again.',
        },
      });
    } catch (error) {
      console.error('Create OAuth app error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Failed to create OAuth app',
        },
      });
    }
  }
);

router.post('/:appId/secrets/rotate', async (req: Request, res: Response): Promise<void> => {
  const params = appParamsSchema.safeParse(req.params);
  const body = rotateSecretSchema.safeParse(req.body ?? {});
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }
  if (!body.success) {
    sendValidationError(res, body.error);
    return;
  }

  const { userId, workspaceId } = getAuthenticatedRouteContext(req);
  try {
    const rotated = await rotateOAuthAppSecret({
      appId: params.data.appId,
      workspaceId,
      actorUserId: userId,
      revokePreviousImmediately: body.data.revoke_previous_immediately,
    });
    await logAuditEvent({
      workspaceId,
      actorUserId: userId,
      action: 'oauth_app.secret_rotated',
      resourceType: 'oauth_app',
      resourceId: params.data.appId,
      details: {
        client_secret_id: rotated.client_secret_id,
        previous_secret_expires_at: rotated.previous_secret_expires_at,
        revoked_previous_immediately: body.data.revoke_previous_immediately,
      },
      req,
    });
    res.json({ success: true, data: rotated });
  } catch (error) {
    sendKnownOrInternalError(res, error, 'Failed to rotate OAuth app secret');
  }
});

router.post('/:appId/secrets/:secretId/revoke', async (req: Request, res: Response): Promise<void> => {
  const params = appSecretParamsSchema.safeParse(req.params);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }

  const { userId, workspaceId } = getAuthenticatedRouteContext(req);
  try {
    const secret = await revokeOAuthAppSecret({
      appId: params.data.appId,
      secretId: params.data.secretId,
      workspaceId,
    });
    await logAuditEvent({
      workspaceId,
      actorUserId: userId,
      action: 'oauth_app.secret_revoked',
      resourceType: 'oauth_app',
      resourceId: params.data.appId,
      details: { client_secret_id: params.data.secretId },
      req,
    });
    res.json({ success: true, data: secret });
  } catch (error) {
    sendKnownOrInternalError(res, error, 'Failed to revoke OAuth app secret');
  }
});

router.get('/:appId/webhooks', async (req: Request, res: Response): Promise<void> => {
  const params = appParamsSchema.safeParse(req.params);
  const query = PublicWebhookListQuerySchema.safeParse(req.query);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }
  if (!query.success) {
    sendValidationError(res, query.error);
    return;
  }

  const { workspaceId } = getAuthenticatedRouteContext(req);
  try {
    await requireOAuthAppInWorkspace(params.data.appId, workspaceId);
    const page = await listCursorPage(query.data, async (limit, cursor) => (
      listWebhookSubscriptions({
        appId: params.data.appId,
        workspaceId,
        limit,
        cursor,
      })
    ));
    res.json({ success: true, data: page });
  } catch (error) {
    sendKnownOrInternalError(res, error, 'Failed to list webhook subscriptions');
  }
});

router.post('/:appId/webhooks', async (req: Request, res: Response): Promise<void> => {
  const params = appParamsSchema.safeParse(req.params);
  const body = PublicWebhookCreateSchema.safeParse(req.body);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }
  if (!body.success) {
    sendValidationError(res, body.error);
    return;
  }

  const { userId, workspaceId } = getAuthenticatedRouteContext(req);
  try {
    const oauthApp = await requireOAuthAppInWorkspace(params.data.appId, workspaceId);
    const subscription = await createWebhookSubscription({
      appId: params.data.appId,
      workspaceId,
      event: body.data.event,
      targetUrl: body.data.target_url,
      readSubjectUserId: userId,
      readSubjectScopes: oauthApp.requested_scopes,
      readContextSource: 'portal_session',
    });
    res.status(HTTP_STATUS.CREATED).json({ success: true, data: subscription });
  } catch (error) {
    if (isWebhookTargetUrlError(error)) {
      sendValidationMessage(res, error.message);
      return;
    }
    if (isWebhookSubscriptionScopeError(error)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: `Missing required scope: ${error.missingScope}`,
        },
      });
      return;
    }
    sendKnownOrInternalError(res, error, 'Failed to create webhook subscription');
  }
});

router.get('/:appId/webhooks/deliveries', async (req: Request, res: Response): Promise<void> => {
  const params = appParamsSchema.safeParse(req.params);
  const query = PublicWebhookListQuerySchema.safeParse(req.query);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }
  if (!query.success) {
    sendValidationError(res, query.error);
    return;
  }

  const { workspaceId } = getAuthenticatedRouteContext(req);
  try {
    await requireOAuthAppInWorkspace(params.data.appId, workspaceId);
    const page = await listCursorPage(query.data, async (limit, cursor) => (
      listWebhookDeliveries({
        appId: params.data.appId,
        workspaceId,
        limit,
        cursor,
      })
    ));
    res.json({ success: true, data: page });
  } catch (error) {
    sendKnownOrInternalError(res, error, 'Failed to list webhook deliveries');
  }
});

router.post('/:appId/webhooks/deliveries/:deliveryId/replay', async (req: Request, res: Response): Promise<void> => {
  const params = appDeliveryParamsSchema.safeParse(req.params);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }

  const { workspaceId } = getAuthenticatedRouteContext(req);
  try {
    await requireOAuthAppInWorkspace(params.data.appId, workspaceId);
    const delivery = await replayWebhookDelivery({
      deliveryId: params.data.deliveryId,
      appId: params.data.appId,
      workspaceId,
    });
    res.status(202).json({ success: true, data: delivery });
  } catch (error) {
    sendKnownOrInternalError(res, error, 'Failed to replay webhook delivery');
  }
});

router.get('/:appId/audit', async (req: Request, res: Response): Promise<void> => {
  const params = appParamsSchema.safeParse(req.params);
  const query = PublicWebhookListQuerySchema.safeParse(req.query);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }
  if (!query.success) {
    sendValidationError(res, query.error);
    return;
  }

  const { workspaceId } = getAuthenticatedRouteContext(req);
  try {
    const page = await listCursorPage(query.data, async (limit, cursor) => (
      listPublicApiAuditLogs({
        appId: params.data.appId,
        workspaceId,
        limit,
        cursor,
      })
    ));
    res.json({ success: true, data: page });
  } catch (error) {
    sendKnownOrInternalError(res, error, 'Failed to list public API audit logs');
  }
});

function requireSessionCredential(req: Request, res: Response, next: NextFunction): void {
  if (req.isApiToken) {
    res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      error: {
        code: ERROR_CODES.FORBIDDEN,
        message: 'Session authentication required for OAuth app control plane',
      },
    });
    return;
  }

  next();
}

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(HTTP_STATUS.BAD_REQUEST).json({
    success: false,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Invalid OAuth app request',
      details: error.flatten(),
    },
  });
}

function sendValidationMessage(res: Response, message: string): void {
  res.status(HTTP_STATUS.BAD_REQUEST).json({
    success: false,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
    },
  });
}

function sendKnownOrInternalError(res: Response, error: unknown, message: string): void {
  if (error instanceof Error && (
    error.message === 'OAUTH_APP_NOT_FOUND' ||
    error.message === 'OAUTH_APP_SECRET_NOT_FOUND' ||
    error.message === 'WEBHOOK_DELIVERY_NOT_FOUND'
  )) {
    res.status(HTTP_STATUS.NOT_FOUND).json({
      success: false,
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: 'Resource not found',
      },
    });
    return;
  }

  if (error instanceof Error && error.message === 'OAUTH_APP_ACTIVE_SECRET_REQUIRED') {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Cannot revoke the active client secret. Rotate with immediate revocation instead.',
      },
    });
    return;
  }

  if (error instanceof z.ZodError) {
    sendValidationError(res, error);
    return;
  }

  console.error(message, error);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message,
    },
  });
}

async function listCursorPage<T extends { id: string; created_at: string }>(
  query: { limit?: number; cursor?: string },
  list: (limit: number, cursor: NonNullable<ReturnType<typeof decodePublicCursor>> | undefined) => Promise<T[]>
) {
  const cursor = query.cursor ? decodePublicCursor(query.cursor) : undefined;
  if (query.cursor && !cursor) {
    throw new z.ZodError([{
      code: 'custom',
      message: 'Invalid cursor',
      path: ['cursor'],
    }]);
  }
  const limit = publicListLimitFromQuery(query.limit);
  const rows = await list(limit + 1, cursor ?? undefined);
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return {
    data,
    next_cursor: rows.length > limit && last
      ? encodePublicCursor({ id: last.id, timestamp: last.created_at })
      : null,
  };
}

function isAllowedOAuthRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export default router;
