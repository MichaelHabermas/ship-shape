import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware, workspaceAdminMiddleware } from '../../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../../services/audit.js';
import {
  type IdRow,
  type UserRow,
  type InviteListRow,
  type InviteCreatedRow,
  type MutationRow,
  requireFirstRow,
  mapDirectAddMember,
  mapInvite,
  mapCreatedInvite,
  createInviteBodySchema,
} from './shared.js';

const router = Router();
router.get('/:id/invites', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);

  try {
    const result = await pool.query<InviteListRow>(
      `SELECT wi.id, wi.email, wi.token, wi.role, wi.expires_at, wi.created_at,
              u.name as invited_by_name
       FROM workspace_invites wi
       JOIN users u ON wi.invited_by_user_id = u.id
       WHERE wi.workspace_id = $1 AND wi.used_at IS NULL AND wi.expires_at > NOW()
       ORDER BY wi.created_at DESC`,
      [workspaceId]
    );

    const invites = result.rows.map(mapInvite);

    res.json({
      success: true,
      data: { invites },
    });
  } catch (error) {
    console.error('List invites error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list invites',
      },
    });
  }
});

// POST /api/workspaces/:id/invites - Create invite (admin only)
// Email is always required (it's the login identifier)
// x509SubjectDn is optional - for PIV certificate matching when cert doesn't contain email
router.post('/:id/invites', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);
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
  if (!email || typeof email !== 'string') {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email is required',
      },
    });
    return;
  }

  try {
    // Check if user already exists and is a member (by email or subject DN)
    const existingUserResult = await pool.query<IdRow>(
      `SELECT u.id FROM users u
       JOIN workspace_memberships wm ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
         AND (($2::TEXT IS NOT NULL AND LOWER(u.email) = LOWER($2))
              OR ($3::TEXT IS NOT NULL AND u.x509_subject_dn = $3))`,
      [workspaceId, email || null, x509SubjectDn || null]
    );

    if (existingUserResult.rows[0]) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'User is already a member of this workspace',
        },
      });
      return;
    }

    // Check if user exists but is not a member (e.g., super admin or member of other workspace)
    // If so, directly add them as a member instead of creating a pending invite
    const existingNonMemberResult = await pool.query<UserRow>(
      `SELECT id, name, email FROM users
       WHERE ($1::TEXT IS NOT NULL AND LOWER(email) = LOWER($1))
          OR ($2::TEXT IS NOT NULL AND x509_subject_dn = $2)`,
      [email || null, x509SubjectDn || null]
    );

    if (existingNonMemberResult.rows[0]) {
      const existingUser = existingNonMemberResult.rows[0];

      // Create membership directly
      await pool.query<MutationRow>(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [workspaceId, existingUser.id, role]
      );

      // Check for existing pending person doc (from a previous invite attempt)
      const existingPendingPerson = await pool.query<IdRow>(
        `SELECT id FROM documents
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'pending' = 'true'
           AND archived_at IS NULL
           AND LOWER(properties->>'email') = LOWER($2)
         LIMIT 1`,
        [workspaceId, existingUser.email]
      );

      if (existingPendingPerson.rows[0]) {
        // Update existing pending person doc to be a real person doc
        await pool.query<MutationRow>(
          `UPDATE documents
           SET title = $1,
               properties = jsonb_build_object('user_id', $2::text, 'email', $3)
           WHERE id = $4`,
          [existingUser.name, existingUser.id, existingUser.email, existingPendingPerson.rows[0].id]
        );

        // Archive any OTHER pending person docs for same email (defensive cleanup)
        await pool.query<MutationRow>(
          `UPDATE documents SET archived_at = NOW()
           WHERE workspace_id = $1
             AND document_type = 'person'
             AND properties->>'pending' = 'true'
             AND archived_at IS NULL
             AND LOWER(properties->>'email') = LOWER($2)
             AND id != $3`,
          [workspaceId, existingUser.email, existingPendingPerson.rows[0].id]
        );
      } else {
        // Create person document with user_id (not pending)
        await pool.query<MutationRow>(
          `INSERT INTO documents (workspace_id, document_type, title, properties)
           VALUES ($1, 'person', $2, $3)`,
          [workspaceId, existingUser.name, JSON.stringify({
            user_id: existingUser.id,
            email: existingUser.email
          })]
        );

        // Archive any orphaned pending person docs for this email (defensive cleanup)
        await pool.query<MutationRow>(
          `UPDATE documents SET archived_at = NOW()
           WHERE workspace_id = $1
             AND document_type = 'person'
             AND properties->>'pending' = 'true'
             AND archived_at IS NULL
             AND LOWER(properties->>'email') = LOWER($2)`,
          [workspaceId, existingUser.email]
        );
      }

      // Cancel any active invites for this email since user is being added directly
      await pool.query<MutationRow>(
        `UPDATE workspace_invites SET used_at = NOW()
         WHERE workspace_id = $1
           AND LOWER(email) = LOWER($2)
           AND used_at IS NULL`,
        [workspaceId, existingUser.email]
      );

      await logAuditEvent({
        workspaceId,
        actorUserId: req.userId,
        action: 'member.add',
        resourceType: 'user',
        resourceId: existingUser.id,
        details: { email: existingUser.email, role },
        req,
      });

      res.status(HTTP_STATUS.CREATED).json({
        success: true,
        data: {
          member: mapDirectAddMember(existingUser, role),
          message: 'User added as member (existing account)',
        },
      });
      return;
    }

    // Check for existing pending invite (by email or subject DN)
    const existingInviteResult = await pool.query<IdRow>(
      `SELECT id FROM workspace_invites
       WHERE workspace_id = $1
         AND used_at IS NULL
         AND expires_at > NOW()
         AND (($2::TEXT IS NOT NULL AND LOWER(email) = LOWER($2))
              OR ($3::TEXT IS NOT NULL AND x509_subject_dn = $3))`,
      [workspaceId, email || null, x509SubjectDn || null]
    );

    if (existingInviteResult.rows[0]) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'An invite is already pending for this identity',
        },
      });
      return;
    }

    // Generate unique invite token (email-based invites use the link)
    const { v4: uuidv4 } = await import('uuid');
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const result = await pool.query<InviteCreatedRow>(
      `INSERT INTO workspace_invites (workspace_id, email, x509_subject_dn, token, role, invited_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, x509_subject_dn, role, expires_at, created_at`,
      [workspaceId, email, x509SubjectDn || null, token, role, req.userId, expiresAt]
    );

    const createdInvite = requireFirstRow(result.rows);

    // Create pending person document for the invited user
    // This allows them to appear in team lists and assignment dropdowns immediately
    const personTitle = email.split('@')[0]; // Use email prefix as name
    await pool.query<MutationRow>(
      `INSERT INTO documents (workspace_id, document_type, title, properties)
       VALUES ($1, 'person', $2, $3)`,
      [workspaceId, personTitle, JSON.stringify({
        pending: true,
        invite_id: createdInvite.id,
        email: email
      })]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId,
      action: 'invite.create',
      resourceType: 'invite',
      resourceId: createdInvite.id,
      details: { email: email || null, x509SubjectDn: x509SubjectDn || null, role },
      req,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        invite: mapCreatedInvite(createdInvite, token),
      },
    });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to create invite',
      },
    });
  }
});

// DELETE /api/workspaces/:id/invites/:inviteId - Revoke invite (admin only)
router.delete('/:id/invites/:inviteId', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);
  const inviteId = String(req.params.inviteId);

  try {
    const result = await pool.query<IdRow>(
      'DELETE FROM workspace_invites WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [inviteId, workspaceId]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Invite not found',
        },
      });
      return;
    }

    // Archive the pending person document associated with this invite
    await pool.query<MutationRow>(
      `UPDATE documents SET archived_at = NOW()
       WHERE workspace_id = $1
         AND document_type = 'person'
         AND properties->>'invite_id' = $2`,
      [workspaceId, inviteId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId,
      action: 'invite.delete',
      resourceType: 'invite',
      resourceId: inviteId,
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Revoke invite error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to revoke invite',
      },
    });
  }
});

// GET /api/workspaces/:id/audit-logs - Get workspace audit logs (admin only)
export default router;
