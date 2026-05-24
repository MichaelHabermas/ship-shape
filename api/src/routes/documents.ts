import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { isWorkspaceAdmin } from '../middleware/visibility.js';
import { loadContentFromYjsState } from '../utils/yjsConverter.js';
import { belongsToSchema, documentTypeSchema, documentVisibilitySchema, issueSourceSchema } from '../schemas/document-boundary.js';
import {
  canReadAccountabilityDocument,
  getActor,
  getDocumentAccessContext,
  visibilityPredicate,
  type AccessibleDocument,
} from '../services/document-access.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import {
  createDocumentMutation,
  convertDocumentMutation,
  deleteDocumentMutation,
  updateDocumentContentMutation,
  updateDocumentMutation,
} from '../services/document-mutations.js';

const router = Router();

type DocumentProperties = Record<string, unknown> & {
  is_complete?: boolean;
  missing_fields?: string[];
};

type DocumentAccessRow = {
  id: string;
  workspace_id: string;
  document_type: string;
  title: string;
  parent_id: string | null;
  position: number | null;
  ticket_number: number | null;
  properties: DocumentProperties | null;
  content?: unknown;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: 'private' | 'workspace';
  archived_at?: Date | null;
  deleted_at?: Date | null;
  converted_to_id?: string | null;
  converted_by?: string | null;
  can_access: boolean;
};

type DocumentListRow = {
  id: string;
  workspace_id: string;
  document_type: string;
  title: string;
  parent_id: string | null;
  position: number | null;
  ticket_number: number | null;
  properties: DocumentProperties | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: 'private' | 'workspace';
};

type ConvertedDocumentRow = {
  id: string;
  title: string;
  original_type: string;
  converted_type: string;
  converted_ticket_number: number | null;
  original_ticket_number: number | null;
  converted_at: Date | null;
  converted_by: string | null;
  converted_by_name: string | null;
};

type DocumentTypeRow = {
  id: string;
  document_type: string;
};

type PersonOwnerRow = {
  id: string;
  name: string;
  email: string;
};

type PersonTitleRow = {
  title: string;
};

type BelongsToAssocRow = {
  id: string;
  type: string;
  title: string | null;
  color: string | null;
};

type DocumentContentAccessRow = {
  id: string;
  content: unknown;
  yjs_state: Buffer | null;
  title: string;
  can_access: boolean;
};

function extractBelongsToAssocFromRow(row: BelongsToAssocRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title || undefined,
    color: row.color || undefined,
  };
}

// Check if user can access a document (visibility check)
async function canAccessDocument(
  docId: string,
  userId: string,
  workspaceId: string
): Promise<{ canAccess: boolean; doc: DocumentAccessRow | null }> {
  const result = await pool.query<DocumentAccessRow>(
    `SELECT d.*,
            (d.visibility = 'workspace' OR d.created_by = $2 OR
             (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
     FROM documents d
     WHERE d.id = $1 AND d.workspace_id = $3 AND d.deleted_at IS NULL`,
    [docId, userId, workspaceId]
  );

  if (result.rows.length === 0) {
    return { canAccess: false, doc: null };
  }

  const doc = result.rows[0];
  if (!doc) {
    return { canAccess: false, doc: null };
  }
  return { canAccess: doc.can_access, doc };
}

async function canReadDocumentWithAccountability(
  doc: Pick<DocumentAccessRow, 'document_type' | 'properties'>,
  actor: ReturnType<typeof getActor>
): Promise<boolean> {
  return canReadAccountabilityDocument(pool, actor, {
    document_type: doc.document_type as AccessibleDocument['document_type'],
    properties: doc.properties ?? {},
  });
}

