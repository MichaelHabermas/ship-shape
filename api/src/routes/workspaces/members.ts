import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware, workspaceAdminMiddleware } from '../../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../../services/audit.js';
import {
  type IdRow,
  type ActiveMemberRow,
  type ArchivedMemberRow,
  type UserRow,
  type MembershipCreatedRow,
  type RoleRow,
  type CountRow,
  type MembershipUpdatedRow,
  type PersonDocRow,
  type MutationRow,
  type WorkspaceMemberResponse,
  toCount,
  requireFirstRow,
  mapActiveMember,
  mapArchivedMember,
  mapCreatedMembership,
} from './shared.js';

const router = Router();
router.get('/:id/members', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);
  const includeArchived = req.query.includeArchived === 'true';

  try {
    // Query active members (with memberships)
    const activeResult = await pool.query<ActiveMemberRow>(
      `SELECT wm.id, wm.user_id, wm.role, wm.created_at,
              u.email, u.name,
              d.id as person_document_id,
              false as is_archived
       FROM workspace_memberships wm
       JOIN users u ON wm.user_id = u.id
       LEFT JOIN documents d ON d.workspace_id = wm.workspace_id
         AND d.document_type = 'person'
         AND d.properties->>'user_id' = wm.user_id::text
       WHERE wm.workspace_id = $1
       ORDER BY u.name`,
      [workspaceId]
    );

    let archivedRows: ArchivedMemberRow[] = [];
    if (includeArchived) {
      // Query archived members (person docs with archived_at but no membership)
      const archivedResult = await pool.query<ArchivedMemberRow>(
        `SELECT d.id as person_document_id,
                d.properties->>'user_id' as user_id,
                d.archived_at,
                COALESCE(d.properties->>'email', u.email) as email,
                COALESCE(d.title, u.name) as name,
                true as is_archived
         FROM documents d
         LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
         WHERE d.workspace_id = $1
           AND d.document_type = 'person'
           AND d.archived_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM workspace_memberships wm
             WHERE wm.workspace_id = d.workspace_id
               AND wm.user_id = (d.properties->>'user_id')::uuid
           )
         ORDER BY d.title`,
        [workspaceId]
      );
      archivedRows = archivedResult.rows;
    }

    const members: WorkspaceMemberResponse[] = [
      ...activeResult.rows.map(mapActiveMember),
      ...archivedRows.map(mapArchivedMember),
    ];

    res.json({
      success: true,
      data: { members },
    });
  } catch (error) {
    console.error('List members error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list members',
      },
    });
  }
});

