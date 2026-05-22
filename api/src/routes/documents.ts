import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import {
  addBelongsToAssociation,
  syncBelongsToAssociations,
  updateProgramAssociation,
  updateSprintAssociation,
} from '../utils/document-crud.js';
import { isWorkspaceAdmin } from '../middleware/visibility.js';
import { handleVisibilityChange, invalidateDocumentCache, broadcastToUser } from '../collaboration/index.js';
import { extractHypothesisFromContent, extractSuccessCriteriaFromContent, extractVisionFromContent, extractGoalsFromContent, checkDocumentCompleteness } from '../utils/extractHypothesis.js';
import { loadContentFromYjsState } from '../utils/yjsConverter.js';
import { belongsToSchema, documentTypeSchema, documentVisibilitySchema, issueSourceSchema } from '../schemas/document-boundary.js';
import { upsertDocumentSearchIndex } from '../utils/tiptap-search.js';
import { updateDocumentContent } from '../db/documents-repository.js';
import {
  expectedTypeForRelationship,
  getActor,
  getDocumentAccessContext,
  getReadableDocument,
  requireReferenceableDocument,
  visibilityPredicate,
} from '../services/document-access.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import { asApprovalRecord } from '../utils/approval-workflow.js';

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
  ticket_number: number | null;
  converted_to_id: string;
  converted_at: Date | null;
  converted_by: string | null;
  converted_type: string;
  converted_title: string;
  converted_ticket_number: number | null;
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

type DocumentDeleteRow = {
  id: string;
};

type DocumentContentRow = {
  id: string;
  title: string;
  content: unknown;
};

function extractBelongsToAssocFromRow(row: BelongsToAssocRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title || undefined,
    color: row.color || undefined,
  };
}

function asDocumentProperties(value: unknown): DocumentProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as DocumentProperties;
}

async function validateDocumentReferences(
  client: { query: typeof pool.query },
  actor: ReturnType<typeof getActor>,
  references: Array<{ id: string; type?: 'program' | 'project' | 'sprint' | 'parent'; label: string }>
): Promise<{ ok: boolean; error?: string }> {
  for (const reference of references) {
    try {
      await requireReferenceableDocument(
        client,
        actor,
        reference.id,
        reference.type ? expectedTypeForRelationship(reference.type) : undefined
      );
    } catch {
      return { ok: false, error: `${reference.label} not found` };
    }
  }

  return { ok: true };
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

// List converted documents (archived originals that were converted to another type)
router.get('/converted/list', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);
    const { original_type, converted_type } = req.query;

    // Only show documents the user can access (workspace-visible or owned by user)
    let query = `
      SELECT d.id, d.title, d.document_type as original_type, d.ticket_number,
             d.converted_to_id, d.converted_at, d.converted_by,
             d.created_at, d.updated_at,
             converted_doc.document_type as converted_type,
             converted_doc.title as converted_title,
             converted_doc.ticket_number as converted_ticket_number,
             converter.name as converted_by_name
      FROM documents d
      INNER JOIN documents converted_doc ON d.converted_to_id = converted_doc.id
      LEFT JOIN users converter ON d.converted_by = converter.id
      WHERE d.workspace_id = $1
        AND d.converted_to_id IS NOT NULL
        AND d.archived_at IS NOT NULL
        AND (d.visibility = 'workspace' OR d.created_by = $2)
        AND (converted_doc.visibility = 'workspace' OR converted_doc.created_by = $2)
    `;
    const params: (string | null)[] = [workspaceId, userId];

    // Filter by original document type
    if (original_type && typeof original_type === 'string') {
      params.push(original_type);
      query += ` AND d.document_type = $${params.length}`;
    }

    // Filter by converted document type
    if (converted_type && typeof converted_type === 'string') {
      params.push(converted_type);
      query += ` AND converted_doc.document_type = $${params.length}`;
    }

    query += ` ORDER BY d.converted_at DESC NULLS LAST, d.updated_at DESC`;

    const result = await pool.query<ConvertedDocumentRow>(query, params);

    const conversions = result.rows.map(row => ({
      original_id: row.id,
      original_title: row.title,
      original_type: row.original_type,
      original_ticket_number: row.ticket_number,
      converted_id: row.converted_to_id,
      converted_title: row.converted_title,
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

    // Verify document exists and user can access it
    const result = await pool.query<DocumentContentAccessRow>(
      `SELECT d.id, d.content, d.yjs_state, d.title,
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
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Validate content structure
    const { content } = req.body;
    if (!content || typeof content !== 'object') {
      res.status(400).json({ error: 'Content is required and must be a valid TipTap JSON object' });
      return;
    }

    // Validate TipTap JSON structure
    if (content.type !== 'doc' || !Array.isArray(content.content)) {
      res.status(400).json({
        error: 'Invalid content structure. Content must be a TipTap document with type "doc" and a content array.',
        expected: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '...' }] }] },
        received: { type: content.type, hasContentArray: Array.isArray(content.content) },
      });
      return;
    }

    // Verify document exists and user can access it
    const { canAccess, doc: existing } = await canAccessDocument(id, userId, workspaceId);

    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Extract hypothesis, success criteria, vision, and goals from content
    const extractedHypothesis = extractHypothesisFromContent(content);
    const extractedCriteria = extractSuccessCriteriaFromContent(content);
    const extractedVision = extractVisionFromContent(content);
    const extractedGoals = extractGoalsFromContent(content);

    // Merge with existing properties (extracted values always win)
    // Note: 'plan' is the canonical field name (renamed from 'hypothesis' in migration 032)
    const currentProps = existing.properties || {};
    const newProps = {
      ...currentProps,
      plan: extractedHypothesis,
      success_criteria: extractedCriteria,
      vision: extractedVision,
      goals: extractedGoals,
    };

    await updateDocumentContent(id, workspaceId, content, null, newProps);

    const result = await pool.query<DocumentContentRow>(
      `SELECT id, title, content FROM documents WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId]
    );

    // Invalidate collaboration cache so connected clients get fresh content
    invalidateDocumentCache(id);
    await upsertDocumentSearchIndex(id);

    const updated = result.rows[0];
    if (!updated) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({
      id: updated.id,
      title: updated.title,
      content: updated.content,
    });
  } catch (err) {
    sendInternalError(res, err, 'Update document content error:');
  }
});

