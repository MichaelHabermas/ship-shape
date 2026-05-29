import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../../services/audit.js';
import { getAuthenticatedUserContext } from '../../utils/auth-context.js';
import {
  type UserListRow,
  type UserBasicRow,
  type UserSuperAdminRow,
  mapUserListItem,
  mapUserBasic,
} from './types.js';

const router = Router();

// GET /api/admin/users - List all users
router.get('/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query<UserListRow>(
      `SELECT u.id, u.email, u.name, u.is_super_admin, u.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', wm.workspace_id,
                    'name', w.name,
                    'role', wm.role
                  )
                ) FILTER (WHERE wm.id IS NOT NULL),
                '[]'
              ) as workspaces
       FROM users u
       LEFT JOIN workspace_memberships wm ON u.id = wm.user_id
       LEFT JOIN workspaces w ON wm.workspace_id = w.id AND w.archived_at IS NULL
       GROUP BY u.id
       ORDER BY u.name`
    );

    const users = result.rows.map(mapUserListItem);

    res.json({
      success: true,
      data: { users },
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list users',
      },
    });
  }
});

// GET /api/admin/users/search - Search users by email (for adding to workspace)
router.get('/users/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, workspaceId } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      res.json({
        success: true,
        data: { users: [] },
      });
      return;
    }

    const searchTerm = `%${q.toLowerCase()}%`;

    // If workspaceId provided, exclude users already in that workspace
    let query: string;
    let params: (string | null)[];

    if (workspaceId && typeof workspaceId === 'string') {
      query = `
        SELECT u.id, u.email, u.name
        FROM users u
        WHERE LOWER(u.email) LIKE $1
        AND NOT EXISTS (
          SELECT 1 FROM workspace_memberships wm
          WHERE wm.user_id = u.id AND wm.workspace_id = $2
        )
        ORDER BY u.email
        LIMIT 10
      `;
      params = [searchTerm, workspaceId];
    } else {
      query = `
        SELECT u.id, u.email, u.name
        FROM users u
        WHERE LOWER(u.email) LIKE $1
        ORDER BY u.email
        LIMIT 10
      `;
      params = [searchTerm];
    }

    const result = await pool.query<UserBasicRow>(query, params);

    const users = result.rows.map(mapUserBasic);

    res.json({
      success: true,
      data: { users },
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to search users',
      },
    });
  }
});

// PATCH /api/admin/users/:id/super-admin - Toggle super-admin status
router.patch('/users/:id/super-admin', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const id = String(req.params.id);
  const { isSuperAdmin } = req.body;

  if (typeof isSuperAdmin !== 'boolean') {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'isSuperAdmin must be a boolean',
      },
    });
    return;
  }

  // Prevent removing your own super-admin status
  if (id === actorUserId && !isSuperAdmin) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Cannot remove your own super-admin status',
      },
    });
    return;
  }

  try {
    const result = await pool.query<UserSuperAdminRow>(
      `UPDATE users
       SET is_super_admin = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, is_super_admin`,
      [isSuperAdmin, id]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found',
        },
      });
      return;
    }

    await logAuditEvent({
      actorUserId,
      action: 'user.super_admin_toggle',
      resourceType: 'user',
      resourceId: id,
      details: { isSuperAdmin },
      req,
    });

    res.json({
      success: true,
      data: { isSuperAdmin: result.rows[0].is_super_admin },
    });
  } catch (error) {
    console.error('Toggle super-admin error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to update user',
      },
    });
  }
});

// GET /api/admin/audit-logs - Global audit logs

export default router;
