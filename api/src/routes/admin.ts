import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';
import { getAuthenticatedUserContext } from '../utils/auth-context.js';

const router = Router();

type EmptyRow = Record<string, never>;

type WorkspaceRow = {
  id: string;
  name: string;
  sprint_start_date: string | Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type WorkspaceListRow = WorkspaceRow & {
  member_count: string | number;
};

type IdRow = {
  id: string;
};

type WorkspaceNameRow = {
  id: string;
  name: string;
};

type UserWorkspaceJson = {
  id: string;
  name: string;
  role: string;
};

type UserListRow = {
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
  created_at: Date;
  workspaces: UserWorkspaceJson[];
};

type UserBasicRow = {
  id: string;
  email: string;
  name: string;
};

type UserSuperAdminRow = {
  id: string;
  is_super_admin: boolean;
};

type AuditLogRow = {
  id: string;
  workspace_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  actor_email: string;
  actor_name: string;
  impersonating_email: string | null;
  workspace_name: string | null;
};

type AuditLogExportRow = {
  created_at: Date;
  workspace_name: string | null;
  actor_email: string;
  impersonating_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
};

type WorkspaceMemberRow = {
  user_id: string;
  role: string;
  email: string;
  name: string;
};

type WorkspaceInviteRow = {
  id: string;
  email: string;
  role: string;
  token: string;
  created_at: Date;
};

type WorkspaceInviteCreateRow = {
  id: string;
  email: string;
  x509_subject_dn: string | null;
  role: string;
  token: string;
  created_at: Date;
};

type InviteRevokeRow = {
  id: string;
  email: string;
};

type MemberRoleRow = {
  role: string;
  email: string;
};

type CountRow = {
  count: string | number;
};

type MembershipRow = {
  id: string;
  created_at: Date;
};

type DebugUserRow = {
  id: string;
  email: string;
  name: string;
  x509_subject_dn: string | null;
  is_super_admin: boolean;
  last_auth_provider: string | null;
  last_workspace_id: string | null;
  created_at: Date;
  updated_at: Date;
  email_lower: string;
  membership_count: string | number;
  session_count: string | number;
};

type DebugMembershipRow = {
  user_id: string;
  workspace_id: string;
  role: string;
  workspace_name: string;
  archived_at: Date | null;
};

type DanglingAssociationRow = {
  association_id: string;
  document_id: string;
  related_id: string;
  relationship_type: string;
  document_title: string;
  document_type: string;
  workspace_name: string;
};

type OrphanDocumentRow = {
  id: string;
  title: string;
  workspace_name: string;
  created_at: Date;
  sprint_status?: string | null;
  state?: string | null;
};

type DeleteDanglingRow = {
  id: string;
};

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

function requireFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error('Expected query to return a row');
  }
  return row;
}

function mapWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    sprintStartDate: row.sprint_start_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkspaceListItem(row: WorkspaceListRow) {
  return {
    ...mapWorkspace(row),
    memberCount: toNumber(row.member_count),
  };
}

function mapUserListItem(row: UserListRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isSuperAdmin: row.is_super_admin,
    createdAt: row.created_at,
    workspaces: row.workspaces,
  };
}

function mapUserBasic(row: UserBasicRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
  };
}

function mapAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
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

function mapWorkspaceMember(row: WorkspaceMemberRow) {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

function mapWorkspaceInvite(row: WorkspaceInviteRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    token: row.token,
    createdAt: row.created_at,
  };
}

function mapWorkspaceInviteCreated(row: WorkspaceInviteCreateRow) {
  return {
    id: row.id,
    email: row.email,
    x509SubjectDn: row.x509_subject_dn,
    role: row.role,
    token: row.token,
    createdAt: row.created_at,
  };
}

// All admin routes require super-admin
router.use(authMiddleware, superAdminMiddleware);

// GET /api/admin/workspaces - List all workspaces (including archived)
router.get('/workspaces', async (req: Request, res: Response): Promise<void> => {
  const { includeArchived } = req.query;

  try {
    let query = `SELECT w.id, w.name, w.sprint_start_date, w.archived_at, w.created_at, w.updated_at,
                        (SELECT COUNT(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id) as member_count
                 FROM workspaces w`;

    if (includeArchived !== 'true') {
      query += ' WHERE w.archived_at IS NULL';
    }

    query += ' ORDER BY w.name';

    const result = await pool.query<WorkspaceListRow>(query);

    const workspaces = result.rows.map(mapWorkspaceListItem);

    res.json({
      success: true,
      data: { workspaces },
    });
  } catch (error) {
    console.error('Admin list workspaces error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list workspaces',
      },
    });
  }
});