// Create document
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { title, document_type, parent_id, program_id, sprint_id, properties, content, belongs_to } = parsed.data;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const actor = getActor(req);
    let { visibility } = parsed.data;

    // If parent_id is provided and visibility is not specified, inherit from parent
    if (parent_id && !visibility) {
      const parent = await getReadableDocument(client, actor, parent_id);
      if (!parent) {
        res.status(404).json({ error: 'Parent document not found' });
        return;
      }
      visibility = parent.visibility;
    }

    // Default to 'workspace' visibility if not specified
    visibility = visibility || 'workspace';

    const references = [
      ...(parent_id ? [{ id: parent_id, type: 'parent' as const, label: 'Parent document' }] : []),
      ...(program_id ? [{ id: program_id, type: 'program' as const, label: 'Program' }] : []),
      ...(sprint_id ? [{ id: sprint_id, type: 'sprint' as const, label: 'Sprint' }] : []),
      ...((belongs_to || []).map((association) => ({
        id: association.id,
        type: association.type,
        label: `${association.type} document`,
      }))),
    ];
    const referencesResult = await validateDocumentReferences(client, actor, references);
    if (!referencesResult.ok) {
      res.status(404).json({ error: referencesResult.error });
      return;
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO documents (workspace_id, document_type, title, parent_id, properties, created_by, visibility, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [workspaceId, document_type, title, parent_id || null, JSON.stringify(properties || {}), userId, visibility, content ? JSON.stringify(content) : null]
    );

    const newDoc = result.rows[0];

    // Handle belongs_to associations (creates document_associations records)
    if (belongs_to && belongs_to.length > 0) {
      await syncBelongsToAssociations(newDoc.id, belongs_to, client);
    }

    // Handle sprint_id via document_associations (backward compatibility)
    if (sprint_id) {
      await addBelongsToAssociation(newDoc.id, sprint_id, 'sprint', client);
    }

    // Handle program_id via document_associations (mirrors column for junction table queries)
    if (program_id) {
      await addBelongsToAssociation(newDoc.id, program_id, 'program', client);
    }

    await client.query('COMMIT');
    await upsertDocumentSearchIndex(newDoc.id);

    // Broadcast accountability update for document types that affect action items
    // Sprint plans clear the "write sprint plan" action item
    // Documents with outcome property linked to sprints clear the "write retro" action item
    if (document_type === 'weekly_plan' || (properties && 'outcome' in properties)) {
      broadcastToUser(userId, 'accountability:updated', { documentId: newDoc.id, documentType: document_type });
    }

    res.status(201).json(newDoc);
  } catch (err) {
    await client.query('ROLLBACK');
    sendInternalError(res, err, 'Create document error:');
  } finally {
    client.release();
  }
});

