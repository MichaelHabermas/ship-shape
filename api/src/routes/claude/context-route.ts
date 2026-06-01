/**
 * Claude Context API — route handler for GET /context
 */
import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import {
  getActor,
  getDocumentAccessContext,
  requireReadableDocument,
} from '../../services/document-access.js';
import { sendInternalError, sendLegacyError } from '../../utils/route-http.js';
import type { ClaudeContextRequest } from './types.js';
import { getRetroContext } from './retro-context.js';
import { getReviewContext } from './review-context.js';
import { getStandupContext } from './standup-context.js';

const router = Router();

/**
 * GET /api/claude/context
 *
 * Query params:
 * - context_type: 'standup' | 'review' | 'retro'
 * - sprint_id: Sprint ID (required for standup/review)
 * - project_id: Project ID (required for retro)
 *
 * Returns comprehensive context for Claude to ask intelligent questions.
 */
router.get('/context', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { context_type, sprint_id, project_id } = req.query as unknown as ClaudeContextRequest;
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    if (!actor.workspaceId) {
      res.status(401).json({ error: 'No workspace selected' });
      return;
    }

    if (!context_type) {
      sendLegacyError(res, 400, 'context_type is required');
      return;
    }

    let context: Record<string, unknown> = {};

    try {
      switch (context_type) {
        case 'standup':
          if (!sprint_id) {
            sendLegacyError(res, 400, 'sprint_id is required for standup context');
            return;
          }
          await requireReadableDocument(pool, actor, sprint_id, 'sprint');
          context = await getStandupContext(sprint_id, actor, isAdmin);
          break;

        case 'review':
          if (!sprint_id) {
            sendLegacyError(res, 400, 'sprint_id is required for review context');
            return;
          }
          await requireReadableDocument(pool, actor, sprint_id, 'sprint');
          context = await getReviewContext(sprint_id, actor, isAdmin);
          break;

        case 'retro':
          if (!project_id) {
            sendLegacyError(res, 400, 'project_id is required for retro context');
            return;
          }
          await requireReadableDocument(pool, actor, project_id, 'project');
          context = await getRetroContext(project_id, actor, isAdmin);
          break;

        default:
          sendLegacyError(res, 400, 'Invalid context_type');
          return;
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'DOCUMENT_NOT_READABLE') {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      throw error;
    }

    res.json(context);
  } catch (error) {
    sendInternalError(res, error, 'Error fetching Claude context:', { error: 'Failed to fetch context' });
  }
});

export default router;
