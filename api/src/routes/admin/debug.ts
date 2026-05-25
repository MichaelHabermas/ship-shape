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
      const userId = m.user_id;
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
      const emailLower = u.email_lower;
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
      isDuplicate: (emailCounts[row.email_lower] ?? 0) > 1,
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

    const client = await pool.connect();

    try {
      await client.query<EmptyRow>('BEGIN');

      // Delete in order: sessions, workspace_memberships, user
      await client.query<EmptyRow>('DELETE FROM sessions WHERE user_id = $1', [id]);
      await client.query<EmptyRow>('DELETE FROM workspace_memberships WHERE user_id = $1', [id]);
      await client.query<EmptyRow>('DELETE FROM users WHERE id = $1', [id]);

      await client.query<EmptyRow>('COMMIT');

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
    } catch (err) {
      await client.query<EmptyRow>('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
