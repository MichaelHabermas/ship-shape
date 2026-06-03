// Public webhook routes manage subscriptions, delivery logs, and replay through OAuth.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PublicWebhookCreateSchema,
  PublicWebhookListQuerySchema,
} from '@ship/shared';
import {
  createWebhookSubscription,
  isWebhookSubscriptionScopeError,
  isWebhookTargetUrlError,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  replayWebhookDelivery,
} from '../../webhooks/service.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  publicApiRequestIdFromRequest,
  requirePublicApiBearer,
} from './middleware.js';
import { sendPublicApiError } from './errors.js';
import { sendInvalidCursorError } from './route-handlers.js';
import {
  decodePublicCursor,
  encodePublicCursor,
  publicListLimitFromQuery,
} from './pagination.js';
import {
  publicWebhookDeliveriesListRouteMetadata,
  publicWebhookDeliveryReplayRouteMetadata,
  publicWebhooksCreateRouteMetadata,
  publicWebhooksListRouteMetadata,
} from './route-metadata.js';

const deliveryParamsSchema = z.object({
  id: z.string().uuid(),
});

export const publicWebhooksRouter = Router();

publicWebhooksRouter.get(
  publicWebhooksListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicWebhooksListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicWebhooksListRouteMetadata.path);
    const parsed = PublicWebhookListQuerySchema.safeParse(req.query);
    if (!parsed.success || !req.publicApi) {
      sendValidationOrContextError(req, res, parsed.success ? null : parsed.error);
      return;
    }
    const cursor = parsed.data.cursor ? decodePublicCursor(parsed.data.cursor) ?? undefined : undefined;
    if (parsed.data.cursor && !cursor) {
      sendInvalidCursorError(req, res);
      return;
    }
    const limit = publicListLimitFromQuery(parsed.data.limit);
    const data = await listWebhookSubscriptions({
      appId: req.publicApi.appId,
      workspaceId: req.publicApi.workspaceId,
      cursor,
      limit: limit + 1,
    });
    res.json(pageFromRows(data, limit));
  })
);

publicWebhooksRouter.post(
  publicWebhooksCreateRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicWebhooksCreateRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicWebhooksCreateRouteMetadata.path);
    const parsed = PublicWebhookCreateSchema.safeParse(req.body);
    if (!parsed.success || !req.publicApi) {
      sendValidationOrContextError(req, res, parsed.success ? null : parsed.error);
      return;
    }
    try {
      const subscription = await createWebhookSubscription({
        appId: req.publicApi.appId,
        workspaceId: req.publicApi.workspaceId,
        event: parsed.data.event,
        targetUrl: parsed.data.target_url,
        readSubjectUserId: req.publicApi.userId,
        readSubjectScopes: req.publicApi.grantedScopes,
        readContextSource: 'public_oauth',
      });
      res.status(201).json(subscription);
    } catch (error) {
      if (isWebhookSubscriptionScopeError(error)) {
        req.publicApiErrorCode = 'forbidden';
        sendPublicApiError(res, 403, {
          code: 'forbidden',
          message: `Missing required scope: ${error.missingScope}`,
          details: { missing_scope: error.missingScope },
          request_id: requestIdFromContext(req),
        });
        return;
      }
      if (!isWebhookTargetUrlError(error)) throw error;
      req.publicApiErrorCode = 'validation_failed';
      sendPublicApiError(res, 400, {
        code: 'validation_failed',
        message: error.message,
        request_id: requestIdFromContext(req),
      });
    }
  })
);

publicWebhooksRouter.get(
  publicWebhookDeliveriesListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicWebhookDeliveriesListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicWebhookDeliveriesListRouteMetadata.path);
    const parsed = PublicWebhookListQuerySchema.safeParse(req.query);
    if (!parsed.success || !req.publicApi) {
      sendValidationOrContextError(req, res, parsed.success ? null : parsed.error);
      return;
    }
    const cursor = parsed.data.cursor ? decodePublicCursor(parsed.data.cursor) ?? undefined : undefined;
    if (parsed.data.cursor && !cursor) {
      sendInvalidCursorError(req, res);
      return;
    }
    const limit = publicListLimitFromQuery(parsed.data.limit);
    const data = await listWebhookDeliveries({
      appId: req.publicApi.appId,
      workspaceId: req.publicApi.workspaceId,
      cursor,
      limit: limit + 1,
    });
    res.json(pageFromRows(data, limit));
  })
);

publicWebhooksRouter.post(
  publicWebhookDeliveryReplayRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicWebhookDeliveryReplayRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicWebhookDeliveryReplayRouteMetadata.path);
    const parsed = deliveryParamsSchema.safeParse(req.params);
    if (!parsed.success || !req.publicApi) {
      sendValidationOrContextError(req, res, parsed.success ? null : parsed.error);
      return;
    }

    try {
      const delivery = await replayWebhookDelivery({
        deliveryId: parsed.data.id,
        appId: req.publicApi.appId,
        workspaceId: req.publicApi.workspaceId,
      });
      res.status(202).json(delivery);
    } catch (error) {
      if (error instanceof Error && error.message === 'WEBHOOK_DELIVERY_NOT_FOUND') {
        req.publicApiErrorCode = 'not_found';
        sendPublicApiError(res, 404, {
          code: 'not_found',
          message: 'Webhook delivery not found',
          request_id: req.publicApi.requestId,
        });
        return;
      }
      throw error;
    }
  })
);

function sendValidationOrContextError(req: Request, res: Response, error: z.ZodError | null): void {
  req.publicApiErrorCode = error ? 'validation_failed' : 'server_error';
  sendPublicApiError(res, error ? 400 : 500, {
    code: req.publicApiErrorCode,
    message: error ? 'Invalid request' : 'Public API context missing',
    ...(error ? { details: { fields: error.flatten() } } : {}),
    request_id: requestIdFromContext(req),
  });
}

function pageFromRows<T extends { id: string; created_at: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return {
    data,
    next_cursor: rows.length > limit && last
      ? encodePublicCursor({ id: last.id, timestamp: last.created_at })
      : null,
  };
}

function requestIdFromContext(req: Request): string {
  return req.publicApi?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req);
}