// Validation schemas
const createDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional().default('Untitled'),
  document_type: documentTypeSchema.optional().default('wiki'),
  parent_id: z.string().uuid().optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
  properties: z.record(z.unknown()).optional(),
  visibility: documentVisibilitySchema.optional(),
  content: z.unknown().optional(),
  belongs_to: z.array(belongsToSchema).optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.unknown().optional(),
  parent_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(0).optional(),
  properties: z.record(z.unknown()).optional(),
  visibility: documentVisibilitySchema.optional(),
  document_type: documentTypeSchema.optional(),
  // Issue-specific fields (stored in properties but accepted at top level for convenience)
  state: z.string().optional(),
  priority: z.string().optional(),
  estimate: z.number().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  source: issueSourceSchema.optional(),
  rejection_reason: z.string().nullable().optional(),
  belongs_to: z.array(belongsToSchema).optional(),
  confirm_orphan_children: z.boolean().optional(),
  // Project-specific fields (stored in properties but accepted at top level)
  impact: z.number().min(1).max(10).nullable().optional(),
  confidence: z.number().min(1).max(10).nullable().optional(),
  ease: z.number().min(1).max(10).nullable().optional(),
  color: z.string().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  has_design_review: z.boolean().nullable().optional(),
  design_review_notes: z.string().max(2000).nullable().optional(),
  // RACI fields for projects and programs (stored in properties)
  accountable_id: z.string().uuid().nullable().optional(), // A - Accountable (approver)
  consulted_ids: z.array(z.string().uuid()).optional(), // C - Consulted (provide input)
  informed_ids: z.array(z.string().uuid()).optional(), // I - Informed (kept in loop)
  // Common association fields (shared across document types)
  program_id: z.string().uuid().nullable().optional(),
  sprint_id: z.string().uuid().nullable().optional(),
  // Sprint-specific fields (stored in properties but accepted at top level)
  // Note: start_date/end_date are computed from sprint_number + workspace.sprint_start_date
  status: z.enum(['planning', 'active', 'completed']).optional(),
  hypothesis: z.string().optional(),
  plan: z.string().optional(), // Alias for hypothesis (frontend sends 'plan', stored as 'plan' in properties)
});

// List documents
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

    // Extract properties into flat fields for backwards compatibility
    const documents = result.rows.map(row => {
      const props = row.properties || {};
      return {
        ...row,
        // Flatten common properties for backwards compatibility
        state: props.state,
        priority: props.priority,
        estimate: props.estimate,
        assignee_id: props.assignee_id,
        source: props.source,
        prefix: props.prefix,
        color: props.color,
      };
    });

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

