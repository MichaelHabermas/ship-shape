/**
 * Accountability Routes
 *
 * Inference-based action items - computes what needs attention from current state.
 * No issues are created; items are computed dynamically on each request.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkMissingAccountability } from '../services/accountability.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError } from '../utils/route-http.js';

const router = Router();

/**
 * GET /api/accountability/action-items
 *
 * Returns all action items for the current user via inference.
 * Computes items dynamically from project/sprint state - no issues created.
 *
 * Response shape matches ActionItemsModal expectations:
 * - id: synthetic ID for the item (e.g., "standup-{sprintId}")
 * - title: human-readable message
 * - accountability_type: one of 7 types
 * - accountability_target_id: the document to navigate to
 * - target_title: title of the target document
 * - due_date: when the item is due (if applicable)
 * - days_overdue: positive if past due, 0 if due today, negative if upcoming
 */
router.get('/action-items', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get all missing accountability items via inference
    const missingItems = await checkMissingAccountability(userId, workspaceId);

    // Calculate days overdue for each item
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const items = missingItems.map((item) => {
      let daysOverdue = -999; // Default for items with no due date

      if (item.dueDate) {
        const dueDate = new Date(item.dueDate + 'T00:00:00Z');
        const diffTime = today.getTime() - dueDate.getTime();
        daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      } else if (item.type === 'changes_requested_plan' || item.type === 'changes_requested_retro') {
        // Changes requested items have no due date but should show as "due today" urgency
        daysOverdue = 0;
      }

      return {
        // Synthetic ID for the item (not a real document ID)
        id: `${item.type}-${item.targetId}`,
        // Title is the human-readable message
        title: item.message,
        // These fields exist for compatibility but are not used for inference items
        state: 'todo',
        priority: 'high',
        ticket_number: 0,
        display_id: '',
        is_system_generated: true,
        // Key accountability fields
        accountability_type: item.type,
        accountability_target_id: item.targetId,
        target_title: item.targetTitle,
        due_date: item.dueDate,
        days_overdue: daysOverdue,
        // Additional metadata for weekly_plan navigation
        person_id: item.personId || null,
        project_id: item.projectId || null,
        week_number: item.weekNumber || null,
      };
    });

    // Sort by urgency: overdue first (highest days_overdue), then by due date
    items.sort((a, b) => {
      // Items with due dates come before items without
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      // Within items with due dates, sort by days_overdue (most overdue first)
      if (a.due_date && b.due_date) {
        return b.days_overdue - a.days_overdue;
      }
      // For items without due dates, maintain original order
      return 0;
    });

    const has_overdue = items.some(item => item.days_overdue > 0);
    const has_due_today = items.some(item => item.days_overdue === 0);

    res.json({
      items,
      total: items.length,
      has_overdue,
      has_due_today,
    });
  } catch (err) {
    sendInternalError(res, err, 'Get accountability action items error:');
  }
});

export default router;