// POST /api/workspaces/:id/members - Add member to workspace (admin only)
router.post('/:id/members', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);
  const body = req.body as { userId?: unknown; role?: unknown };
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const role: 'admin' | 'member' = body.role === 'admin' ? 'admin' : 'member';

  if (!userId) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'userId is required',
      },
    });
    return;
  }

  try {
    // Check if user exists
    const userResult = await pool.query<UserRow>('SELECT id, email, name FROM users WHERE id = $1', [userId]);
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

    const user = userResult.rows[0];

    // Check if already a member
    const existingResult = await pool.query<IdRow>(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );
    if (existingResult.rows[0]) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'User is already a member of this workspace',
        },
      });
      return;
    }

    // Create membership
    const membershipResult = await pool.query<MembershipCreatedRow>(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [workspaceId, userId, role]
    );

    // Create Person document for this user in this workspace (links via properties.user_id)
    const personDocResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'person', $2, $3, $4)
       RETURNING id`,
      [workspaceId, user.name, JSON.stringify({ user_id: userId, email: user.email }), req.userId]
    );
    const personDocumentId = requireFirstRow(personDocResult.rows).id;

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId,
      action: 'membership.create',
      resourceType: 'user',
      resourceId: userId,
      details: { role },
      req,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        membership: mapCreatedMembership(
          requireFirstRow(membershipResult.rows),
          user,
          userId,
          role,
          personDocumentId,
        ),
      },
    });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to add member',
      },
    });
  }
});

// PATCH /api/workspaces/:id/members/:userId - Update member role (admin only)
router.patch('/:id/members/:userId', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);
  const userId = String(req.params.userId);
  const patchBody = req.body as { role?: unknown };
  const role = patchBody.role;

  if (typeof role !== 'string' || !['admin', 'member'].includes(role)) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Valid role (admin or member) is required',
      },
    });
    return;
  }

  try {
    // If demoting to member, check this isn't the last admin
    if (role === 'member') {
      const adminCountResult = await pool.query<CountRow>(
        `SELECT COUNT(*) as count FROM workspace_memberships
         WHERE workspace_id = $1 AND role = 'admin'`,
        [workspaceId]
      );

      const currentMemberResult = await pool.query<RoleRow>(
        'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );

      if (
        currentMemberResult.rows[0]?.role === 'admin' &&
        toCount(requireFirstRow(adminCountResult.rows).count) <= 1
      ) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Cannot demote the last admin. Workspace must have at least one admin.',
          },
        });
        return;
      }
    }

    const result = await pool.query<MembershipUpdatedRow>(
      `UPDATE workspace_memberships
       SET role = $1, updated_at = NOW()
       WHERE workspace_id = $2 AND user_id = $3
       RETURNING id, role`,
      [role, workspaceId, userId]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Membership not found',
        },
      });
      return;
    }

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId,
      action: 'membership.update',
      resourceType: 'user',
      resourceId: userId,
      details: { newRole: role },
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

// DELETE /api/workspaces/:id/members/:userId - Remove member (admin only)
router.delete('/:id/members/:userId', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);
  const userId = String(req.params.userId);

  try {
    // Check this isn't the last admin
    const memberResult = await pool.query<RoleRow>(
      'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    if (!memberResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Membership not found',
        },
      });
      return;
    }

    if (memberResult.rows[0].role === 'admin') {
      const adminCountResult = await pool.query<CountRow>(
        `SELECT COUNT(*) as count FROM workspace_memberships
         WHERE workspace_id = $1 AND role = 'admin'`,
        [workspaceId]
      );

      if (toCount(requireFirstRow(adminCountResult.rows).count) <= 1) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Cannot remove the last admin. Workspace must have at least one admin.',
          },
        });
        return;
      }
    }

    // Delete membership
    await pool.query<MutationRow>(
      'DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    // Archive the person document (preserve for audit history)
    await pool.query<MutationRow>(
      `UPDATE documents SET archived_at = NOW()
       WHERE workspace_id = $1 AND document_type = 'person' AND properties->>'user_id' = $2`,
      [workspaceId, userId]
    );

    // Clear owner_id on programs owned by this user (set to Unassigned)
    await pool.query<MutationRow>(
      `UPDATE documents SET properties = properties - 'owner_id', updated_at = NOW()
       WHERE workspace_id = $1 AND document_type = 'program' AND properties->>'owner_id' = $2`,
      [workspaceId, userId]
    );

    // Clear owner_id on sprints owned by this user (set to Unassigned)
    await pool.query<MutationRow>(
      `UPDATE documents SET properties = properties - 'owner_id', updated_at = NOW()
       WHERE workspace_id = $1 AND document_type = 'sprint' AND properties->>'owner_id' = $2`,
      [workspaceId, userId]
    );

    // Invalidate all sessions for this user in this workspace
    await pool.query<MutationRow>(
      'DELETE FROM sessions WHERE user_id = $1 AND workspace_id = $2',
      [userId, workspaceId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId,
      action: 'membership.delete',
      resourceType: 'user',
      resourceId: userId,
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

// POST /api/workspaces/:id/members/:userId/restore - Restore archived member (admin only)
router.post('/:id/members/:userId/restore', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);
  const userId = String(req.params.userId);

  try {
    // Verify the person document exists and is archived
    const personResult = await pool.query<PersonDocRow>(
      `SELECT d.id, d.title, d.properties, d.archived_at
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND d.properties->>'user_id' = $2`,
      [workspaceId, userId]
    );

    if (personResult.rows.length === 0) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Person document not found',
        },
      });
      return;
    }

    const person = requireFirstRow(personResult.rows);
    if (!person.archived_at) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'User is not archived',
        },
      });
      return;
    }

    // Check if membership already exists (shouldn't, but be safe)
    const membershipCheck = await pool.query<IdRow>(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    if (membershipCheck.rows.length === 0) {
      // Re-create the membership as a regular member
      await pool.query<MutationRow>(
        'INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [workspaceId, userId, 'member']
      );
    }

    // Clear archived_at from person document
    await pool.query<MutationRow>(
      `UPDATE documents SET archived_at = NULL, updated_at = NOW()
       WHERE workspace_id = $1 AND document_type = 'person' AND properties->>'user_id' = $2`,
      [workspaceId, userId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId,
      action: 'membership.restore',
      resourceType: 'user',
      resourceId: userId,
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Restore member error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to restore member',
      },
    });
  }
});

// GET /api/workspaces/:id/invites - List pending invites (admin only)
export default router;