// Get single document
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);
    const actor = getActor(req);
    const { isAdmin } = await getDocumentAccessContext(actor);

    const { canAccess, doc } = await canAccessDocument(id, userId, workspaceId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      // Return 404 for private docs user can't access (to not reveal existence)
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!(await canReadDocumentWithAccountability(doc, actor))) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // LEGACY: Handle old-style conversions that created new documents
    // New conversions (2024+) use in-place updates with snapshots, so converted_to_id won't be set.
    // This redirect only applies to documents converted before the in-place model was implemented.
    if (doc.converted_to_id && doc.converted_to_id !== doc.id) {
      // Fetch the new document to determine its type for proper routing
      const newDocResult = await pool.query<DocumentTypeRow>(
        'SELECT id, document_type FROM documents WHERE id = $1 AND workspace_id = $2',
        [doc.converted_to_id, workspaceId]
      );

      if (newDocResult.rows.length > 0) {
        const newDoc = newDocResult.rows[0];
        if (!newDoc) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        // Return 301 with Location header to the new document's API endpoint
        res.set('X-Converted-Type', newDoc.document_type);
        res.set('X-Converted-To', newDoc.id);
        res.redirect(301, `/api/documents/${newDoc.id}`);
        return;
      }
    }

    const props = doc.properties || {};

    // Get owner details for projects (owner_id is a user_id, lookup person document by user_id)
    // Return user_id as id so PersonCombobox can match correctly
    let owner: { id: string; name: string; email: string } | null = null;
    if (doc.document_type === 'project' && props.owner_id) {
      const ownerResult = await pool.query<PersonOwnerRow>(
        `SELECT (d.properties->>'user_id')::text as id, d.title as name, COALESCE(d.properties->>'email', u.email) as email
         FROM documents d
         LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
         WHERE (d.properties->>'user_id')::uuid = $1 AND d.workspace_id = $2 AND d.document_type = 'person'`,
        [props.owner_id, workspaceId]
      );
      if (ownerResult.rows.length > 0) {
        owner = ownerResult.rows[0] ?? null;
      }
    }

    // Get owner details for sprints (owner stored in assignee_ids[0], consistent with sprints API)
    // Return user_id as id so Combobox can match correctly
    if (doc.document_type === 'sprint' && Array.isArray(props.assignee_ids) && props.assignee_ids[0]) {
      const ownerResult = await pool.query<PersonOwnerRow>(
        `SELECT u.id::text as id, d.title as name, COALESCE(d.properties->>'email', u.email) as email
         FROM users u
         LEFT JOIN documents d ON (d.properties->>'user_id')::uuid = u.id AND d.document_type = 'person' AND d.workspace_id = $2
         WHERE u.id = $1`,
        [props.assignee_ids[0], workspaceId]
      );
      if (ownerResult.rows.length > 0) {
        owner = ownerResult.rows[0] ?? null;
      }
    }

    // Compute title for weekly_plan/weekly_retro documents (includes person name for entity reference)
    let computedTitle = doc.title;
    if ((doc.document_type === 'weekly_plan' || doc.document_type === 'weekly_retro') && props.person_id) {
      const personResult = await pool.query<PersonTitleRow>(
        `SELECT title FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
        [props.person_id, workspaceId]
      );
      if (personResult.rows.length > 0) {
        const personName = personResult.rows[0]?.title;
        if (personName) {
          computedTitle = `${doc.title} - ${personName}`;
        }
      }
    }

    // Get belongs_to associations from junction table (for issues, wikis, sprints, and projects)
    let belongs_to: Array<{ id: string; type: string; title?: string; color?: string }> = [];
    if (doc.document_type === 'issue' || doc.document_type === 'wiki' || doc.document_type === 'sprint' || doc.document_type === 'project') {
      const assocResult = await pool.query<BelongsToAssocRow>(
        `SELECT da.related_id as id, da.relationship_type as type,
                d.title, (d.properties->>'color') as color
         FROM document_associations da
         JOIN documents d ON d.id = da.related_id
         WHERE da.document_id = $1
           AND d.workspace_id = $2
           AND d.archived_at IS NULL
           AND d.deleted_at IS NULL
           AND ${visibilityPredicate('d', '$3', '$4')}`,
        [id, workspaceId, userId, isAdmin]
      );
      belongs_to = assocResult.rows.map(extractBelongsToAssocFromRow);
    }

    // Return with flattened properties for backwards compatibility
    res.json({
      ...doc,
      // Use computed title for weekly_plan/weekly_retro (includes person name)
      title: computedTitle,
      // Issue properties
      state: props.state,
      priority: props.priority,
      estimate: props.estimate,
      assignee_id: props.assignee_id,
      source: props.source,
      // Project properties
      impact: props.impact,
      confidence: props.confidence,
      ease: props.ease,
      // For sprints, owner is stored in assignee_ids[0] (consistent with sprints API)
      owner_id: doc.document_type === 'sprint' && Array.isArray(props.assignee_ids)
        ? props.assignee_ids[0] || null
        : props.owner_id,
      owner,
      // RACI properties (for projects and programs)
      accountable_id: props.accountable_id || null,
      consulted_ids: props.consulted_ids || [],
      informed_ids: props.informed_ids || [],
      // Design review (for projects)
      has_design_review: props.has_design_review ?? null,
      design_review_notes: props.design_review_notes || null,
      // Generic properties
      prefix: props.prefix,
      color: props.color,
      // Sprint properties (dates computed from sprint_number + workspace.sprint_start_date)
      status: props.status,
      plan: props.plan,
      plan_approval: props.plan_approval,
      review_approval: props.review_approval,
      review_rating: props.review_rating,
      // Include belongs_to for issue, wiki, sprint, and project documents
      ...((doc.document_type === 'issue' || doc.document_type === 'wiki' || doc.document_type === 'sprint' || doc.document_type === 'project') && { belongs_to }),
    });
  } catch (err) {
    sendInternalError(res, err, 'Get document error:');
  }
});

// Get document content as TipTap JSON
// This endpoint converts Yjs state to TipTap JSON if content is null
// Useful for API-based document editing without using the collaborative editor
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
    const actor = getActor(req);
    const result = await updateDocumentContentMutation({
      actor,
      documentId: id,
      content: req.body.content,
      source: 'rest',
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    sendInternalError(res, err, 'Update document content error:');
  }
});

// Create document
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const actor = getActor(req);
    const mutation = await createDocumentMutation({
      actor,
      input: parsed.data,
      source: 'rest',
    });
    res.status(mutation.status).json(mutation.body);
  } catch (err) {
    sendInternalError(res, err, 'Create document error:');
  }
});

// Update document
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const actor = getActor(req);

    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const mutation = await updateDocumentMutation({
      actor,
      documentId: id,
      patch: parsed.data,
      source: 'rest',
    });
    res.status(mutation.status).json(mutation.body);
  } catch (err) {
    sendInternalError(res, err, 'Update document error:');
  }
});

// Delete document
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const actor = getActor(req);
    const mutation = await deleteDocumentMutation({
      actor,
      documentId: id,
      source: 'rest',
    });
    if (mutation.status === 204) {
      res.status(204).send();
      return;
    }
    res.status(mutation.status).json(mutation.body);
  } catch (err) {
    sendInternalError(res, err, 'Delete document error:');
  }
});

// Convert document type (issue <-> project)
// Uses in-place conversion with snapshots: same ID, state preserved for undo
const convertDocumentSchema = z.object({
  target_type: z.enum(['issue', 'project']),
});

router.post('/:id/convert', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const parsed = convertDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { target_type } = parsed.data;
    const actor = getActor(req);
    const mutation = await convertDocumentMutation({
      actor,
      documentId: id,
      targetType: target_type,
      source: 'rest',
    });
    res.status(mutation.status).json(mutation.body);

  } catch (err) {
    sendInternalError(res, err, 'Convert document error:');
  }
});

// POST /documents/:id/undo-conversion - Undo a document conversion using snapshots
router.post('/:id/undo-conversion', authMiddleware, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const userId = String(req.userId);
  const workspaceId = String(req.workspaceId);

  // First check access using canAccessDocument (outside transaction for read)
  const { canAccess, doc: currentDoc } = await canAccessDocument(id, userId, workspaceId);

  if (!currentDoc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  if (!canAccess) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  // Only the creator or the person who converted it can undo
  const isCreator = currentDoc.created_by === userId;
  const isConverter = currentDoc.converted_by === userId;
  if (!isCreator && !isConverter) {
    res.status(403).json({ error: 'Only the document creator or converter can undo conversion' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the most recent snapshot for this document
    const snapshotResult = await client.query(
      `SELECT * FROM document_snapshots
       WHERE document_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [id]
    );

    if (snapshotResult.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'No conversion history found for this document' });
      return;
    }

    const snapshot = snapshotResult.rows[0];
    const currentProps = currentDoc.properties || {};
    const restoredType = snapshot.document_type;

    // 1. Create snapshot of current state (so user can re-convert if needed)
    await client.query(
      `INSERT INTO document_snapshots (
        document_id, document_type, title, properties, ticket_number,
        snapshot_reason, created_by
      )
      VALUES ($1, $2, $3, $4, $5, 'undo', $6)`,
      [
        id,
        currentDoc.document_type,
        currentDoc.title,
        JSON.stringify(currentProps),
        currentDoc.ticket_number,
        userId,
      ]
    );

    // 2. Restore document from snapshot
    const snapshotProps = snapshot.properties || {};

    // Handle ticket number restoration
    let restoredTicketNumber = snapshot.ticket_number;

    // If restoring to an issue and we don't have a ticket number, generate one
    if (restoredType === 'issue' && !restoredTicketNumber) {
      const workspaceIdHex = workspaceId.replace(/-/g, '').substring(0, 15);
      const lockKey = parseInt(workspaceIdHex, 16);
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      const ticketResult = await client.query(
        `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
         FROM documents
         WHERE workspace_id = $1 AND document_type = 'issue'`,
        [workspaceId]
      );
      restoredTicketNumber = ticketResult.rows[0].next_number;
    }

    // If restoring to a project, clear ticket number
    if (restoredType === 'project') {
      restoredTicketNumber = null;
    }

    const updateResult = await client.query(
      `UPDATE documents
       SET document_type = $1,
           properties = $2,
           ticket_number = $3,
           converted_at = NOW(),
           converted_by = $4,
           updated_at = NOW()
       WHERE id = $5 AND workspace_id = $6
       RETURNING *`,
      [
        restoredType,
        JSON.stringify(snapshotProps),
        restoredTicketNumber,
        userId,
        id,
        workspaceId,
      ]
    );

    const restoredDoc = updateResult.rows[0];

    // 3. Delete the snapshot we just restored from (keep the undo snapshot)
    await client.query(
      `DELETE FROM document_snapshots WHERE id = $1`,
      [snapshot.id]
    );

    // 4. Update associations based on restored type
    if (restoredType === 'project') {
      // Remove non-program associations (project can only have program)
      await client.query(
        `DELETE FROM document_associations
         WHERE document_id = $1 AND relationship_type != 'program'`,
        [id]
      );
    }
    // If restoring to issue, keep all associations

    await client.query('COMMIT');

    // Return the restored document (same ID!)
    const props = restoredDoc.properties || {};
    res.status(200).json({
      ...restoredDoc,
      // Flatten properties for frontend
      ...(restoredType === 'issue' && {
        state: props.state,
        priority: props.priority,
        assignee_id: props.assignee_id,
        source: props.source,
      }),
      ...(restoredType === 'project' && {
        impact: props.impact,
        confidence: props.confidence,
        ease: props.ease,
        color: props.color,
        owner_id: props.owner_id,
      }),
      program_id: props.program_id,
      restored_from_type: currentDoc.document_type,
      message: `Conversion undone. Document restored to ${restoredType}.`,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    sendInternalError(res, err, 'Undo conversion error:');
  } finally {
    client.release();
  }
});

export default router;

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        workspaceId: string;
      };
    }
  }
}
