import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getActor, getDocumentAccessContext, visibilityPredicate } from '../../services/document-access.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import {
  createDocumentMutation,
  deleteDocumentMutation,
  updateDocumentMutation,
} from '../../services/document-mutations.js';
import { principalFromRequest } from '../../security/principal.js';
import {
  readAssigneeIdsFromProperties,
  readDocumentDetailFields,
  readOwnerIdFromProperties,
  readPersonIdFromProperties,
} from '../../utils/document-properties.js';
import {
  createDocumentSchema,
  updateDocumentSchema,
  loadDocumentForRead,
  extractBelongsToAssocFromRow,
  type DocumentTypeRow,
  type PersonOwnerRow,
  type PersonTitleRow,
  type BelongsToAssocRow,
} from './shared.js';

const router = Router();

router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const actor = getActor(req);
    const { userId, workspaceId } = actor;
    const { isAdmin } = await getDocumentAccessContext(actor);

    const { allowed, doc } = await loadDocumentForRead(req, id);

    if (!allowed || !doc) {
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

    const detailFields = readDocumentDetailFields(doc.properties, doc.document_type);
    const ownerId = readOwnerIdFromProperties(doc.properties);
    const assigneeIds = readAssigneeIdsFromProperties(doc.properties);
    const personId = readPersonIdFromProperties(doc.properties);

    // Get owner details for projects (owner_id is a user_id, lookup person document by user_id)
    // Return user_id as id so PersonCombobox can match correctly
    let owner: { id: string; name: string; email: string } | null = null;
    if (doc.document_type === 'project' && ownerId) {
      const ownerResult = await pool.query<PersonOwnerRow>(
        `SELECT (d.properties->>'user_id')::text as id, d.title as name, COALESCE(d.properties->>'email', u.email) as email
         FROM documents d
         LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
         WHERE (d.properties->>'user_id')::uuid = $1 AND d.workspace_id = $2 AND d.document_type = 'person'`,
        [ownerId, workspaceId]
      );
      if (ownerResult.rows.length > 0) {
        owner = ownerResult.rows[0] ?? null;
      }
    }

    // Get owner details for sprints (owner stored in assignee_ids[0], consistent with sprints API)
    // Return user_id as id so Combobox can match correctly
    if (doc.document_type === 'sprint' && assigneeIds[0]) {
      const ownerResult = await pool.query<PersonOwnerRow>(
        `SELECT u.id::text as id, d.title as name, COALESCE(d.properties->>'email', u.email) as email
         FROM users u
         LEFT JOIN documents d ON (d.properties->>'user_id')::uuid = u.id AND d.document_type = 'person' AND d.workspace_id = $2
         WHERE u.id = $1`,
        [assigneeIds[0], workspaceId]
      );
      if (ownerResult.rows.length > 0) {
        owner = ownerResult.rows[0] ?? null;
      }
    }

    // Compute title for weekly_plan/weekly_retro documents (includes person name for entity reference)
    let computedTitle = doc.title;
    if ((doc.document_type === 'weekly_plan' || doc.document_type === 'weekly_retro') && personId) {
      const personResult = await pool.query<PersonTitleRow>(
        `SELECT title FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
        [personId, workspaceId]
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

    res.json({
      ...doc,
      title: computedTitle,
      ...detailFields,
      owner_id:
        doc.document_type === 'sprint' && detailFields.assignee_ids?.[0]
          ? detailFields.assignee_ids[0]
          : detailFields.owner_id ?? null,
      owner,
      accountable_id: detailFields.accountable_id ?? null,
      consulted_ids: detailFields.consulted_ids ?? [],
      informed_ids: detailFields.informed_ids ?? [],
      has_design_review: detailFields.has_design_review ?? null,
      design_review_notes: detailFields.design_review_notes ?? null,
      plan_approval: detailFields.plan_approval ?? null,
      review_approval: detailFields.review_approval ?? null,
      ...((doc.document_type === 'issue' || doc.document_type === 'wiki' || doc.document_type === 'sprint' || doc.document_type === 'project') && { belongs_to }),
    });
  } catch (err) {
    sendInternalError(res, err, 'Get document error:');
  }
});

// Get document content as TipTap JSON
// This endpoint converts Yjs state to TipTap JSON if content is null
// Useful for API-based document editing without using the collaborative editor

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
      principal: principalFromRequest(req),
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
      principal: principalFromRequest(req),
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
      principal: principalFromRequest(req),
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

export default router;
