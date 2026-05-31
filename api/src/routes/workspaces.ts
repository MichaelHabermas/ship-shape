import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { authMiddleware, workspaceAdminMiddleware } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';

const router = Router();

type WorkspaceRow = {
  id: string;
  name: string;
  sprint_start_date: Date | string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type WorkspaceListRow = WorkspaceRow & {
  role?: string | null;
};

type UserSuperAdminRow = {
  is_super_admin: boolean;
};

type IdRow = {
  id: string;
};

type WorkspaceSwitchRow = {
  id: string;
  name: string;
  archived_at: Date | null;
};

type ActiveMemberRow = {
  id: string;
  user_id: string;
  role: string;
  created_at: Date;
  email: string;
  name: string;
  person_document_id: string | null;
  is_archived: boolean;
};

type ArchivedMemberRow = {
  person_document_id: string;
  user_id: string | null;
  archived_at: Date | null;
  email: string | null;
  name: string | null;
  is_archived: boolean;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
};

type MembershipCreatedRow = {
  id: string;
  created_at: Date;
};

type RoleRow = {
  role: string;
};

type CountRow = {
  count: string | number;
};

type MembershipUpdatedRow = {
  id: string;
  role: string;
};

type PersonDocRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  archived_at: Date | null;
};

type InviteListRow = {
  id: string;
  email: string;
  token: string;
  role: string;
  expires_at: Date;
  created_at: Date;
  invited_by_name: string;
};

type InviteCreatedRow = {
  id: string;
  email: string;
  x509_subject_dn: string | null;
  role: string;
  expires_at: Date;
  created_at: Date;
};

type AuditLogRow = {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  actor_email: string;
  actor_name: string;
  impersonating_email: string | null;
};

type MutationRow = Record<string, never>;

type WorkspaceMemberResponse = {
  id: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  role: string | null;
  personDocumentId: string | null;
  joinedAt: Date | string | null;
  isArchived: boolean;
};

function toCount(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function requireFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error('Expected query to return a row');
  }
  return row;
}

function mapWorkspaceListItem(row: WorkspaceListRow) {
  return {
    id: row.id,
    name: row.name,
    sprintStartDate: row.sprint_start_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role,
  };
}

function mapSuperAdminWorkspaceItem(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    sprintStartDate: row.sprint_start_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: 'admin' as const,
    isSuperAdmin: true,
  };
}

function mapCurrentWorkspace(row: WorkspaceListRow) {
  return {
    id: row.id,
    name: row.name,
    sprintStartDate: row.sprint_start_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role || 'admin',
  };
}

function mapActiveMember(row: ActiveMemberRow): WorkspaceMemberResponse {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    personDocumentId: row.person_document_id,
    joinedAt: row.created_at,
    isArchived: false,
  };
}

function mapArchivedMember(row: ArchivedMemberRow): WorkspaceMemberResponse {
  return {
    id: row.person_document_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: null,
    personDocumentId: row.person_document_id,
    joinedAt: null,
    isArchived: true,
  };
}

function mapCreatedMembership(
  membership: MembershipCreatedRow,
  user: UserRow,
  userId: string,
  role: string,
  personDocumentId: string,
) {
  return {
    id: membership.id,
    userId,
    email: user.email,
    name: user.name,
    role,
    personDocumentId,
    createdAt: membership.created_at,
  };
}

function mapDirectAddMember(user: UserRow, role: string) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
  };
}

function mapInvite(row: InviteListRow) {
  return {
    id: row.id,
    email: row.email,
    token: row.token,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    invitedByName: row.invited_by_name,
  };
}

function mapCreatedInvite(row: InviteCreatedRow, token: string) {
  return {
    id: row.id,
    email: row.email,
    x509SubjectDn: row.x509_subject_dn,
    role: row.role,
    token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    details: row.details,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    impersonatingEmail: row.impersonating_email,
  };
}

function getQueryString(value: unknown, fallback: string): string {
  if (Array.isArray(value)) {
    const firstValue: unknown = value[0];
    return typeof firstValue === 'string' ? firstValue : fallback;
  }

  return typeof value === 'string' ? value : fallback;
}

const createInviteBodySchema = z.object({
  email: z.string().min(1),
  x509SubjectDn: z.string().optional(),
  role: z.enum(['admin', 'member']).optional(),
});

// GET /api/workspaces - List user's workspaces
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
router.get('/:id/audit-logs', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = String(req.params.id);
  const limit = getQueryString(req.query.limit, '100');
  const offset = getQueryString(req.query.offset, '0');

  try {
    const result = await pool.query<AuditLogRow>(
      `SELECT al.id, al.action, al.resource_type, al.resource_id, al.details,
              al.ip_address, al.user_agent, al.created_at,
              u.email as actor_email, u.name as actor_name,
              iu.email as impersonating_email
       FROM audit_logs al
       JOIN users u ON al.actor_user_id = u.id
       LEFT JOIN users iu ON al.impersonating_user_id = iu.id
       WHERE al.workspace_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2 OFFSET $3`,
      [workspaceId, parseInt(limit, 10), parseInt(offset, 10)]
    );

    const logs = result.rows.map(mapAuditLog);

    res.json({
      success: true,
      data: { logs },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get audit logs',
      },
    });
  }
});

export default router;