// POST /api/admin/workspaces - Create workspace
router.post('/workspaces', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Workspace name is required',
      },
    });
    return;
  }

  try {
    const result = await pool.query<WorkspaceRow>(
      `INSERT INTO workspaces (name)
       VALUES ($1)
       RETURNING id, name, sprint_start_date, archived_at, created_at, updated_at`,
      [name.trim()]
    );

    const workspace = requireFirstRow(result.rows);

    // Create "Welcome to Ship" document for new workspaces
    const welcomeContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Welcome to Ship' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ship is your workspace for managing projects, sprints, and issues. Here are some things you can do:' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Create wiki pages to document your team\'s knowledge' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Create projects to organize your work' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Create issues and assign them to sprints' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Collaborate in real-time with your team' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Feel free to edit or delete this page. Happy shipping!' }],
        },
      ],
    };

    await pool.query<EmptyRow>(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'Welcome to Ship', $2, $3)`,
      [workspace.id, JSON.stringify(welcomeContent), actorUserId]
    );

    await logAuditEvent({
      workspaceId: workspace.id,
      actorUserId,
      action: 'workspace.create',
      resourceType: 'workspace',
      resourceId: workspace.id,
      details: { name },
      req,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        workspace: mapWorkspace(workspace),
      },
    });
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to create workspace',
      },
    });
  }
});

// PATCH /api/admin/workspaces/:id - Update workspace
router.patch('/workspaces/:id', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const workspaceId = String(req.params.id); // Always defined from route
  const { name, sprintStartDate } = req.body;

  // At least one field must be provided
  if (!name && !sprintStartDate) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'At least one field (name or sprintStartDate) is required',
      },
    });
    return;
  }

  // Validate name if provided
  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Workspace name must be a non-empty string',
      },
    });
    return;
  }

  // Validate sprintStartDate if provided (should be YYYY-MM-DD format)
  if (sprintStartDate !== undefined) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(sprintStartDate)) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'sprintStartDate must be in YYYY-MM-DD format',
        },
      });
      return;
    }
  }

  try {
    // Build dynamic update query
    const updates: string[] = [];
    const values: string[] = [];
    let paramIndex = 1;

    if (name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }
    if (sprintStartDate) {
      updates.push(`sprint_start_date = $${paramIndex++}`);
      values.push(sprintStartDate);
    }
    updates.push('updated_at = NOW()');
    values.push(workspaceId);

    const result = await pool.query<WorkspaceRow>(
      `UPDATE workspaces
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, name, sprint_start_date, archived_at, created_at, updated_at`,
      values
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    const workspace = requireFirstRow(result.rows);

    await logAuditEvent({
      workspaceId,
      actorUserId,
      action: 'workspace.update',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { name, sprintStartDate },
      req,
    });

    res.json({
      success: true,
      data: {
        workspace: mapWorkspace(workspace),
      },
    });
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to update workspace',
      },
    });
  }
});

// POST /api/admin/workspaces/:id/archive - Archive workspace
router.post('/workspaces/:id/archive', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const id = String(req.params.id);

  try {
    const result = await pool.query<IdRow>(
      `UPDATE workspaces
       SET archived_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found or already archived',
        },
      });
      return;
    }

    // Invalidate all sessions for this workspace
    await pool.query<EmptyRow>('DELETE FROM sessions WHERE workspace_id = $1', [id]);

    await logAuditEvent({
      workspaceId: id,
      actorUserId,
      action: 'workspace.archive',
      resourceType: 'workspace',
      resourceId: id,
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Archive workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to archive workspace',
      },
    });
  }
});

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
router.get('/audit-logs', async (req: Request, res: Response): Promise<void> => {
  const { limit = '100', offset = '0', workspaceId, userId, action } = req.query;

  try {
    let query = `
      SELECT al.id, al.workspace_id, al.action, al.resource_type, al.resource_id, al.details,
             al.ip_address, al.user_agent, al.created_at,
             u.email as actor_email, u.name as actor_name,
             iu.email as impersonating_email,
             w.name as workspace_name
      FROM audit_logs al
      JOIN users u ON al.actor_user_id = u.id
      LEFT JOIN users iu ON al.impersonating_user_id = iu.id
      LEFT JOIN workspaces w ON al.workspace_id = w.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (workspaceId) {
      query += ` AND al.workspace_id = $${paramIndex}`;
      params.push(workspaceId as string);
      paramIndex++;
    }

    if (userId) {
      query += ` AND al.actor_user_id = $${paramIndex}`;
      params.push(userId as string);
      paramIndex++;
    }

    if (action) {
      query += ` AND al.action = $${paramIndex}`;
      params.push(action as string);
      paramIndex++;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query<AuditLogRow>(query, params);

    const logs = result.rows.map(mapAuditLog);

    res.json({
      success: true,
      data: { logs },
    });
  } catch (error) {
    console.error('Get global audit logs error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get audit logs',
      },
    });
  }
});

// GET /api/admin/audit-logs/export - Export audit logs as CSV
router.get('/audit-logs/export', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, startDate, endDate } = req.query;

  try {
    let query = `
      SELECT al.created_at, w.name as workspace_name, u.email as actor_email,
             iu.email as impersonating_email, al.action, al.resource_type,
             al.resource_id, al.details, al.ip_address
      FROM audit_logs al
      JOIN users u ON al.actor_user_id = u.id
      LEFT JOIN users iu ON al.impersonating_user_id = iu.id
      LEFT JOIN workspaces w ON al.workspace_id = w.id
      WHERE 1=1
    `;
    const params: (string | Date)[] = [];
    let paramIndex = 1;

    if (workspaceId) {
      query += ` AND al.workspace_id = $${paramIndex}`;
      params.push(workspaceId as string);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND al.created_at >= $${paramIndex}`;
      params.push(new Date(startDate as string));
      paramIndex++;
    }

    if (endDate) {
      query += ` AND al.created_at <= $${paramIndex}`;
      params.push(new Date(endDate as string));
      paramIndex++;
    }

    query += ' ORDER BY al.created_at DESC';

    const result = await pool.query<AuditLogExportRow>(query, params);

    // Generate CSV
    const headers = ['Timestamp', 'Workspace', 'Actor', 'Impersonating', 'Action', 'Resource Type', 'Resource ID', 'Details', 'IP Address'];
    const rows = result.rows.map(row => [
      row.created_at.toISOString(),
      row.workspace_name || '',
      row.actor_email,
      row.impersonating_email || '',
      row.action,
      row.resource_type || '',
      row.resource_id || '',
      row.details ? JSON.stringify(row.details) : '',
      row.ip_address || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export audit logs error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to export audit logs',
      },
    });
  }
});

