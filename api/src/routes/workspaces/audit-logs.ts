import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware, workspaceAdminMiddleware } from '../../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import {
  type AuditLogRow,
  mapAuditLog,
  getQueryString,
} from './shared.js';

const router = Router();
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
