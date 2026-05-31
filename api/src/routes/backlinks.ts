// Document backlink listing and outbound link updates.
import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import { type IdRow } from './route-query-rows.js';

type BacklinkRow = {
  id: string;
  document_type: string;
  title: string;
  ticket_number: number | null;
  program_id: string | null;
  properties: unknown;
  program_prefix: string | null;
};

const router = Router();

// Validation schema for updating links
const updateLinksSchema = z.object({
  target_ids: z.array(z.string().uuid()),
});

// GET /api/documents/:id/backlinks - Get documents that link to this one
router.get('/:id/backlinks', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify the document exists and user can access it
    const docResult = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Get all documents that link to this document (only visible ones)
    const result = await pool.query<BacklinkRow>(
      `SELECT d.id, d.document_type, d.title, d.ticket_number, prog_da.related_id as program_id, d.properties,
              p.properties->>'prefix' as program_prefix
       FROM document_links dl
       JOIN documents d ON dl.source_id = d.id
       LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
       WHERE dl.target_id = $1 AND d.workspace_id = $2
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY dl.created_at DESC`,
      [id, workspaceId, userId, isAdmin]
    );

    // Format the response with display_id for issues
    const backlinks = result.rows.map(row => ({
      id: row.id,
      document_type: row.document_type,
      title: row.title,
      display_id: row.ticket_number && row.document_type === 'issue'
        ? `#${row.ticket_number}`
        : undefined,
    }));

    res.json(backlinks);
  } catch (err) {
    sendInternalError(res, err, 'Get backlinks error:');
  }
});

// POST /api/documents/:id/links - Update links for a document
router.post('/:id/links', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    const parsed = updateLinksSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { target_ids } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify the source document exists and user can access it
    const docResult = await pool.query<IdRow>(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Verify all target documents exist and user can access them
    if (target_ids.length > 0) {
      const targetResult = await pool.query<IdRow>(
        `SELECT id FROM documents
         WHERE id = ANY($1) AND workspace_id = $2
           AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
        [target_ids, workspaceId, userId, isAdmin]
      );

      if (targetResult.rows.length !== target_ids.length) {
        res.status(400).json({ error: 'One or more target documents not found' });
        return;
      }
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing links for this source document
      await client.query(
        'DELETE FROM document_links WHERE source_id = $1',
        [id]
      );

      // Insert new links (if any)
      if (target_ids.length > 0) {
        const values = target_ids.map((targetId, idx) =>
          `($1, $${idx + 2})`
        ).join(', ');

        await client.query(
          `INSERT INTO document_links (source_id, target_id)
           VALUES ${values}
           ON CONFLICT (source_id, target_id) DO NOTHING`,
          [id, ...target_ids]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    sendInternalError(res, err, 'Update links error:');
  }
});

export default router;
