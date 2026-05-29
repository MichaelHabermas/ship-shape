import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../../services/audit.js';
import { getAuthenticatedUserContext } from '../../utils/auth-context.js';
import {
  type UserBasicRow,
  mapUserBasic,
} from './types.js';

const router = Router();

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

export default router;
