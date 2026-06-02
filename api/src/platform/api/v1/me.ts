// Public /api/v1/me route proves OAuth bearer authentication without resource behavior.
import { Router, type Request, type Response } from 'express';
import { pool } from '../../../db/client.js';
import { PUBLIC_ME_PATH } from './paths.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  requirePublicApiBearer,
} from './middleware.js';
import type { PublicRouteMetadata } from './route-metadata.js';
import { sendPublicApiError } from './errors.js';

type PublicMeUserRow = {
  id: string;
  email: string;
  name: string;
};

export const publicMeRouteMetadata = {
  method: 'GET',
  path: PUBLIC_ME_PATH,
  requiredScope: null,
} satisfies PublicRouteMetadata;

export const publicMeRouter = Router();

publicMeRouter.get(
  '/me',
  requirePublicApiBearer(publicMeRouteMetadata.requiredScope),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, PUBLIC_ME_PATH);
    if (!req.publicApi) {
      sendPublicApiError(res, 500, {
        code: 'server_error',
        message: 'Public API context missing',
        request_id: 'unknown',
      });
      return;
    }

    const result = await pool.query<PublicMeUserRow>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [req.publicApi.userId]
    );

    const user = result.rows[0];
    if (!user) {
      req.publicApiErrorCode = 'not_found';
      sendPublicApiError(res, 404, {
        code: 'not_found',
        message: 'User not found',
        request_id: req.publicApi.requestId,
      });
      return;
    }

    res.json({
      user,
      app: {
        client_id: req.publicApi.clientId,
      },
      workspace_id: req.publicApi.workspaceId,
      granted_scopes: req.publicApi.grantedScopes,
    });
  })
);
