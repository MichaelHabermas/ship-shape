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
  type WorkspaceInviteRow,
  type WorkspaceInviteCreateRow,
  type InviteRevokeRow,
  requireFirstRow,
  mapWorkspaceInvite,
  mapWorkspaceInviteCreated,
} from '../types.js';

const createInviteBodySchema = z.object({
  email: z.string().email(),
  x509SubjectDn: z.string().optional(),
  role: z.enum(['admin', 'member']).optional(),
});

const router = Router();
router.get('/workspaces/:id/invites', async (req: Request, res: Response): Promise<void> => {
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

    const result = await pool.query<WorkspaceInviteRow>(
      `SELECT id, email, role, token, created_at
       FROM workspace_invites
       WHERE workspace_id = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [id]
    );

    const invites = result.rows.map(mapWorkspaceInvite);

    res.json({
      success: true,
      data: { invites },
    });
  } catch (error) {
    console.error('List workspace invites error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list workspace invites',
      },
    });
  }
});

// POST /api/admin/workspaces/:id/invites - Create invite
// Email is always required (it's the login identifier)
// x509SubjectDn is optional - for PIV certificate matching when cert doesn't contain email
router.post('/workspaces/:id/invites', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const id = String(req.params.id);
  const parsedBody = createInviteBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email is required',
      },
    });
    return;
  }
  const { email, x509SubjectDn, role = 'member' } = parsedBody.data;

  // Email is always required
  if (!email) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email is required',
      },
    });
    return;
  }

  // Validate email format
  if (typeof email !== 'string') {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email must be a string',
      },
    });
    return;
  }
  const emailLower = email.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailLower)) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid email format',
      },
    });
    return;
  }

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

    // Check if user is already a member (by email or subject DN)
    const memberCheck = await pool.query<IdRow>(
      `SELECT wm.id FROM workspace_memberships wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1
         AND (($2::TEXT IS NOT NULL AND LOWER(u.email) = $2)
              OR ($3::TEXT IS NOT NULL AND u.x509_subject_dn = $3))`,
      [id, emailLower, x509SubjectDn || null]
    );
    if (memberCheck.rows[0]) {
      res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        error: {
          code: ERROR_CODES.ALREADY_EXISTS,
          message: 'User is already a member of this workspace',
        },
      });
      return;
    }

    // Check for existing pending invite (by email or subject DN)
    const inviteCheck = await pool.query<IdRow>(
      `SELECT id FROM workspace_invites
       WHERE workspace_id = $1
         AND used_at IS NULL
         AND expires_at > NOW()
         AND (($2::TEXT IS NOT NULL AND LOWER(email) = $2)
              OR ($3::TEXT IS NOT NULL AND x509_subject_dn = $3))`,
      [id, emailLower, x509SubjectDn || null]
    );
    if (inviteCheck.rows[0]) {
      res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        error: {
          code: ERROR_CODES.ALREADY_EXISTS,
          message: 'Invitation already pending for this identity',
        },
      });
      return;
    }

    // Generate unique invite token
    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const result = await pool.query<WorkspaceInviteCreateRow>(
      `INSERT INTO workspace_invites (workspace_id, email, x509_subject_dn, role, token, expires_at, invited_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, x509_subject_dn, role, token, created_at`,
      [id, emailLower, x509SubjectDn || null, role, token, expiresAt, actorUserId]
    );

    const invite = requireFirstRow(result.rows);

    await logAuditEvent({
      workspaceId: id,
      actorUserId,
      action: 'workspace.invite_create',
      resourceType: 'workspace_invite',
      resourceId: invite.id,
      details: { email: emailLower, x509SubjectDn: x509SubjectDn || null, role },
      req,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        invite: mapWorkspaceInviteCreated(invite),
      },
    });
  } catch (error) {
    console.error('Create workspace invite error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to create workspace invite',
      },
    });
  }
});

// DELETE /api/admin/workspaces/:workspaceId/invites/:inviteId - Revoke invite
router.delete('/workspaces/:workspaceId/invites/:inviteId', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const workspaceId = String(req.params.workspaceId);
  const inviteId = String(req.params.inviteId);

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

    // Delete the invite
    const result = await pool.query<InviteRevokeRow>(
      `DELETE FROM workspace_invites
       WHERE id = $1 AND workspace_id = $2 AND used_at IS NULL
       RETURNING id, email`,
      [inviteId, workspaceId]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Invite not found or already accepted',
        },
      });
      return;
    }

    // Archive the pending person document associated with this invite
    await pool.query<EmptyRow>(
      `UPDATE documents SET archived_at = NOW()
       WHERE workspace_id = $1
         AND document_type = 'person'
         AND properties->>'invite_id' = $2`,
      [workspaceId, inviteId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId,
      action: 'workspace.invite_revoke',
      resourceType: 'workspace_invite',
      resourceId: inviteId,
      details: { email: result.rows[0].email },
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Revoke workspace invite error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to revoke workspace invite',
      },
    });
  }
});
export default router;
