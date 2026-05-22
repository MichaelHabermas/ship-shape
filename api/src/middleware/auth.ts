import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../db/client.js';
import { SESSION_TIMEOUT_MS, ABSOLUTE_SESSION_TIMEOUT_MS, ERROR_CODES, HTTP_STATUS } from '@ship/shared';

// Extend Express Request to include session info
declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
      userId?: string;
      workspaceId?: string;
      isSuperAdmin?: boolean;
      isApiToken?: boolean; // True when authenticated via API token
    }
  }
}

// Hash a token for comparison
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const sameSiteCookiePolicy = process.env.NODE_ENV === 'production' && process.env.ENVIRONMENT === 'render'
  ? 'none'
  : 'strict';

// Validate API token and return user info if valid
async function validateApiToken(token: string): Promise<{
  userId: string;
  workspaceId: string;
  isSuperAdmin: boolean;
  tokenId: string;
} | null> {
  const tokenHash = hashToken(token);

  const result = await pool.query(
    `SELECT t.id, t.user_id, t.workspace_id, t.expires_at, t.revoked_at,
            u.is_super_admin, wm.user_id AS membership_user_id
     FROM api_tokens t
     JOIN users u ON t.user_id = u.id
     LEFT JOIN workspace_memberships wm
       ON wm.user_id = t.user_id
      AND wm.workspace_id = t.workspace_id
     WHERE t.token_hash = $1`,
    [tokenHash]
  );

  const tokenRow = result.rows[0];

  if (!tokenRow) return null;

  // Check if revoked
  if (tokenRow.revoked_at) return null;

  // Check if expired
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return null;

  // Super-admin tokens can authenticate globally; all other tokens require
  // current membership in the token workspace.
  if (!tokenRow.is_super_admin && !tokenRow.membership_user_id) return null;

  // Update last_used_at
  await pool.query(
    'UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1',
    [tokenRow.id]
  );

  return {
    userId: tokenRow.user_id,
    workspaceId: tokenRow.workspace_id,
    isSuperAdmin: tokenRow.is_super_admin,
    tokenId: tokenRow.id,
  };
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
    // Get session and check if it's valid
    const result = await pool.query(
      `SELECT s.id, s.user_id, s.workspace_id, s.expires_at, s.last_activity, s.created_at,
              u.is_super_admin
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [sessionId]
    );

    const session = result.rows[0];

    if (!session) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'Invalid session',
        },
      });
      return;
    }

    const now = new Date();
    const lastActivity = new Date(session.last_activity);
    const createdAt = new Date(session.created_at);
    const inactivityMs = now.getTime() - lastActivity.getTime();
    const sessionAgeMs = now.getTime() - createdAt.getTime();

    // Check 12-hour absolute session timeout (NIST SP 800-63B-4 AAL2)
    if (sessionAgeMs > ABSOLUTE_SESSION_TIMEOUT_MS) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);

      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.SESSION_EXPIRED,
          message: 'Session expired. Please log in again.',
        },
      });
      return;
    }

    // Check 15-minute inactivity timeout
    if (inactivityMs > SESSION_TIMEOUT_MS) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);

      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.SESSION_EXPIRED,
          message: 'Session expired due to inactivity',
        },
      });
      return;
    }

    // Verify user still has access to the workspace (unless super-admin)
    if (session.workspace_id && !session.is_super_admin) {
      const membershipResult = await pool.query(
        'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [session.workspace_id, session.user_id]
      );

      if (!membershipResult.rows[0]) {
        // User no longer has access - delete session
        await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);

        res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          error: {
            code: ERROR_CODES.FORBIDDEN,
            message: 'Access to this workspace has been revoked',
          },
        });
        return;
      }
    }

    const COOKIE_REFRESH_THRESHOLD_MS = 60 * 1000;
    if (inactivityMs > COOKIE_REFRESH_THRESHOLD_MS) {
      await pool.query(
        'UPDATE sessions SET last_activity = $1 WHERE id = $2',
        [now, sessionId]
      );

      res.cookie('session_id', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: sameSiteCookiePolicy,
        maxAge: SESSION_TIMEOUT_MS,
        path: '/',
      });
    }

    // Attach session info to request
    req.sessionId = session.id;
    req.userId = session.user_id;
    req.workspaceId = session.workspace_id;
    req.isSuperAdmin = session.is_super_admin;

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
