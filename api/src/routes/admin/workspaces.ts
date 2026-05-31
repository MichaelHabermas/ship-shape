import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../../services/audit.js';
import { getAuthenticatedUserContext } from '../../utils/auth-context.js';
import {
  type EmptyRow,
  type WorkspaceRow,
  type WorkspaceListRow,
  type IdRow,
  requireFirstRow,
  mapWorkspace,
  mapWorkspaceListItem,
} from './types.js';

const router = Router();

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
  const { name, sprintStartDate } = req.body as { name?: string; sprintStartDate?: string };

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

export default router;
