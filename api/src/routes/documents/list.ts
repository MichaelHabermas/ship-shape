import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { isWorkspaceAdmin } from '../../middleware/visibility.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError } from '../../utils/route-http.js';
import { readIssueListFields } from '../../utils/document-properties.js';
import type { DocumentListRow, ConvertedDocumentRow } from './shared.js';

const router = Router();

router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type, parent_id } = req.query;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    // Check if user is admin (admins can see all documents)
    const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

    let query = `
      SELECT id, workspace_id, document_type, title, parent_id, position,
             ticket_number, properties,
             created_at, updated_at, created_by, visibility
      FROM documents
      WHERE workspace_id = $1
        AND archived_at IS NULL
        AND deleted_at IS NULL
        AND (visibility = 'workspace' OR created_by = $2 OR $3 = TRUE)
    `;
    const params: (string | boolean | null)[] = [workspaceId, userId, isAdmin];

    if (type) {
      query += ` AND document_type = $${params.length + 1}`;
      params.push(type as string);
    }

    if (parent_id !== undefined) {
      if (parent_id === 'null' || parent_id === '') {
        query += ` AND parent_id IS NULL`;
      } else {
        query += ` AND parent_id = $${params.length + 1}`;
        params.push(parent_id as string);
      }
    }

    query += ` ORDER BY position ASC, created_at DESC`;

    const result = await pool.query<DocumentListRow>(query, params);

    const documents = result.rows.map((row) => ({
      ...row,
      ...readIssueListFields(row.properties),
    }));

    res.json(documents);
  } catch (err) {
    sendInternalError(res, err, 'List documents error:');
  }
});

// List documents converted in-place (same row, updated document_type)
router.get('/converted/list', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);
    const { original_type, converted_type } = req.query;

    // Only show documents the user can access (workspace-visible or owned by user)
    let query = `
      SELECT d.id, d.title,
             d.original_type,
             d.document_type as converted_type,
             d.ticket_number as converted_ticket_number,
             snapshot.ticket_number as original_ticket_number,
             d.converted_at, d.converted_by,
             converter.name as converted_by_name
      FROM documents d
      LEFT JOIN LATERAL (
        SELECT ticket_number
        FROM document_snapshots
        WHERE document_id = d.id AND snapshot_reason = 'conversion'
        ORDER BY created_at DESC
        LIMIT 1
      ) snapshot ON true
      LEFT JOIN users converter ON d.converted_by = converter.id
      WHERE d.workspace_id = $1
        AND (COALESCE(d.conversion_count, 0) > 0 OR d.converted_at IS NOT NULL)
        AND d.original_type IS NOT NULL
        AND d.original_type != d.document_type
        AND (d.visibility = 'workspace' OR d.created_by = $2)
    `;
    const params: (string | null)[] = [workspaceId, userId];

    // Filter by original document type (before conversion)
    if (original_type && typeof original_type === 'string') {
      params.push(original_type);
      query += ` AND d.original_type = $${params.length}`;
    }

    // Filter by current document type (after conversion)
    if (converted_type && typeof converted_type === 'string') {
      params.push(converted_type);
      query += ` AND d.document_type = $${params.length}`;
    }

    query += ` ORDER BY d.converted_at DESC NULLS LAST, d.updated_at DESC`;

    const result = await pool.query<ConvertedDocumentRow>(query, params);

    const conversions = result.rows.map(row => ({
      original_id: row.id,
      original_title: row.title,
      original_type: row.original_type,
      original_ticket_number: row.original_ticket_number,
      converted_id: row.id,
      converted_title: row.title,
      converted_type: row.converted_type,
      converted_ticket_number: row.converted_ticket_number,
      converted_at: row.converted_at,
      converted_by: row.converted_by,
      converted_by_name: row.converted_by_name,
    }));

    res.json(conversions);
  } catch (err) {
    sendInternalError(res, err, 'List converted documents error:');
  }
});

export default router;
