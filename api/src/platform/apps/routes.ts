// OAuth app registration routes create shown-once client credentials for workspace admins.
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { authMiddleware, workspaceAdminMiddleware } from '../../middleware/auth.js';
import { logAuditEvent } from '../../services/audit.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { PUBLIC_API_SCOPES } from '../scopes/registry.js';
import { createOAuthApp } from './service.js';

const createOAuthAppSchema = z.object({
  name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(z.string().url().refine(isAllowedOAuthRedirectUri, {
    message: 'OAuth redirect URI must be HTTPS, or HTTP localhost for local development, and must not include a fragment',
  })).min(1),
  requested_scopes: z.array(z.enum(PUBLIC_API_SCOPES)).min(1),
});

const router = Router();

router.post(
  '/',
  authMiddleware,
  requireSessionCredential,
  workspaceAdminMiddleware,
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
          client_secret: app.client_secret,
          redirect_uris: app.redirect_uris,
          requested_scopes: app.requested_scopes,
          created_at: app.created_at,
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

function requireSessionCredential(req: Request, res: Response, next: NextFunction): void {
  if (req.isApiToken) {
    res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      error: {
        code: ERROR_CODES.FORBIDDEN,
        message: 'Session authentication required to create OAuth apps',
      },
    });
    return;
  }

  next();
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