// POST /api/admin/impersonate/:userId - Start impersonation
router.post('/impersonate/:userId', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const userId = String(req.params.userId);

  try {
    // Get target user
    const userResult = await pool.query<UserBasicRow>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId]
    );

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

    // Store impersonation in session (we'll update session table to track this)
    // For now, return impersonation data that frontend can track
    await logAuditEvent({
      actorUserId,
      action: 'impersonation.start',
      resourceType: 'user',
      resourceId: userId,
      details: { targetEmail: userResult.rows[0].email },
      req,
    });

    res.json({
      success: true,
      data: {
        impersonating: mapUserBasic(userResult.rows[0]),
      },
    });
  } catch (error) {
    console.error('Start impersonation error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to start impersonation',
      },
    });
  }
});

// DELETE /api/admin/impersonate - End impersonation
router.delete('/impersonate', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);

  try {
    await logAuditEvent({
      actorUserId,
      action: 'impersonation.end',
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('End impersonation error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to end impersonation',
      },
    });
  }
});

// ============================================================================
// Workspace Member Management
// ============================================================================

// GET /api/admin/workspaces/:id - Get workspace details
router.get('/workspaces/:id', async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);

  try {
    const result = await pool.query<WorkspaceRow>(
      `SELECT id, name, sprint_start_date, archived_at, created_at, updated_at
       FROM workspaces WHERE id = $1`,
      [id]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    const workspace = requireFirstRow(result.rows);

    res.json({
      success: true,
      data: {
        workspace: mapWorkspace(workspace),
      },
    });
  } catch (error) {
    console.error('Get workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get workspace',
      },
    });
  }
});

// GET /api/admin/workspaces/:id/members - List workspace members
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
  const { email, x509SubjectDn, role = 'member' } = req.body;

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

