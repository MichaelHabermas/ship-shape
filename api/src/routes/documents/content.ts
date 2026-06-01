import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { loadContentFromYjsState } from '../../utils/yjsConverter.js';
import { getActor } from '../../services/document-access.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import { updateDocumentContentMutation } from '../../services/document-mutations/index.js';
import { principalFromRequest } from '../../security/principal.js';
import {
  updateContentSchema,
  canReadDocumentWithAccountability,
  type DocumentContentAccessRow,
  type DocumentProperties,
} from './shared.js';

const router = Router();

router.get('/:id/content', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);
    const actor = getActor(req);

    // Verify document exists and user can access it
    const result = await pool.query<DocumentContentAccessRow & { document_type: string; properties: DocumentProperties | null }>(
      `SELECT d.id, d.document_type, d.properties, d.content, d.yjs_state, d.title,
              (d.visibility = 'workspace' OR d.created_by = $2 OR
               (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
       FROM documents d
       WHERE d.id = $1 AND d.workspace_id = $3 AND d.archived_at IS NULL AND d.deleted_at IS NULL`,
      [id, userId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const doc = result.rows[0];
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!doc.can_access) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!(await canReadDocumentWithAccountability(doc, actor))) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    let content = doc.content;

    // If content is null but yjs_state exists, convert Yjs to TipTap JSON
    if (!content && doc.yjs_state) {
      content = loadContentFromYjsState(doc.yjs_state);

      if (!content) {
        res.status(500).json({ error: 'Failed to convert document content' });
        return;
      }
    }

    // Return content with document metadata
    res.json({
      id: doc.id,
      title: doc.title,
      content: content || { type: 'doc', content: [] },
    });
  } catch (err) {
    sendInternalError(res, err, 'Get document content error:');
  }
});

// Update document content with TipTap JSON
// This endpoint updates content and clears yjs_state (forcing regeneration)
// Useful for API-based document editing without using the collaborative editor
router.patch('/:id/content', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const parsed = updateContentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const actor = getActor(req);
    const result = await updateDocumentContentMutation({
      actor,
      principal: principalFromRequest(req),
      documentId: id,
      content: parsed.data.content,
      source: 'rest',
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    sendInternalError(res, err, 'Update document content error:');
  }
});

// Create document

export default router;
