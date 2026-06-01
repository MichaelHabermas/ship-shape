import { Router, Request, Response } from 'express';
import { pool } from '../../../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../../../middleware/visibility.js';
import { authMiddleware } from '../../../middleware/auth.js';
import { requireWeekLifecycleAuthority } from '../../../services/governance-auth.js';
import { getAuthenticatedRouteContext } from '../../../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../../../utils/route-http.js';
import { broadcastToUser } from '../../../collaboration/index.js';
import { principalFromRequest } from '../../../security/principal.js';
import { requireWeekRead, requireWeekWrite } from '../week-access.js';
import type {
  SprintRow,
  IdRow,
  UserIdRow,
  SprintExistsRow,
} from '../types.js';
import {
  visibleSprintIssueCountSql,
  updateSprintSchema,
  extractSprintFromRow,
  isSprintActive,
  takeSprintSnapshot,
} from './shared.js';

const router = Router();

router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (${visibleSprintIssueCountSql('$3', '$4')}) as issue_count,
              (${visibleSprintIssueCountSql('$3', '$4', "i.properties->>'state' = 'done'")}) as completed_count,
              (${visibleSprintIssueCountSql('$3', '$4', "i.properties->>'state' IN ('in_progress', 'in_review')")}) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'weekly_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const props = row.properties || {};
    const sprintNumber = props.sprint_number || 1;
    const workspaceStartDate = row.workspace_sprint_start_date;

    // Check if sprint is active and needs a snapshot
    // Take snapshot when: sprint is active (start_date reached) AND no snapshot exists yet
    if (workspaceStartDate && isSprintActive(sprintNumber, workspaceStartDate) && !props.planned_issue_ids) {
      // Take the snapshot
      const sprintId = id;
      const plannedIssueIds = await takeSprintSnapshot(sprintId, userId, isAdmin);
      const snapshotTakenAt = new Date().toISOString();

      // Update the sprint properties with the snapshot
      const newProps = {
        ...props,
        planned_issue_ids: plannedIssueIds,
        snapshot_taken_at: snapshotTakenAt,
      };

      await pool.query(
        `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(newProps), id]
      );

      // Update row properties for response
      row.properties = newProps;
    }

    res.json(extractSprintFromRow(row));
  } catch (err) {
    sendInternalError(res, err, 'Get sprint error:');
  }
});

router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekWrite(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = updateSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it, also get workspace start date
    const existing = await pool.query<SprintExistsRow>(
      `SELECT d.id, d.properties, prog_da.related_id as program_id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const existingRow = existing.rows[0];
    if (!existingRow) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const currentProps = existingRow.properties || {};
    const programId = existingRow.program_id;
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const data = parsed.data;

    // Handle title update (regular column)
    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }

    // Handle owner_id and sprint_number updates (in properties)
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.owner_id !== undefined) {
      // Only validate if owner_id is not null (i.e., setting a new owner, not clearing)
      if (data.owner_id) {
        // Verify owner exists in workspace
        const ownerCheck = await pool.query<UserIdRow>(
          `SELECT u.id FROM users u
           JOIN workspace_memberships wm ON wm.user_id = u.id
           WHERE u.id = $1 AND wm.workspace_id = $2`,
          [data.owner_id, workspaceId]
        );

        if (ownerCheck.rows.length === 0) {
          res.status(400).json({ error: 'Owner not found in workspace' });
          return;
        }
      }

      // Store as assignee_ids array (migration converted owner_id to assignee_ids)
      // Also store owner_id directly for accountability checks
      newProps.assignee_ids = data.owner_id ? [data.owner_id] : [];
      newProps.owner_id = data.owner_id ?? undefined;
      propsChanged = true;
    }

    // Handle sprint_number update - this changes the effective dates
    if (data.sprint_number !== undefined && data.sprint_number !== currentProps.sprint_number) {
      // Check if new sprint_number already exists for this program
      if (programId) {
        const existingCheck = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
           WHERE d.document_type = 'sprint' AND d.id != $2 AND (d.properties->>'sprint_number')::int = $3`,
          [programId, id, data.sprint_number]
        );

        if (existingCheck.rows.length > 0) {
          res.status(400).json({ error: `Week ${data.sprint_number} already exists for this program` });
          return;
        }
      } else {
        // For programless sprints, check workspace-wide uniqueness (sprints with no program association)
        const existingCheck = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           WHERE d.workspace_id = $1 AND d.document_type = 'sprint' AND d.id != $2
             AND (d.properties->>'sprint_number')::int = $3
             AND NOT EXISTS (SELECT 1 FROM document_associations da WHERE da.document_id = d.id AND da.relationship_type = 'program')`,
          [workspaceId, id, data.sprint_number]
        );

        if (existingCheck.rows.length > 0) {
          res.status(400).json({ error: `Programless week ${data.sprint_number} already exists` });
          return;
        }
      }

      newProps.sprint_number = data.sprint_number;

      // Clear the plan snapshot - it will be retaken when the new date arrives
      delete newProps.planned_issue_ids;
      delete newProps.snapshot_taken_at;

      propsChanged = true;
    }

    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'sprint'`,
      [...values, id, workspaceId]
    );

    // Re-query to get full sprint with owner info
    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (${visibleSprintIssueCountSql('$2', '$3')}) as issue_count,
              (${visibleSprintIssueCountSql('$2', '$3', "i.properties->>'state' = 'done'")}) as completed_count,
              (${visibleSprintIssueCountSql('$2', '$3', "i.properties->>'state' IN ('in_progress', 'in_review')")}) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'weekly_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
	       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id, userId, isAdmin]
    );

    const updatedRow = result.rows[0];
    if (!updatedRow) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }
    res.json(extractSprintFromRow(updatedRow));
  } catch (err) {
    sendInternalError(res, err, 'Update sprint error:');
  }
});

// Start sprint - manually activate a planning sprint with scope snapshot
// POST /api/weeks/:id/start
router.post('/:id/start', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekWrite(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const existing = await pool.query<SprintExistsRow>(
      `SELECT d.id, d.properties, prog_da.related_id as program_id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const auth = await requireWeekLifecycleAuthority(pool, principalFromRequest(req), id, 'start_week');
    if (!auth.authorized) {
      res.status(403).json({ error: auth.error });
      return;
    }

    const startExisting = existing.rows[0];
    if (!startExisting) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }

    const currentProps = startExisting.properties || {};
    const currentStatus = currentProps.status || 'planning';
    if (currentStatus !== 'planning') {
      res.status(400).json({
        error: `Cannot start week: week is already ${currentStatus}`,
      });
      return;
    }

    // Take the scope snapshot
    const sprintId = id;
    const plannedIssueIds = await takeSprintSnapshot(sprintId, userId, isAdmin);
    const snapshotTakenAt = new Date().toISOString();

    // Update sprint properties with snapshot and active status
    const newProps = {
      ...currentProps,
      status: 'active',
      planned_issue_ids: plannedIssueIds,
      snapshot_taken_at: snapshotTakenAt,
    };

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(newProps), id]
    );

    // Broadcast celebration when sprint is started
    broadcastToUser(userId, 'accountability:updated', { type: 'week_start', targetId: id });

    // Re-query to get full sprint with owner info
    const result = await pool.query<SprintRow>(
      `SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              p.properties->>'accountable_id' as program_accountable_id,
              (SELECT op.properties->>'reports_to' FROM documents op WHERE d.properties->>'owner_id' IS NOT NULL AND op.id = (d.properties->>'owner_id')::uuid AND op.document_type = 'person' AND op.workspace_id = d.workspace_id) as owner_reports_to,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (${visibleSprintIssueCountSql('$2', '$3')}) as issue_count,
              (${visibleSprintIssueCountSql('$2', '$3', "i.properties->>'state' = 'done'")}) as completed_count,
              (${visibleSprintIssueCountSql('$2', '$3', "i.properties->>'state' IN ('in_progress', 'in_review')")}) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'weekly_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt
               JOIN document_associations rda ON rda.document_id = rt.id AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
               WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       LEFT JOIN document_associations prog_da ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
	       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id, userId, isAdmin]
    );

    const sprintRow = result.rows[0];
    if (!sprintRow) {
      res.status(404).json({ error: 'Week not found' });
      return;
    }
    const sprint = extractSprintFromRow(sprintRow);

    res.json({
      ...sprint,
      snapshot_issue_count: plannedIssueIds.length,
    });
  } catch (err) {
    sendInternalError(res, err, 'Start sprint error:');
  }
});

// Delete sprint
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await requireWeekWrite(req, res, req.params.id);
    if (!id) return;
    // Remove sprint associations from issues via document_associations
    await pool.query(
      `DELETE FROM document_associations WHERE related_id = $1 AND relationship_type = 'sprint'`,
      [id]
    );

    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND document_type = 'sprint'`,
      [id]
    );

    res.status(204).send();
  } catch (err) {
    sendInternalError(res, err, 'Delete sprint error:');
  }
});

export default router;