// POST /api/admin/workspaces/:id/members - Add existing user directly to workspace
router.post('/workspaces/:id/members', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const id = String(req.params.id);
  const { userId, role = 'member' } = req.body;

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
  const { role } = req.body;

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
router.get('/debug/users', async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all users with raw data
    const usersResult = await pool.query<DebugUserRow>(
      `SELECT
         u.id,
         u.email,
         u.name,
         u.x509_subject_dn,
         u.is_super_admin,
         u.last_auth_provider,
         u.last_workspace_id,
         u.created_at,
         u.updated_at,
         LOWER(u.email) as email_lower,
         (SELECT COUNT(*) FROM workspace_memberships wm WHERE wm.user_id = u.id) as membership_count,
         (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) as session_count
       FROM users u
       ORDER BY LOWER(u.email), u.created_at`
    );

    // Get workspace memberships separately for detail
    const membershipsResult = await pool.query<DebugMembershipRow>(
      `SELECT
         wm.user_id,
         wm.workspace_id,
         wm.role,
         w.name as workspace_name,
         w.archived_at
       FROM workspace_memberships wm
       JOIN workspaces w ON wm.workspace_id = w.id
       ORDER BY wm.user_id`
    );

    // Group memberships by user
    const membershipsByUser: Record<string, Array<{
      workspaceId: string;
      workspaceName: string;
      role: string;
      archived: boolean;
    }>> = {};

    for (const m of membershipsResult.rows) {
      const userId = m.user_id as string;
      if (!membershipsByUser[userId]) {
        membershipsByUser[userId] = [];
      }
      membershipsByUser[userId].push({
        workspaceId: m.workspace_id,
        workspaceName: m.workspace_name,
        role: m.role,
        archived: !!m.archived_at,
      });
    }

    // Identify potential duplicates (same email_lower)
    const emailCounts: Record<string, number> = {};
    for (const u of usersResult.rows) {
      const emailLower = u.email_lower as string;
      emailCounts[emailLower] = (emailCounts[emailLower] ?? 0) + 1;
    }

    const users = usersResult.rows.map(row => ({
      id: row.id,
      email: row.email,
      emailLower: row.email_lower,
      name: row.name,
      x509SubjectDn: row.x509_subject_dn,
      isSuperAdmin: row.is_super_admin,
      lastAuthProvider: row.last_auth_provider,
      lastWorkspaceId: row.last_workspace_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      membershipCount: toNumber(row.membership_count),
      sessionCount: toNumber(row.session_count),
      memberships: membershipsByUser[row.id] || [],
      isDuplicate: (emailCounts[row.email_lower as string] ?? 0) > 1,
    }));

    // Summary stats
    const duplicateEmails = Object.entries(emailCounts)
      .filter(([, count]) => count > 1)
      .map(([email, count]) => ({ email, count }));

    res.json({
      success: true,
      data: {
        users,
        summary: {
          totalUsers: users.length,
          duplicateEmails,
          usersWithNoMemberships: users.filter(u => u.membershipCount === 0).length,
          usersWithNoSessions: users.filter(u => u.sessionCount === 0).length,
        },
      },
    });
  } catch (error) {
    console.error('Debug users error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get debug user data',
      },
    });
  }
});

