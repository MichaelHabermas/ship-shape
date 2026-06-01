import { Router, Request, Response } from 'express';
import { pool } from '../../db/client.js';
import { authMiddleware } from '../../middleware/auth.js';
import { getActor } from '../../services/document-access.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../../utils/route-http.js';
import {
  convertDocumentMutation,
  deleteDocumentMutation,
  updateDocumentContentMutation,
  updateDocumentMutation,
} from '../../services/document-mutations.js';
import { authorize, capabilityDenialStatus, documentCommandCapability } from '../../security/capabilities.js';
import { principalFromRequest } from '../../security/principal.js';
import { guardDocumentIdParam } from '../../security/route-capability.js';
import { readRestoredDocumentFields } from '../../utils/document-properties.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import {
  loadDocumentForRead,
  documentCommandSchema,
  convertDocumentSchema,
  type DocumentAccessRow,
  type DocumentSnapshotRow,
  type NextTicketNumberRow,
} from './shared.js';

const router = Router();

router.post('/:id/commands', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const parsed = documentCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const actor = getActor(req);
    const principal = principalFromRequest(req);
    const command = parsed.data;
    const { action, enforce } = documentCommandCapability(command);
    const decision = await authorize(pool, principal, {
      resource: 'document',
      action,
      documentId: id,
      enforce,
    });

    if (!decision.allowed) {
      res.status(capabilityDenialStatus(decision.reason)).json({ error: decision.reason });
      return;
    }

    if (command.type === 'edit_content') {
      const mutation = await updateDocumentContentMutation({
        actor,
        principal,
        documentId: id,
        content: command.content,
        source: 'rest',
      });
      res.status(mutation.status).json(mutation.body);
      return;
    }

    if (command.type === 'convert') {
      const mutation = await convertDocumentMutation({
        actor,
        principal,
        documentId: id,
        targetType: command.target_type,
        source: 'rest',
      });
      res.status(mutation.status).json(mutation.body);
      return;
    }

    if (command.type === 'delete') {
      const mutation = await deleteDocumentMutation({
        actor,
        principal,
        documentId: id,
        source: 'rest',
      });
      if (mutation.status === 204) {
        res.status(204).send();
        return;
      }
      res.status(mutation.status).json(mutation.body);
      return;
    }

    const patch =
      command.type === 'set_governance' || command.type === 'set_raci'
        ? { properties: command.properties }
        : command.type === 'set_workflow_status'
          ? { status: command.status }
          : command.type === 'set_visibility'
            ? { visibility: command.visibility }
            : command.type === 'set_parent'
              ? { parent_id: command.parent_id }
              : { belongs_to: command.belongs_to };

    const mutation = await updateDocumentMutation({
      actor,
      principal,
      documentId: id,
      patch,
      capability: { action, documentId: id, enforce },
      source: 'rest',
    });
    res.status(mutation.status).json(mutation.body);
  } catch (err) {
    sendInternalError(res, err, 'Run document command error:');
  }
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
      principal: principalFromRequest(req),
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
  const id = guardDocumentIdParam(res, req.params.id, 'Document not found');
  if (!id) return;
  const { userId, workspaceId } = getAuthenticatedRouteContext(req);
  const principal = principalFromRequest(req);

  let writeDecision = await authorize(pool, principal, {
    resource: 'document',
    action: 'write',
    documentId: id,
    enforce: 'creator_or_admin',
  });

  if (!writeDecision.allowed) {
    const readDecision = await authorize(pool, principal, {
      resource: 'document',
      action: 'read',
      documentId: id,
    });
    if (!readDecision.allowed) {
      res.status(capabilityDenialStatus(readDecision.reason)).json({ error: readDecision.reason });
      return;
    }
    const converterCheck = await pool.query<{ converted_by: string | null }>(
      `SELECT converted_by FROM documents WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, workspaceId]
    );
    const convertedBy = converterCheck.rows[0]?.converted_by;
    if (convertedBy !== userId) {
      res.status(403).json({ error: 'Only the document creator or converter can undo conversion' });
      return;
    }
    writeDecision = readDecision;
  }

  const currentDocResult = await pool.query<DocumentAccessRow>(
    `SELECT d.*, true AS can_access
       FROM documents d
      WHERE d.id = $1 AND d.workspace_id = $2 AND d.deleted_at IS NULL`,
    [id, workspaceId]
  );
  const currentDoc = currentDocResult.rows[0];
  if (!currentDoc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the most recent snapshot for this document
    const snapshotResult = await client.query<DocumentSnapshotRow>(
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

    const snapshot = requireFirstRow(snapshotResult.rows);
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

      const ticketResult = await client.query<NextTicketNumberRow>(
        `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
         FROM documents
         WHERE workspace_id = $1 AND document_type = 'issue'`,
        [workspaceId]
      );
      restoredTicketNumber = requireFirstRow(ticketResult.rows).next_number;
    }

    // If restoring to a project, clear ticket number
    if (restoredType === 'project') {
      restoredTicketNumber = null;
    }

    const updateResult = await client.query<DocumentAccessRow>(
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

    const restoredDoc = requireFirstRow(updateResult.rows);

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

    const restoredFields = readRestoredDocumentFields(restoredDoc.properties, restoredType);
    res.status(200).json({
      ...restoredDoc,
      ...(restoredType === 'issue' && {
        state: restoredFields.state,
        priority: restoredFields.priority,
        assignee_id: restoredFields.assignee_id,
        source: restoredFields.source,
      }),
      ...(restoredType === 'project' && {
        impact: restoredFields.impact,
        confidence: restoredFields.confidence,
        ease: restoredFields.ease,
        color: restoredFields.color,
        owner_id: restoredFields.owner_id,
      }),
      program_id: restoredFields.program_id,
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
