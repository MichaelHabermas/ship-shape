// Password login, session lifecycle, and /me for authenticated users.
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS, SESSION_TIMEOUT_MS, ABSOLUTE_SESSION_TIMEOUT_MS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';
import { sessionClearCookieOptions, sessionCookieOptions } from '../config/session-cookies.js';

const router = Router();

interface WorkspaceMembershipRow {
  id: string;
  name: string;
  role: string;
}

interface LoginUserRow {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  is_super_admin: boolean;
  last_workspace_id: string | null;
}

interface SessionInfoRow {
  id: string;
  created_at: string | Date;
  expires_at: string | Date;
  last_activity: string | Date;
}

interface UserMeRow {
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
}

interface CurrentWorkspaceRow {
  id: string;
  name: string;
  role: string | null;
}

// Generate cryptographically secure session ID (256 bits of entropy)
function generateSecureSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { email?: unknown; password?: unknown };

  if (
    typeof body.email !== 'string'
    || typeof body.password !== 'string'
    || !body.email
    || !body.password
  ) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email and password are required',
      },
    });
    return;
  }

  const email = body.email;
  const password = body.password;

  try {
    // Find user with their workspace memberships (case-insensitive email lookup)
    const userResult = await pool.query<LoginUserRow>(
      `SELECT u.id, u.email, u.password_hash, u.name, u.is_super_admin, u.last_workspace_id
       FROM users u
       WHERE LOWER(u.email) = LOWER($1)`,
      [email]
    );

    const user = userResult.rows[0];

    if (!user) {
      await logAuditEvent({
        action: 'auth.login_failed',
        details: { email, reason: 'user_not_found' },
        req,
      });
      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_CREDENTIALS,
          message: 'Invalid email or password',
        },
      });
      return;
    }

    // Verify password (PIV-only users have null password_hash)
    if (!user.password_hash) {
      await logAuditEvent({
        action: 'auth.login_failed',
        details: { email, reason: 'piv_only_user' },
        req,
      });
      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_CREDENTIALS,
          message: 'This account uses PIV authentication only',
        },
      });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      await logAuditEvent({
        action: 'auth.login_failed',
        details: { email, reason: 'invalid_password' },
        req,
      });
      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_CREDENTIALS,
          message: 'Invalid email or password',
        },
      });
      return;
    }

    // Get user's workspaces
    const workspacesResult = await pool.query<WorkspaceMembershipRow>(
      `SELECT w.id, w.name, wm.role
       FROM workspaces w
       JOIN workspace_memberships wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.archived_at IS NULL
       ORDER BY w.name`,
      [user.id]
    );

    const workspaces = workspacesResult.rows;

    // Determine which workspace to log into
    let workspaceId: string | null = null;

    if (user.last_workspace_id) {
      // Check if last workspace is still accessible
      const lastWorkspaceValid = workspaces.some(w => w.id === user.last_workspace_id);
      if (lastWorkspaceValid) {
        workspaceId = user.last_workspace_id;
      }
    }

    // If no valid last workspace, use first available
    if (!workspaceId && workspaces.length > 0) {
      workspaceId = workspaces[0]?.id ?? null;
    }

    // Super-admins can log in even without workspace membership
    // They'll need to select a workspace after login
    if (!workspaceId && !user.is_super_admin && workspaces.length === 0) {
      await logAuditEvent({
        actorUserId: user.id,
        action: 'auth.login_failed',
        details: { email, reason: 'no_workspace_access' },
        req,
      });
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'You do not have access to any workspaces',
        },
      });
      return;
    }

    // sessions.workspace_id is NOT NULL — super-admins with no membership still need a workspace row
    if (!workspaceId && user.is_super_admin) {
      const fallbackWorkspace = await pool.query<{ id: string }>(
        `SELECT id FROM workspaces WHERE archived_at IS NULL ORDER BY name LIMIT 1`
      );
      workspaceId = fallbackWorkspace.rows[0]?.id ?? null;
    }

    if (!workspaceId) {
      await logAuditEvent({
        actorUserId: user.id,
        action: 'auth.login_failed',
        details: { email, reason: 'no_workspace_configured' },
        req,
      });
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'No workspace is available for session creation',
        },
      });
      return;
    }

    // Session fixation prevention: Delete any existing session from this request
    const oldSessionId = typeof req.cookies.session_id === 'string' ? req.cookies.session_id : undefined;
    if (oldSessionId) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [oldSessionId]);
    }

    // Create NEW session with cryptographically secure ID
    const sessionId = generateSecureSessionId();
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);

    // Store session with binding data (user_agent, ip_address for audit)
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        user.id,
        workspaceId,
        expiresAt,
        new Date(),
        req.get('user-agent') || 'unknown',
        req.ip || req.socket.remoteAddress || 'unknown',
      ]
    );

    // Update last_workspace_id
    if (workspaceId) {
      await pool.query(
        'UPDATE users SET last_workspace_id = $1, updated_at = NOW() WHERE id = $2',
        [workspaceId, user.id]
      );
    }

    await logAuditEvent({
      workspaceId: workspaceId || undefined,
      actorUserId: user.id,
      action: 'auth.login',
      req,
    });

    // Pending accountability items will be fetched via /api/accountability/action-items
    const pendingAccountabilityItems: unknown[] = [];

    // Set cookie with hardened security options
    res.cookie('session_id', sessionId, sessionCookieOptions());

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.is_super_admin,
        },
        currentWorkspace: workspaceId ? {
          id: workspaceId,
          name: workspaces.find(w => w.id === workspaceId)?.name,
          role: workspaces.find(w => w.id === workspaceId)?.role,
        } : null,
        workspaces: workspaces.map(w => ({
          id: w.id,
          name: w.name,
          role: w.role,
        })),
        pendingAccountabilityItems,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Login failed',
      },
    });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    await logAuditEvent({
      workspaceId: req.workspaceId,
      actorUserId: req.userId,
      action: 'auth.logout',
      req,
    });

    // Delete session from database
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);

    // Clear cookie with same options used when setting it
    res.clearCookie('session_id', sessionClearCookieOptions());

    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Logout failed',
      },
    });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<UserMeRow>(
      `SELECT id, email, name, is_super_admin FROM users WHERE id = $1`,
      [req.userId]
    );

    const user = result.rows[0];

    if (!user) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found',
        },
      });
      return;
    }

    // Get user's workspaces
    const workspacesResult = await pool.query<WorkspaceMembershipRow>(
      `SELECT w.id, w.name, wm.role
       FROM workspaces w
       JOIN workspace_memberships wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.archived_at IS NULL
       ORDER BY w.name`,
      [req.userId]
    );

    // Get current workspace info
    let currentWorkspace = null;
    if (req.workspaceId) {
      const currentResult = await pool.query<CurrentWorkspaceRow>(
        `SELECT w.id, w.name, wm.role
         FROM workspaces w
         LEFT JOIN workspace_memberships wm ON w.id = wm.workspace_id AND wm.user_id = $2
         WHERE w.id = $1`,
        [req.workspaceId, req.userId]
      );
      const currentRow = currentResult.rows[0];
      if (currentRow) {
        currentWorkspace = {
          id: currentRow.id,
          name: currentRow.name,
          role: currentRow.role || 'admin', // Super-admin without membership
        };
      }
    }

    // Pending accountability items will be fetched via /api/accountability/action-items
    const pendingAccountabilityItems: unknown[] = [];

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.is_super_admin,
        },
        currentWorkspace,
        workspaces: workspacesResult.rows.map(w => ({
          id: w.id,
          name: w.name,
          role: w.role,
        })),
        pendingAccountabilityItems,
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get user info',
      },
    });
  }
});

