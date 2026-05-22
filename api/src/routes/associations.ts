import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import {
  expectedTypeForRelationship,
  getActor,
  getDocumentAccessContext,
  getReadableDocument,
  requireAssociationAccess,
  visibilityPredicate,
} from '../services/document-access.js';
import { sendInternalError, sendLegacyError, sendValidationError } from '../utils/route-http.js';

const router = Router();

// Validation schemas
const createAssociationSchema = z.object({
  related_id: z.string().uuid(),
  relationship_type: z.enum(['parent', 'project', 'sprint', 'program']),
  metadata: z.record(z.unknown()).optional(),
});

// Valid relationship types
const validTypes = ['parent', 'project', 'sprint', 'program'] as const;
type RelationshipType = typeof validTypes[number];

function isValidRelationshipType(value: unknown): value is RelationshipType {
  return typeof value === 'string' && validTypes.includes(value as RelationshipType);
}

// GET /api/documents/:id/associations - List all associations for a document
router.get('/:id/associations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    // Normalize query param (could be string or string[])
    const typeParam = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    // Check access
    if (!(await getReadableDocument(pool, actor, id))) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let query = `
      SELECT
        da.id,
        da.document_id,
        da.related_id,
        da.relationship_type,
        da.created_at,
        da.metadata,
        d.title as related_title,
        d.document_type as related_document_type
      FROM document_associations da
      JOIN documents d ON d.id = da.related_id
      WHERE da.document_id = $1
        AND d.workspace_id = $2
        AND d.archived_at IS NULL
        AND d.deleted_at IS NULL
        AND ${visibilityPredicate('d', '$3', '$4')}
    `;
    const params: Array<string | boolean> = [id, actor.workspaceId, actor.userId, isAdmin];

    // Filter by relationship type if provided
    if (typeParam) {
      if (!isValidRelationshipType(typeParam)) {
        return sendLegacyError(res, 400, 'Invalid relationship type');
      }
      query += ` AND da.relationship_type = $5`;
      params.push(typeParam);
    }

    query += ` ORDER BY da.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json(result.rows);
  } catch (error) {
    sendInternalError(res, error, 'Error fetching associations:', { error: 'Failed to fetch associations' });
    return;
  }
});

// POST /api/documents/:id/associations - Create a new association
router.post('/:id/associations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const actor = getActor(req);

    // Validate input
    const parseResult = createAssociationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendValidationError(res, parseResult.error);
    }

    const { related_id, relationship_type, metadata } = parseResult.data;

    // Prevent self-reference
    if (id === related_id) {
      return sendLegacyError(res, 400, 'Cannot create self-referencing association');
    }

    try {
      await requireAssociationAccess(pool, actor, id, related_id, relationship_type);
    } catch {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Create association (ON CONFLICT handles duplicate check)
    const result = await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (document_id, related_id, relationship_type) DO UPDATE SET
         metadata = COALESCE($4, document_associations.metadata),
         created_at = document_associations.created_at
       RETURNING *`,
      [id, related_id, relationship_type, metadata || {}]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    sendInternalError(res, error, 'Error creating association:', { error: 'Failed to create association' });
    return;
  }
});

// DELETE /api/documents/:id/associations/:relatedId - Delete a specific association
router.delete('/:id/associations/:relatedId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const relatedId = String(req.params.relatedId);
    // Normalize query param (could be string or string[])
    const typeParam = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
    const actor = getActor(req);

    const source = await getReadableDocument(pool, actor, id);
    const related = await getReadableDocument(
      pool,
      actor,
      relatedId,
      typeParam && isValidRelationshipType(typeParam) ? expectedTypeForRelationship(typeParam) : undefined
    );
    if (!source || !related) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Build delete query
    let query = `DELETE FROM document_associations WHERE document_id = $1 AND related_id = $2`;
    const params: string[] = [id, relatedId];

    // If type is specified, only delete that specific association type
    if (typeParam) {
      if (!isValidRelationshipType(typeParam)) {
        return sendLegacyError(res, 400, 'Invalid relationship type');
      }
      query += ` AND relationship_type = $3`;
      params.push(typeParam);
    }

    query += ` RETURNING *`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Association not found' });
    }

    return res.json({ deleted: result.rows.length, associations: result.rows });
  } catch (error) {
    sendInternalError(res, error, 'Error deleting association:', { error: 'Failed to delete association' });
    return;
  }
});

