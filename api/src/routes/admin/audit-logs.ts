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
  type WorkspaceNameRow,
  type UserWorkspaceJson,
  type UserListRow,
  type UserBasicRow,
  type UserSuperAdminRow,
  type AuditLogRow,
  type AuditLogExportRow,
  type WorkspaceMemberRow,
  type WorkspaceInviteRow,
  type WorkspaceInviteCreateRow,
  type InviteRevokeRow,
  type MemberRoleRow,
  type CountRow,
  type MembershipRow,
  type DebugUserRow,
  type DebugMembershipRow,
  type DanglingAssociationRow,
  type OrphanDocumentRow,
  type DeleteDanglingRow,
  toNumber,
  requireFirstRow,
  mapWorkspace,
  mapWorkspaceListItem,
  mapUserListItem,
  mapUserBasic,
  mapAuditLog,
  mapWorkspaceMember,
  mapWorkspaceInvite,
  mapWorkspaceInviteCreated,
} from './types.js';

const router = Router();

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

export default router;
