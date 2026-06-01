// Admin workspace member and invite management routes.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../../../db/client.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../../../services/audit.js';
import { getAuthenticatedUserContext } from '../../../utils/auth-context.js';
import {
  type EmptyRow,
  type IdRow,
  type WorkspaceNameRow,
  type UserBasicRow,
  type WorkspaceMemberRow,
  type MemberRoleRow,
  type CountRow,
  type MembershipRow,
  toNumber,
  requireFirstRow,
  mapUserBasic,
  mapWorkspaceMember,
} from '../types.js';

const addMemberBodySchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['admin', 'member']).optional(),
});

const updateMemberRoleBodySchema = z.object({
  role: z.enum(['admin', 'member']),
});

const router = Router();
router.get('/workspaces/:id/members', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);

  try {
    // Check workspace exists
    const workspaceResult = await pool.query<IdRow>('SELECT id FROM workspaces WHERE id = $1', [id]);
    if (!workspaceResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    const result = await pool.query<WorkspaceMemberRow>(
      `SELECT wm.user_id, wm.role, u.email, u.name
       FROM workspace_memberships wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1
       ORDER BY u.name`,
      [id]
    );

    const members = result.rows.map(mapWorkspaceMember);

    res.json({
      success: true,
      data: { members },
    });
  } catch (error) {
    console.error('List workspace members error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list workspace members',
      },
    });
  }
});

// GET /api/admin/workspaces/:id/invites - List pending invites
router.post('/workspaces/:id/members', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const id = String(req.params.id);
  const parsedBody = addMemberBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'userId is required',
      },
    });
    return;
  }
  const { userId, role = 'member' } = parsedBody.data;

  try {
    // Validate role
    if (role !== 'admin' && role !== 'member') {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Role must be admin or member',
        },
      });
      return;
    }

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'userId is required',
        },
      });
      return;
    }

    // Check workspace exists
    const workspaceResult = await pool.query<WorkspaceNameRow>('SELECT id, name FROM workspaces WHERE id = $1', [id]);
    if (!workspaceResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    // Check user exists
    const userResult = await pool.query<UserBasicRow>('SELECT id, email, name FROM users WHERE id = $1', [userId]);
    if (!userResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found',
        },
      });
      return;
    }

    const targetUser = userResult.rows[0];

    // Check if user is already a member
    const existingMember = await pool.query<IdRow>(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (existingMember.rows[0]) {
      res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        error: {
          code: ERROR_CODES.ALREADY_EXISTS,
          message: 'User is already a member of this workspace',
        },
      });
      return;
    }

    // Create the membership
    const membershipResult = await pool.query<MembershipRow>(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [id, userId, role]
    );

    const membership = requireFirstRow(membershipResult.rows);

    // Create Person document for this user in this workspace (links via properties.user_id)
    await pool.query<EmptyRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'person', $2, $3, $4)`,
      [id, targetUser.name, JSON.stringify({ user_id: userId, email: targetUser.email }), actorUserId]
    );

    // Audit log
    await logAuditEvent({
      workspaceId: id,
      actorUserId,
      action: 'workspace.member_add',
      resourceType: 'workspace_membership',
      resourceId: membership.id,
      details: {
        addedUserId: userId,
        addedUserEmail: targetUser.email,
        role,
      },
      req,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        member: {
          ...mapUserBasic(targetUser),
          role,
        },
      },
    });
  } catch (error) {
    console.error('Add workspace member error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to add workspace member',
      },
    });
  }
});

// PATCH /api/admin/workspaces/:workspaceId/members/:userId - Update member role
router.patch('/workspaces/:workspaceId/members/:userId', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const workspaceId = String(req.params.workspaceId);
  const userId = String(req.params.userId);
  const parsedBody = updateMemberRoleBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Role must be admin or member',
      },
    });
    return;
  }
  const { role } = parsedBody.data;

  if (role !== 'admin' && role !== 'member') {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Role must be admin or member',
      },
    });
    return;
  }

  try {
    // Check workspace exists
    const workspaceResult = await pool.query<IdRow>('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (!workspaceResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    // Check membership exists and get current role
    const memberResult = await pool.query<MemberRoleRow>(
      `SELECT wm.role, u.email FROM workspace_memberships wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
      [workspaceId, userId]
    );

    if (!memberResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Member not found',
        },
      });
      return;
    }

    const oldRole = memberResult.rows[0].role;

    // If demoting from admin, check there's at least one other admin
    if (oldRole === 'admin' && role === 'member') {
      const adminCount = await pool.query<CountRow>(
        `SELECT COUNT(*) FROM workspace_memberships
         WHERE workspace_id = $1 AND role = 'admin'`,
        [workspaceId]
      );
      if (toNumber(adminCount.rows[0]?.count) <= 1) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Workspace must have at least one admin',
          },
        });
        return;
      }
    }

    // Update role
    await pool.query<EmptyRow>(
      `UPDATE workspace_memberships SET role = $1, updated_at = NOW()
       WHERE workspace_id = $2 AND user_id = $3`,
      [role, workspaceId, userId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId,
      action: 'workspace.member_role_update',
      resourceType: 'workspace_membership',
      resourceId: userId,
      details: { email: memberResult.rows[0].email, oldRole, newRole: role },
      req,
    });

    res.json({
      success: true,
      data: { role },
    });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to update member role',
      },
    });
  }
});

// DELETE /api/admin/workspaces/:workspaceId/members/:userId - Remove member
router.delete('/workspaces/:workspaceId/members/:userId', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const workspaceId = String(req.params.workspaceId);
  const userId = String(req.params.userId);

  try {
    // Check workspace exists
    const workspaceResult = await pool.query<IdRow>('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (!workspaceResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    // Check membership exists and get role
    const memberResult = await pool.query<MemberRoleRow>(
      `SELECT wm.role, u.email FROM workspace_memberships wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
      [workspaceId, userId]
    );

    if (!memberResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Member not found',
        },
      });
      return;
    }

    // If removing an admin, check there's at least one other admin
    if (memberResult.rows[0].role === 'admin') {
      const adminCount = await pool.query<CountRow>(
        `SELECT COUNT(*) FROM workspace_memberships
         WHERE workspace_id = $1 AND role = 'admin'`,
        [workspaceId]
      );
      if (toNumber(adminCount.rows[0]?.count) <= 1) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Workspace must have at least one admin',
          },
        });
        return;
      }
    }

    // Clear assignee fields for this user's assigned documents (assignee_id is in properties JSONB)
    await pool.query<EmptyRow>(
      `UPDATE documents SET properties = properties - 'assignee_id', updated_at = NOW()
       WHERE workspace_id = $1 AND properties->>'assignee_id' = $2`,
      [workspaceId, userId]
    );

    // Delete the membership
    await pool.query<EmptyRow>(
      `DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );

    // Delete sessions for this workspace
    await pool.query<EmptyRow>(
      `DELETE FROM sessions WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId,
      action: 'workspace.member_remove',
      resourceType: 'workspace_membership',
      resourceId: userId,
      details: { email: memberResult.rows[0].email, role: memberResult.rows[0].role },
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to remove member',
      },
    });
  }
});

// GET /api/admin/debug/users - Raw user data for debugging duplicates

export default router;