// GET /api/documents/:id/reverse-associations - Find documents that associate with this one
router.get('/:id/reverse-associations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    // Normalize query param (could be string or string[])
    const typeParam = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    // Check access
    if (!(await getReadableDocument(pool, actor, id))) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let query = `
      SELECT
        da.id,
        da.document_id,
        da.related_id,
        da.relationship_type,
        da.created_at,
        da.metadata,
        d.title as document_title,
        d.document_type as document_document_type
      FROM document_associations da
      JOIN documents d ON d.id = da.document_id
      WHERE da.related_id = $1
        AND d.workspace_id = $2
        AND d.archived_at IS NULL
        AND d.deleted_at IS NULL
        AND ${visibilityPredicate('d', '$3', '$4')}
    `;
    const params: Array<string | boolean> = [id, actor.workspaceId, actor.userId, isAdmin];

    if (typeParam) {
      if (!isValidRelationshipType(typeParam)) {
        return sendLegacyError(res, 400, 'Invalid relationship type');
      }
      query += ` AND da.relationship_type = $5`;
      params.push(typeParam);
    }

    query += ` ORDER BY da.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json(result.rows);
  } catch (error) {
    sendInternalError(res, error, 'Error fetching reverse associations:', {
      error: 'Failed to fetch reverse associations',
    });
    return;
  }
});

// GET /api/documents/:id/context - Get full context tree (ancestors + children + siblings)
router.get('/:id/context', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    // Check access
    if (!(await getReadableDocument(pool, actor, id))) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Get the current document
    // Programs are stored as documents with document_type = 'program', not a separate table
    const currentDoc = await pool.query(
      `SELECT d.id, d.title, d.document_type, d.ticket_number,
              prog_da.related_id as program_id,
              prog.title as program_name,
              prog.properties->>'color' as program_color
       FROM documents d
       LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents prog
         ON prog_da.related_id = prog.id
        AND prog.document_type = 'program'
        AND prog.workspace_id = $2
        AND prog.archived_at IS NULL
        AND prog.deleted_at IS NULL
        AND ${visibilityPredicate('prog', '$3', '$4')}
       WHERE d.id = $1`,
      [id, actor.workspaceId, actor.userId, isAdmin]
    );

    if (currentDoc.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Recursive CTE to get all ancestors (parent chain)
    const ancestorsQuery = await pool.query(
      `WITH RECURSIVE ancestors AS (
        -- Base case: direct parent of current document
        SELECT
          d.id,
          d.title,
          d.document_type,
          d.ticket_number,
          1 as depth
        FROM documents d
        JOIN document_associations da ON da.related_id = d.id
        WHERE da.document_id = $1
          AND da.relationship_type = 'parent'
          AND d.workspace_id = $2
          AND d.archived_at IS NULL
          AND d.deleted_at IS NULL
          AND ${visibilityPredicate('d', '$3', '$4')}

        UNION ALL

        -- Recursive case: parent of each ancestor
        SELECT
          d.id,
          d.title,
          d.document_type,
          d.ticket_number,
          a.depth + 1
        FROM documents d
        JOIN document_associations da ON da.related_id = d.id
        JOIN ancestors a ON da.document_id = a.id
        WHERE da.relationship_type = 'parent'
          AND d.workspace_id = $2
          AND d.archived_at IS NULL
          AND d.deleted_at IS NULL
          AND ${visibilityPredicate('d', '$3', '$4')}
      )
      SELECT * FROM ancestors ORDER BY depth DESC`,
      [id, actor.workspaceId, actor.userId, isAdmin]
    );

    // Get children (documents that have this document as parent)
    const childrenQuery = await pool.query(
      `SELECT
        d.id,
        d.title,
        d.document_type,
        d.ticket_number,
        (SELECT COUNT(*)
         FROM document_associations da2
         JOIN documents child ON child.id = da2.document_id
         WHERE da2.related_id = d.id
           AND da2.relationship_type = 'parent'
           AND child.workspace_id = $2
           AND child.archived_at IS NULL
           AND child.deleted_at IS NULL
           AND ${visibilityPredicate('child', '$3', '$4')}) as child_count
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id
       WHERE da.related_id = $1
         AND da.relationship_type = 'parent'
         AND d.workspace_id = $2
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}
       ORDER BY d.title`,
      [id, actor.workspaceId, actor.userId, isAdmin]
    );

    // Get belongs_to associations (project, sprint, program)
    // Both programs and projects are documents, so color is in properties JSONB
    const belongsToQuery = await pool.query(
      `SELECT
        da.relationship_type as type,
        d.id,
        d.title,
        d.document_type,
        d.properties->>'color' as color
       FROM document_associations da
       JOIN documents d ON d.id = da.related_id
       WHERE da.document_id = $1
         AND da.relationship_type IN ('project', 'sprint', 'program')
         AND d.workspace_id = $2
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}
       ORDER BY
         CASE da.relationship_type
           WHEN 'program' THEN 1
           WHEN 'project' THEN 2
           WHEN 'sprint' THEN 3
         END`,
      [id, actor.workspaceId, actor.userId, isAdmin]
    );

    // Build breadcrumb path: Program > Project > Sprint > Parent Issues > Current
    const breadcrumbs: Array<{id: string; title: string; type: string; ticket_number?: number}> = [];

    // Add program from belongs_to or document's program_id
    const program = belongsToQuery.rows.find(b => b.type === 'program');
    if (program) {
      breadcrumbs.push({ id: program.id, title: program.title, type: 'program' });
    } else if (currentDoc.rows[0].program_id) {
      breadcrumbs.push({
        id: currentDoc.rows[0].program_id,
        title: currentDoc.rows[0].program_name || 'Unknown Program',
        type: 'program'
      });
    }

    // Add project from belongs_to
    const project = belongsToQuery.rows.find(b => b.type === 'project');
    if (project) {
      breadcrumbs.push({ id: project.id, title: project.title, type: 'project' });
    }

    // Add sprint from belongs_to
    const sprint = belongsToQuery.rows.find(b => b.type === 'sprint');
    if (sprint) {
      breadcrumbs.push({ id: sprint.id, title: sprint.title, type: 'sprint' });
    }

    // Add ancestors (parent issues, from root to immediate parent)
    for (const ancestor of ancestorsQuery.rows) {
      breadcrumbs.push({
        id: ancestor.id,
        title: ancestor.title || 'Untitled',
        type: ancestor.document_type,
        ticket_number: ancestor.ticket_number
      });
    }

    // Add current document
    breadcrumbs.push({
      id: currentDoc.rows[0].id,
      title: currentDoc.rows[0].title || 'Untitled',
      type: currentDoc.rows[0].document_type,
      ticket_number: currentDoc.rows[0].ticket_number
    });

    return res.json({
      current: currentDoc.rows[0],
      ancestors: ancestorsQuery.rows,
      children: childrenQuery.rows.map(c => ({
        ...c,
        child_count: parseInt(c.child_count, 10)
      })),
      belongs_to: belongsToQuery.rows,
      breadcrumbs
    });
  } catch (error) {
    sendInternalError(res, error, 'Error fetching document context:', { error: 'Failed to fetch document context' });
    return;
  }
});

export default router;