// GET /api/admin/debug/orphans - Diagnose orphaned entities (documents with missing associations)
router.get('/debug/orphans', async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Dangling associations - pointing to deleted documents
    const danglingResult = await pool.query<DanglingAssociationRow>(`
      SELECT
        da.id AS association_id,
        da.document_id,
        da.related_id,
        da.relationship_type,
        d.title AS document_title,
        d.document_type,
        w.name AS workspace_name
      FROM document_associations da
      JOIN documents d ON da.document_id = d.id
      JOIN workspaces w ON d.workspace_id = w.id
      LEFT JOIN documents d2 ON da.related_id = d2.id
      WHERE d2.id IS NULL
    `);

    // Note: program_id column was dropped by migration 029.
    // This check is now a no-op but we keep the structure for API compatibility.
    const missingProgramAssocResult = { rows: [] };

    // 3. Projects without program association (in junction table)
    const projectsWithoutProgramResult = await pool.query<OrphanDocumentRow>(`
      SELECT
        d.id,
        d.title,
        w.name AS workspace_name,
        d.created_at
      FROM documents d
      JOIN workspaces w ON d.workspace_id = w.id
      WHERE d.document_type = 'project'
        AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id AND da.relationship_type = 'program'
        )
      ORDER BY d.created_at DESC
    `);

    // 4. Sprints without project association
    const sprintsWithoutProjectResult = await pool.query<OrphanDocumentRow>(`
      SELECT
        d.id,
        d.title,
        w.name AS workspace_name,
        d.created_at,
        d.properties->>'sprint_status' AS sprint_status
      FROM documents d
      JOIN workspaces w ON d.workspace_id = w.id
      WHERE d.document_type = 'sprint'
        AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id AND da.relationship_type = 'project'
        )
      ORDER BY d.created_at DESC
    `);

    // 5. Issues without project association
    const issuesWithoutProjectResult = await pool.query<OrphanDocumentRow>(`
      SELECT
        d.id,
        d.title,
        w.name AS workspace_name,
        d.created_at,
        d.properties->>'state' AS state
      FROM documents d
      JOIN workspaces w ON d.workspace_id = w.id
      WHERE d.document_type = 'issue'
        AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id AND da.relationship_type = 'project'
        )
      ORDER BY d.created_at DESC
      LIMIT 100
    `);

    res.json({
      success: true,
      data: {
        summary: {
          danglingAssociations: danglingResult.rows.length,
          missingProgramAssociations: missingProgramAssocResult.rows.length,
          projectsWithoutProgram: projectsWithoutProgramResult.rows.length,
          sprintsWithoutProject: sprintsWithoutProjectResult.rows.length,
          issuesWithoutProject: issuesWithoutProjectResult.rows.length,
        },
        danglingAssociations: danglingResult.rows,
        missingProgramAssociations: missingProgramAssocResult.rows,
        projectsWithoutProgram: projectsWithoutProgramResult.rows,
        sprintsWithoutProject: sprintsWithoutProjectResult.rows,
        issuesWithoutProject: issuesWithoutProjectResult.rows.slice(0, 50), // Limit for readability
      },
    });
  } catch (error) {
    console.error('Debug orphans error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to diagnose orphans',
      },
    });
  }
});

// POST /api/admin/debug/orphans/fix - Fix orphaned entities by backfilling associations
router.post('/debug/orphans/fix', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);

  try {
    const client = await pool.connect();

    try {
      await client.query<EmptyRow>('BEGIN');

      // 1. Delete dangling associations
      const deleteDanglingResult = await client.query<DeleteDanglingRow>(`
        DELETE FROM document_associations
        WHERE id IN (
          SELECT da.id
          FROM document_associations da
          LEFT JOIN documents d ON da.related_id = d.id
          WHERE d.id IS NULL
        )
        RETURNING id
      `);

      // Note: program_id column was dropped by migration 029.
      // Backfill from column is no longer possible, but we keep the response structure.
      const backfillProgramResult = { rowCount: 0 };

      await client.query<EmptyRow>('COMMIT');

      // Log the fix action
      await logAuditEvent({
        actorUserId,
        action: 'admin.fix_orphans',
        details: {
          danglingDeleted: deleteDanglingResult.rowCount,
          programAssociationsBackfilled: backfillProgramResult.rowCount,
        },
        req,
      });

      res.json({
        success: true,
        data: {
          fixed: {
            danglingAssociationsDeleted: deleteDanglingResult.rowCount,
            programAssociationsBackfilled: backfillProgramResult.rowCount,
          },
        },
      });
    } catch (err) {
      await client.query<EmptyRow>('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Fix orphans error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to fix orphans',
      },
    });
  }
});

// DELETE /api/admin/debug/users/:id - Delete a specific user (for cleanup)
router.delete('/debug/users/:id', async (req: Request, res: Response): Promise<void> => {
  const { userId: actorUserId } = getAuthenticatedUserContext(req);
  const id = req.params.id as string;

  try {
    // Get user info for audit log
    const userResult = await pool.query<UserBasicRow>(
      'SELECT id, email, name FROM users WHERE id = $1',
      [id]
    );

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

    // Prevent deleting yourself
    if (id === actorUserId) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Cannot delete your own account',
        },
      });
      return;
    }

    // Delete in order: sessions, workspace_memberships, user
    await pool.query<EmptyRow>('DELETE FROM sessions WHERE user_id = $1', [id]);
    await pool.query<EmptyRow>('DELETE FROM workspace_memberships WHERE user_id = $1', [id]);
    await pool.query<EmptyRow>('DELETE FROM users WHERE id = $1', [id]);

    await logAuditEvent({
      actorUserId,
      action: 'user.delete',
      resourceType: 'user',
      resourceId: id,
      details: { email: targetUser.email, name: targetUser.name },
      req,
    });

    res.json({
      success: true,
      data: { deletedUser: targetUser },
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to delete user',
      },
    });
  }
});

export default router;