// Update document
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);
    const actor = getActor(req);

    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    // Verify document exists and user can access it
    const { canAccess, doc: existing } = await canAccessDocument(id, userId, workspaceId);

    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const data = parsed.data;

    const references = [
      ...(data.parent_id ? [{ id: data.parent_id, type: 'parent' as const, label: 'Parent document' }] : []),
      ...(data.program_id ? [{ id: data.program_id, type: 'program' as const, label: 'Program' }] : []),
      ...(data.sprint_id ? [{ id: data.sprint_id, type: 'sprint' as const, label: 'Sprint' }] : []),
      ...((data.belongs_to || []).map((association) => ({
        id: association.id,
        type: association.type,
        label: `${association.type} document`,
      }))),
    ];
    const referencesResult = await validateDocumentReferences(client, actor, references);
    if (!referencesResult.ok) {
      res.status(404).json({ error: referencesResult.error });
      return;
    }

    // Check permission for visibility changes
    if (data.visibility !== undefined && data.visibility !== existing.visibility) {
      const isCreator = existing.created_by === userId;
      const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

      if (!isCreator && !isAdmin) {
        res.status(403).json({ error: 'Only the creator or admin can change document visibility' });
        return;
      }
    }

    // Handle moving private doc to workspace parent (changes visibility to workspace)
    if (data.parent_id !== undefined && data.parent_id !== null && data.visibility === undefined) {
      const parent = await getReadableDocument(client, actor, data.parent_id);
      if (parent?.visibility === 'workspace' && existing.visibility === 'private') {
        // Moving private doc under workspace parent makes it workspace-visible
        data.visibility = 'workspace';
      }
    }

    await client.query('BEGIN');

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Track extracted values from content (content is source of truth)
    let extractedHypothesis: string | null = null;
    let extractedCriteria: string | null = null;
    let extractedVision: string | null = null;
    let extractedGoals: string | null = null;
    let contentUpdated = false;
    let resubmissionTarget: { sprintId: string; reviewerUserId: string | null } | null = null;

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(JSON.stringify(data.content));
      // Clear yjs_state when content is updated via API
      // This forces the collaboration server to regenerate Yjs state from new content
      updates.push(`yjs_state = NULL`);

      // Extract hypothesis, success criteria, vision, and goals from content (content is source of truth)
      extractedHypothesis = extractHypothesisFromContent(data.content);
      extractedCriteria = extractSuccessCriteriaFromContent(data.content);
      extractedVision = extractVisionFromContent(data.content);
      extractedGoals = extractGoalsFromContent(data.content);
      contentUpdated = true;
    }
    if (data.parent_id !== undefined) {
      updates.push(`parent_id = $${paramIndex++}`);
      values.push(data.parent_id);
    }
    // Note: program_id is handled via document_associations table (see below)
    // Note: sprint_id is handled via document_associations table (see below)
    if (data.position !== undefined) {
      updates.push(`position = $${paramIndex++}`);
      values.push(data.position);
    }

    // Extract top-level issue/project/sprint fields that should be stored in properties
    const topLevelProps: Record<string, unknown> = {};
    if (data.state !== undefined) topLevelProps.state = data.state;
    if (data.priority !== undefined) topLevelProps.priority = data.priority;
    if (data.estimate !== undefined) topLevelProps.estimate = data.estimate;
    if (data.assignee_id !== undefined) topLevelProps.assignee_id = data.assignee_id;
    if (data.source !== undefined) topLevelProps.source = data.source;
    if (data.rejection_reason !== undefined) topLevelProps.rejection_reason = data.rejection_reason;
    if (data.impact !== undefined) topLevelProps.impact = data.impact;
    if (data.confidence !== undefined) topLevelProps.confidence = data.confidence;
    if (data.ease !== undefined) topLevelProps.ease = data.ease;
    if (data.color !== undefined) topLevelProps.color = data.color;
    if (data.owner_id !== undefined) topLevelProps.owner_id = data.owner_id;
    // RACI fields for projects
    if (data.accountable_id !== undefined) topLevelProps.accountable_id = data.accountable_id;
    if (data.consulted_ids !== undefined) topLevelProps.consulted_ids = data.consulted_ids;
    if (data.informed_ids !== undefined) topLevelProps.informed_ids = data.informed_ids;
    // Design review fields for projects
    if (data.has_design_review !== undefined) topLevelProps.has_design_review = data.has_design_review;
    if (data.design_review_notes !== undefined) topLevelProps.design_review_notes = data.design_review_notes;
    // For sprints, also store owner in assignee_ids array (sprints API reads from assignee_ids[0])
    if (data.owner_id !== undefined && existing.document_type === 'sprint') {
      topLevelProps.assignee_ids = data.owner_id ? [data.owner_id] : [];
    }
    // Note: start_date/end_date are computed from sprint_number + workspace.sprint_start_date
    if (data.status !== undefined) topLevelProps.status = data.status;
    // Note: hypothesis/plan can be set via API but content extraction always wins when content is updated
    // Accept both 'hypothesis' (legacy) and 'plan' (current), store as 'plan'
    if (data.hypothesis !== undefined) topLevelProps.plan = data.hypothesis;
    // Plan field (frontend sends 'plan' for sprint documents, stored in properties.plan)
    if (data.plan !== undefined) topLevelProps.plan = data.plan;
    // RACI fields (for projects and programs)
    if (data.accountable_id !== undefined) topLevelProps.accountable_id = data.accountable_id;
    if (data.consulted_ids !== undefined) topLevelProps.consulted_ids = data.consulted_ids;
    if (data.informed_ids !== undefined) topLevelProps.informed_ids = data.informed_ids;

    const hasTopLevelProps = Object.keys(topLevelProps).length > 0;

    // Restrict reports_to changes on person documents to workspace admins
    if (existing.document_type === 'person' && data.properties?.reports_to !== undefined) {
      const isAdmin = await isWorkspaceAdmin(userId, workspaceId);
      if (!isAdmin) {
        res.status(403).json({ error: 'Only workspace admins can set the reports_to field' });
        return;
      }
    }

    // Handle properties update - merge existing, data.properties, top-level fields, and extracted values
    // Content is source of truth: extracted values override any manually set hypothesis/success_criteria/vision/goals
    if (data.properties !== undefined || contentUpdated || hasTopLevelProps) {
      const currentProps = existing.properties || {};
      const dataProps = data.properties || {};
      let newProps = {
        ...currentProps,
        ...dataProps,
        ...topLevelProps,
        // Extracted values always win (content is source of truth)
        // Note: 'plan' is the canonical field name (renamed from 'hypothesis' in migration 032)
        ...(contentUpdated ? {
          plan: extractedHypothesis,
          success_criteria: extractedCriteria,
          vision: extractedVision,
          goals: extractedGoals,
        } : {}),
      };

      // Compute document completeness for projects and sprints
      if (existing.document_type === 'project' || existing.document_type === 'sprint') {
        let linkedIssuesCount = 0;

        // For sprints, count linked issues via document_associations
        if (existing.document_type === 'sprint') {
          const issueCountResult = await client.query(
            `SELECT COUNT(*) as count FROM documents d
             JOIN document_associations da ON da.document_id = d.id
             WHERE da.related_id = $1 AND da.relationship_type = 'sprint' AND d.document_type = $2`,
            [id, 'issue']
          );
          linkedIssuesCount = parseInt(issueCountResult.rows[0]?.count || '0', 10);
        }

        const completeness = checkDocumentCompleteness(
          existing.document_type,
          newProps,
          linkedIssuesCount
        );

        newProps = {
          ...newProps,
          is_complete: completeness.isComplete,
          missing_fields: completeness.missingFields,
        };
      }

      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }
    if (data.visibility !== undefined) {
      updates.push(`visibility = $${paramIndex++}`);
      values.push(data.visibility);
    }

    // Handle document_type change
    if (data.document_type !== undefined && data.document_type !== existing.document_type) {
      // Only the document creator can change its type
      if (existing.created_by !== userId) {
        res.status(403).json({ error: 'Only the document creator can change its type' });
        return;
      }

      // Restrict certain type changes (can't change to/from program or person)
      const restrictedTypes = ['program', 'person'];
      if (restrictedTypes.includes(existing.document_type) || restrictedTypes.includes(data.document_type)) {
        res.status(400).json({ error: 'Cannot change to or from program or person document types' });
        return;
      }

      updates.push(`document_type = $${paramIndex++}`);
      values.push(data.document_type);

      // When changing to 'issue', assign a ticket number if not already present
      if (data.document_type === 'issue' && !existing.ticket_number) {
        // Use advisory lock to serialize ticket number generation per workspace
        const workspaceIdHex = workspaceId.replace(/-/g, '').substring(0, 15);
        const lockKey = parseInt(workspaceIdHex, 16);
        await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

        // Now safely get next ticket number - we hold the lock until transaction ends
        const ticketResult = await client.query(
          `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
           FROM documents
           WHERE workspace_id = $1 AND document_type = 'issue'`,
          [workspaceId]
        );
        const ticketNumber = ticketResult.rows[0].next_number;
        updates.push(`ticket_number = $${paramIndex++}`);
        values.push(ticketNumber);
      }

      // When changing from 'issue' to another type, preserve ticket_number for reference
      // (don't clear it - it serves as a historical reference)
    }

    // Track if we have association updates (belongs_to, program_id, sprint_id)
    // program_id and sprint_id are handled via document_associations table, not the updates array
    const hasBelongsToUpdate = data.belongs_to !== undefined;
    const hasProgramIdUpdate = data.program_id !== undefined;
    const hasSprintIdUpdate = data.sprint_id !== undefined;

    if (updates.length === 0 && !hasBelongsToUpdate && !hasProgramIdUpdate && !hasSprintIdUpdate) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Handle belongs_to association updates
    if (hasBelongsToUpdate) {
      const newBelongsTo = data.belongs_to || [];
      await syncBelongsToAssociations(id, newBelongsTo, client);
    }

    // Handle sprint_id via document_associations (when passed directly, not via belongs_to)
    if (data.sprint_id !== undefined && !hasBelongsToUpdate) {
      await updateSprintAssociation(id, null, client);

      // Add new sprint association if sprint_id is not null
      if (data.sprint_id !== null) {
        await addBelongsToAssociation(id, data.sprint_id, 'sprint', client);
      }
    }

    // Handle program_id via document_associations (when passed directly, not via belongs_to)
    if (data.program_id !== undefined && !hasBelongsToUpdate) {
      await updateProgramAssociation(id, null, client);

      // Add new program association if program_id is not null
      if (data.program_id !== null) {
        await addBelongsToAssociation(id, data.program_id, 'program', client);
      }
    }

    // If we only had belongs_to updates, still update the timestamp
    if (updates.length === 0) {
      updates.push(`updated_at = now()`);
    } else {
      updates.push(`updated_at = now()`);
    }

    const result = await client.query(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} RETURNING *`,
      [...values, id, workspaceId]
    );

    // When a weekly plan/retro is edited after changes were requested, move it back to re-review.
    if (contentUpdated && (existing.document_type === 'weekly_plan' || existing.document_type === 'weekly_retro')) {
      const docProps = existing.properties || {};
      const personId = typeof docProps.person_id === 'string' ? docProps.person_id : null;
      const projectId = typeof docProps.project_id === 'string' ? docProps.project_id : null;
      const rawWeekNumber = docProps.week_number;
      const weekNumber = typeof rawWeekNumber === 'number'
        ? rawWeekNumber
        : typeof rawWeekNumber === 'string'
          ? Number.parseInt(rawWeekNumber, 10)
          : NaN;

      if (personId && projectId && Number.isFinite(weekNumber)) {
        const sprintResult = await client.query(
          `SELECT id, properties
           FROM documents
           WHERE workspace_id = $1
             AND document_type = 'sprint'
             AND deleted_at IS NULL
             AND (properties->>'project_id') = $2
             AND (properties->>'sprint_number')::int = $3
             AND (
               properties->>'owner_id' = $4
               OR EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements_text(COALESCE(properties->'assignee_ids', '[]'::jsonb)) AS assignee_id
                 WHERE assignee_id = $4
               )
             )
           ORDER BY updated_at DESC
           LIMIT 1`,
          [workspaceId, projectId, weekNumber, personId]
        );

        if (sprintResult.rows.length > 0) {
          const sprint = sprintResult.rows[0];
          const sprintProps = asDocumentProperties(sprint.properties);
          const approvalKey = existing.document_type === 'weekly_plan' ? 'plan_approval' : 'review_approval';
          const approval = asApprovalRecord(sprintProps[approvalKey]);

          if (approval?.state === 'changes_requested') {
            const nextProps = {
              ...sprintProps,
              [approvalKey]: {
                ...approval,
                state: 'changed_since_approved',
              },
            };

            await client.query(
              `UPDATE documents SET properties = $1, updated_at = now()
               WHERE id = $2 AND document_type = 'sprint'`,
              [JSON.stringify(nextProps), sprint.id]
            );

            resubmissionTarget = {
              sprintId: String(sprint.id),
              reviewerUserId: typeof approval.approved_by === 'string' ? approval.approved_by : null,
            };
          }
        }
      }
    }

    // Cascade visibility changes to child documents
    if (data.visibility !== undefined && data.visibility !== existing.visibility) {
      await client.query(
        `WITH RECURSIVE descendants AS (
          SELECT id FROM documents WHERE parent_id = $1
          UNION ALL
          SELECT d.id FROM documents d
          INNER JOIN descendants descendant ON d.parent_id = descendant.id
        )
        UPDATE documents SET visibility = $2, updated_at = now()
        WHERE id IN (SELECT id FROM descendants)`,
        [id, data.visibility]
      );
    }

    await client.query('COMMIT');
    await upsertDocumentSearchIndex(id);

    // Post-commit operations (non-transactional)

    // Invalidate collaboration cache when content is updated via API
    if (contentUpdated) {
      invalidateDocumentCache(id);
    }

    // Notify WebSocket collaboration server to disconnect users who lost access
    if (data.visibility !== undefined && data.visibility !== existing.visibility) {
      handleVisibilityChange(id, data.visibility, existing.created_by).catch((err) => {
        console.error('Failed to handle visibility change for collaboration:', err);
      });
    }

    if (resubmissionTarget) {
      // Refresh action items for the document owner and reviewer after resubmission.
      broadcastToUser(userId, 'accountability:updated', {
        type: existing.document_type,
        targetId: resubmissionTarget.sprintId,
      });
      if (resubmissionTarget.reviewerUserId && resubmissionTarget.reviewerUserId !== userId) {
        broadcastToUser(resubmissionTarget.reviewerUserId, 'accountability:updated', {
          type: existing.document_type,
          targetId: resubmissionTarget.sprintId,
        });
      }
    }

    // Flatten properties for backwards compatibility (match GET endpoint format)
    const updatedDoc = result.rows[0];
    const props = updatedDoc.properties || {};

    // Get owner details for projects (owner_id is a user_id, lookup person document by user_id)
    // Return user_id as id so PersonCombobox can match correctly
    let owner: { id: string; name: string; email: string } | null = null;
    if (updatedDoc.document_type === 'project' && props.owner_id) {
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

    res.json({
      ...updatedDoc,
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
      owner_id: props.owner_id,
      owner,
      // Generic properties
      prefix: props.prefix,
      color: props.color,
      // Sprint properties (dates computed from sprint_number + workspace.sprint_start_date)
      status: props.status,
      plan: props.plan,
      plan_approval: props.plan_approval,
      review_approval: props.review_approval,
      review_rating: props.review_rating,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    sendInternalError(res, err, 'Update document error:');
  } finally {
    client.release();
  }
});

// Delete document
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Check if user can access the document
    const { canAccess, doc } = await canAccessDocument(id, userId, workspaceId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const result = await pool.query<DocumentDeleteRow>(
      'DELETE FROM documents WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.status(204).send();
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
  const client = await pool.connect();
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    const parsed = convertDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { target_type } = parsed.data;

    // Check if user can access the document
    const { canAccess, doc } = await canAccessDocument(id, userId, workspaceId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Only the document creator can convert it (significant structural change)
    if (doc.created_by !== userId) {
      res.status(403).json({ error: 'Only the document creator can convert it' });
      return;
    }

    // Validate conversion is between issue and project only
    if (doc.document_type !== 'issue' && doc.document_type !== 'project') {
      res.status(400).json({ error: 'Only issues and projects can be converted' });
      return;
    }

    // Validate not converting to same type
    if (doc.document_type === target_type) {
      res.status(400).json({ error: `Document is already a ${target_type}` });
      return;
    }

    // Check if document is archived
    if (doc.archived_at) {
      res.status(400).json({ error: 'Cannot convert an archived document' });
      return;
    }

    await client.query('BEGIN');

    const currentProps = doc.properties || {};
    const sourceType = doc.document_type;

    // 1. Create snapshot of current state for undo capability
    await client.query(
      `INSERT INTO document_snapshots (
        document_id, document_type, title, properties, ticket_number,
        snapshot_reason, created_by
      )
      VALUES ($1, $2, $3, $4, $5, 'conversion', $6)`,
      [
        id,
        sourceType,
        doc.title,
        JSON.stringify(currentProps),
        doc.ticket_number,
        userId,
      ]
    );

    // 2. Prepare new properties based on target type
    let newProperties: Record<string, unknown>;
    let newTicketNumber: number | null = null;

    if (target_type === 'project') {
      // Issue -> Project: set project defaults, preserve program_id
      newProperties = {
        impact: 3,
        confidence: 3,
        ease: 3,
        color: '#6366f1',
        owner_id: userId,
        program_id: currentProps.program_id || null,
        // Track original ticket number for reference
        promoted_from_ticket: doc.ticket_number,
      };
      // Clear ticket_number for projects
      newTicketNumber = null;
    } else {
      // Project -> Issue: set issue defaults, preserve program_id
      // Need fresh ticket number with advisory lock
      const workspaceIdHex = workspaceId.replace(/-/g, '').substring(0, 15);
      const lockKey = parseInt(workspaceIdHex, 16);
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      const ticketResult = await client.query(
        `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
         FROM documents
         WHERE workspace_id = $1 AND document_type = 'issue'`,
        [workspaceId]
      );
      newTicketNumber = ticketResult.rows[0].next_number;

      newProperties = {
        state: 'backlog',
        priority: 'medium',
        source: 'internal',
        assignee_id: null,
        rejection_reason: null,
        program_id: currentProps.program_id || null,
        // Track conversion from project
        demoted_from_project: true,
      };

      // Remove 'project' associations from child issues pointing to this document
      // (They become orphaned - their parent project is being converted to an issue)
      await client.query(
        `DELETE FROM document_associations
         WHERE related_id = $1 AND relationship_type = 'project'`,
        [id]
      );
    }

    // 3. Update document in-place with new type and properties
    const updateResult = await client.query(
      `UPDATE documents
       SET document_type = $1,
           properties = $2,
           ticket_number = $3,
           original_type = COALESCE(original_type, $4),
           conversion_count = COALESCE(conversion_count, 0) + 1,
           converted_from_id = $5,
           converted_at = NOW(),
           converted_by = $6,
           updated_at = NOW()
       WHERE id = $7 AND workspace_id = $8
       RETURNING *`,
      [
        target_type,
        JSON.stringify(newProperties),
        newTicketNumber,
        sourceType, // Set original_type only if not already set
        id, // converted_from_id points to self (for tracking conversion happened)
        userId,
        id,
        workspaceId,
      ]
    );

    const updatedDoc = updateResult.rows[0];

    // 4. Update associations - remove invalid ones for new type
    // Issues can have: parent, project, sprint, program
    // Projects can only have: program
    if (target_type === 'project') {
      // Remove non-program associations (project can only have program)
      await client.query(
        `DELETE FROM document_associations
         WHERE document_id = $1 AND relationship_type != 'program'`,
        [id]
      );
    }
    // If converting to issue, keep all associations (issues support more types)

    await client.query('COMMIT');

    // Return the updated document (same ID!)
    const props = updatedDoc.properties || {};
    res.status(200).json({
      ...updatedDoc,
      // Flatten properties for frontend
      ...(target_type === 'issue' && {
        state: props.state,
        priority: props.priority,
        assignee_id: props.assignee_id,
        source: props.source,
      }),
      ...(target_type === 'project' && {
        impact: props.impact,
        confidence: props.confidence,
        ease: props.ease,
        color: props.color,
        owner_id: props.owner_id,
      }),
      program_id: props.program_id,
      converted_from_type: sourceType,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    sendInternalError(res, err, 'Convert document error:');
  } finally {
    client.release();
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
