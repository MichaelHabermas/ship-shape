import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../../services/audit.js';
import {
  type WorkspaceRow,
  type WorkspaceListRow,
  type UserSuperAdminRow,
  type IdRow,
  type WorkspaceSwitchRow,
  type MutationRow,
  mapWorkspaceListItem,
  mapSuperAdminWorkspaceItem,
  mapCurrentWorkspace,
} from './shared.js';

const router = Router();
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<WorkspaceListRow>(
      `SELECT w.id, w.name, w.sprint_start_date, w.archived_at, w.created_at, w.updated_at,
              wm.role
       FROM workspaces w
       JOIN workspace_memberships wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.archived_at IS NULL
       ORDER BY w.name`,
      [req.userId]
    );

    // Check if user is super-admin (they see all workspaces)
    const userResult = await pool.query<UserSuperAdminRow>(
      'SELECT is_super_admin FROM users WHERE id = $1',
      [req.userId]
    );
    const isSuperAdmin = userResult.rows[0]?.is_super_admin || false;

    let workspaces = result.rows.map(mapWorkspaceListItem);

    // Super-admins see all workspaces (even ones they're not members of)
    if (isSuperAdmin) {
      const allWorkspacesResult = await pool.query<WorkspaceRow>(
        `SELECT id, name, sprint_start_date, archived_at, created_at, updated_at
         FROM workspaces
         WHERE archived_at IS NULL
         ORDER BY name`
      );

      const memberWorkspaceIds = new Set(workspaces.map(w => w.id));
      const additionalWorkspaces = allWorkspacesResult.rows
        .filter(row => !memberWorkspaceIds.has(row.id))
        .map(mapSuperAdminWorkspaceItem);

      workspaces = [...workspaces, ...additionalWorkspaces];
    }

    res.json({
      success: true,
      data: { workspaces, isSuperAdmin },
    });
  } catch (error) {
    console.error('List workspaces error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list workspaces',
      },
    });
  }
});

// GET /api/workspaces/current - Get current workspace
router.get('/current', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.workspaceId) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'No workspace selected',
        },
      });
      return;
    }

    const result = await pool.query<WorkspaceListRow>(
      `SELECT w.id, w.name, w.sprint_start_date, w.archived_at, w.created_at, w.updated_at,
              wm.role
       FROM workspaces w
       LEFT JOIN workspace_memberships wm ON w.id = wm.workspace_id AND wm.user_id = $2
       WHERE w.id = $1`,
      [req.workspaceId, req.userId]
    );

    const workspace = result.rows[0];
    if (!workspace) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        workspace: mapCurrentWorkspace(workspace),
      },
    });
  } catch (error) {
    console.error('Get current workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get current workspace',
      },
    });
  }
});

// POST /api/workspaces/:id/switch - Switch to a workspace
router.post('/:id/switch', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);

  try {
    // Check user has access to this workspace (member or super-admin)
    const userResult = await pool.query<UserSuperAdminRow>(
      'SELECT is_super_admin FROM users WHERE id = $1',
      [req.userId]
    );
    const isSuperAdmin = userResult.rows[0]?.is_super_admin || false;

    const membershipResult = await pool.query<IdRow>(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, req.userId]
    );

    if (!membershipResult.rows[0] && !isSuperAdmin) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Access denied to this workspace',
        },
      });
      return;
    }

    // Verify workspace exists and is not archived
    const workspaceResult = await pool.query<WorkspaceSwitchRow>(
      'SELECT id, name, archived_at FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    const workspace = workspaceResult.rows[0];
    if (!workspace) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    if (workspace.archived_at) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Cannot switch to archived workspace',
        },
      });
      return;
    }

    // Update user's last_workspace_id
    await pool.query<MutationRow>(
      'UPDATE users SET last_workspace_id = $1, updated_at = NOW() WHERE id = $2',
      [workspaceId, req.userId]
    );

    // Update session's workspace_id
    await pool.query<MutationRow>(
      'UPDATE sessions SET workspace_id = $1 WHERE id = $2',
      [workspaceId, req.sessionId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId,
      action: 'workspace.switch',
      resourceType: 'workspace',
      resourceId: workspaceId,
      req,
    });

    res.json({
      success: true,
      data: { workspaceId },
    });
  } catch (error) {
    console.error('Switch workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to switch workspace',
      },
    });
  }
});

// GET /api/workspaces/:id/members - List workspace members (admin only)
export default router;
