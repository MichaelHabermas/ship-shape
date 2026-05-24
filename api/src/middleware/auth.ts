import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { sessionCookieOptions } from '../config/session-cookies.js';
import { validateAuthenticatedSession } from '../services/session-auth.js';
import { validateApiToken } from '../security/tokens.js';

// Extend Express Request to include session info
declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
      userId?: string;
      workspaceId?: string;
      isSuperAdmin?: boolean;
      isApiToken?: boolean; // True when authenticated via API token
      apiTokenId?: string;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Check for Bearer token first (API token auth)
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    try {
      const tokenData = await validateApiToken(token);

      if (!tokenData) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: {
            code: ERROR_CODES.UNAUTHORIZED,
            message: 'Invalid or expired API token',
          },
        });
        return;
      }

      // Attach token info to request
      req.userId = tokenData.userId;
      req.workspaceId = tokenData.workspaceId;
      req.isSuperAdmin = tokenData.isSuperAdmin;
      req.isApiToken = true;
      req.apiTokenId = tokenData.tokenId;
      req.apiTokenScopes = tokenData.scopes;
      req.principal = tokenData;

      next();
      return;
    } catch (error) {
      console.error('API token auth error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Authentication failed',
        },
      });
      return;
    }
  }

  // Fall back to session cookie auth
  const sessionId = req.cookies?.session_id;

  if (!sessionId) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'No session found',
      },
    });
    return;
  }

  try {
    const validation = await validateAuthenticatedSession(sessionId, { updateActivity: true });

    if (!validation.ok) {
      if (validation.reason === 'membership_revoked') {
        res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          error: {
            code: ERROR_CODES.FORBIDDEN,
            message: 'Access to this workspace has been revoked',
          },
        });
        return;
      }

      if (
        validation.reason === 'absolute_timeout' ||
        validation.reason === 'inactivity_timeout'
      ) {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: {
            code: ERROR_CODES.SESSION_EXPIRED,
            message:
              validation.reason === 'absolute_timeout'
                ? 'Session expired. Please log in again.'
                : 'Session expired due to inactivity',
          },
        });
        return;
      }

      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'Invalid session',
        },
      });
      return;
    }

    if (validation.session.sessionId === sessionId && validation.activityUpdated) {
      res.cookie('session_id', sessionId, sessionCookieOptions());
    }

    req.sessionId = validation.session.sessionId;
    req.userId = validation.session.userId;
    req.workspaceId = validation.session.workspaceId ?? undefined;
    req.isSuperAdmin = validation.session.isSuperAdmin;
    if (validation.session.workspaceId) {
      req.principal = {
        kind: 'session',
        sessionId: validation.session.sessionId,
        userId: validation.session.userId,
        workspaceId: validation.session.workspaceId,
        isSuperAdmin: validation.session.isSuperAdmin,
      };
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Authentication failed',
      },
    });
  }
}

// Middleware that requires super-admin access
export async function superAdminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.isApiToken) {
    res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      error: {
        code: ERROR_CODES.FORBIDDEN,
        message: 'API tokens cannot access super-admin routes',
      },
    });
    return;
  }

  if (!req.isSuperAdmin) {
    res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      error: {
        code: ERROR_CODES.FORBIDDEN,
        message: 'Super-admin access required',
      },
    });
    return;
  }

  next();
}

// Middleware that requires workspace admin access (or super-admin)
export async function workspaceAdminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Super-admins always have access
  if (req.isSuperAdmin) {
    next();
    return;
  }

  const workspaceId = req.params.id || req.workspaceId;

  if (!workspaceId) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Workspace ID required',
      },
    });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, req.userId]
    );

    const membership = result.rows[0];

    if (!membership || membership.role !== 'admin') {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Workspace admin access required',
        },
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Workspace admin middleware error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Authorization check failed',
      },
    });
  }
}

// Middleware that verifies access to a specific workspace
export async function workspaceAccessMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Super-admins always have access
  if (req.isSuperAdmin) {
    next();
    return;
  }

  const workspaceId = req.params.workspaceId || req.workspaceId;

  if (!workspaceId) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Workspace ID required',
      },
    });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, req.userId]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Access denied to this workspace',
        },
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Workspace access middleware error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Authorization check failed',
      },
    });
  }
}