// POST /api/auth/extend-session - Explicitly extend session (called by "Stay Logged In" button)
router.post('/extend-session', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TIMEOUT_MS);

    // Update session's last_activity and expires_at
    await pool.query(
      `UPDATE sessions SET last_activity = $1, expires_at = $2 WHERE id = $3`,
      [now, expiresAt, req.sessionId]
    );

    await logAuditEvent({
      workspaceId: req.workspaceId,
      actorUserId: req.userId,
      action: 'auth.extend_session',
      req,
    });

    // Refresh cookie with new maxAge (sliding expiration)
    res.cookie('session_id', req.sessionId, sessionCookieOptions());

    res.json({
      success: true,
      data: {
        expiresAt: expiresAt.toISOString(),
        lastActivity: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('Extend session error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to extend session',
      },
    });
  }
});

// GET /api/auth/session - Get session info for timeout tracking
router.get('/session', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<SessionInfoRow>(
      `SELECT id, created_at, expires_at, last_activity FROM sessions WHERE id = $1`,
      [req.sessionId]
    );

    const session = result.rows[0];

    if (!session) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Session not found',
        },
      });
      return;
    }

    // Calculate absolute expiry based on session creation time
    const createdAt = new Date(session.created_at);
    const lastActivity = new Date(session.last_activity);
    const inactivityExpiresAt = new Date(lastActivity.getTime() + SESSION_TIMEOUT_MS);
    const absoluteExpiresAt = new Date(createdAt.getTime() + ABSOLUTE_SESSION_TIMEOUT_MS);

    res.json({
      success: true,
      data: {
        createdAt: session.created_at,
        expiresAt: inactivityExpiresAt.toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        lastActivity: session.last_activity,
      },
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get session info',
      },
    });
  }
});

export default router;
