import { pool } from '../../db/client.js';
import {
  handleDocumentConversion,
  invalidateDocumentCache,
} from '../../collaboration/index.js';
import { removeAssociationsByType } from '../../utils/document-crud.js';
import {
  creatorWriteCapability,
  guardMutationCapability,
  loadAccessibleDocument,
  nextIssueTicketNumber,
  removeAssociationsByRelatedId,
} from './shared.js';
import {
  type ConvertDocumentInput,
  type DocumentAccessRow,
  type MutationResult,
} from './types.js';

export async function convertDocumentMutation({
  actor,
  principal,
  documentId,
  targetType,
}: ConvertDocumentInput): Promise<MutationResult<Record<string, unknown>>> {
  const denied = await guardMutationCapability(
    pool,
    principal,
    creatorWriteCapability(documentId, true),
  );
  if (denied) return denied;

  const client = await pool.connect();

  try {
    const doc = await loadAccessibleDocument(client, principal, documentId, { includeArchived: true });
    if (!doc) {
      return { ok: false, status: 404, body: { error: 'Document not found' } };
    }

    if (doc.created_by !== actor.userId) {
      return { ok: false, status: 403, body: { error: 'Only the document creator can convert it' } };
    }

    if (doc.document_type !== 'issue' && doc.document_type !== 'project') {
      return { ok: false, status: 400, body: { error: 'Only issues and projects can be converted' } };
    }

    if (doc.document_type === targetType) {
      return { ok: false, status: 400, body: { error: `Document is already a ${targetType}` } };
    }

    if (doc.archived_at) {
      return { ok: false, status: 400, body: { error: 'Cannot convert an archived document' } };
    }

    await client.query('BEGIN');

    const currentProps = doc.properties || {};
    const sourceType = doc.document_type;

    await client.query(
      `INSERT INTO document_snapshots (
        document_id, document_type, title, properties, ticket_number,
        snapshot_reason, created_by
      )
      VALUES ($1, $2, $3, $4, $5, 'conversion', $6)`,
      [
        documentId,
        sourceType,
        doc.title,
        JSON.stringify(currentProps),
        doc.ticket_number,
        actor.userId,
      ]
    );

    let newProperties: Record<string, unknown>;
    let newTicketNumber: number | null = null;

    if (targetType === 'project') {
      newProperties = {
        ...currentProps,
        impact: 3,
        confidence: 3,
        ease: 3,
        color: '#6366f1',
        owner_id: actor.userId,
        program_id: currentProps.program_id || null,
        promoted_from_ticket: doc.ticket_number,
      };
      newTicketNumber = null;
    } else {
      newTicketNumber = await nextIssueTicketNumber(client, actor.workspaceId);

      newProperties = {
        ...currentProps,
        state: 'backlog',
        priority: 'medium',
        source: 'internal',
        assignee_id: null,
        rejection_reason: null,
        program_id: currentProps.program_id || null,
        demoted_from_project: true,
      };

      await removeAssociationsByRelatedId(client, documentId, 'project');
    }

    const updateResult = await client.query<DocumentAccessRow>(
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
        targetType,
        JSON.stringify(newProperties),
        newTicketNumber,
        sourceType,
        documentId,
        actor.userId,
        documentId,
        actor.workspaceId,
      ]
    );

    const updatedDoc = updateResult.rows[0];
    if (!updatedDoc) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, body: { error: 'Document not found' } };
    }

    if (targetType === 'project') {
      await removeAssociationsByType(documentId, 'project', client);
      await removeAssociationsByType(documentId, 'sprint', client);
      await removeAssociationsByType(documentId, 'parent', client);
    }

    await client.query('COMMIT');

    invalidateDocumentCache(documentId);
    handleDocumentConversion(documentId, documentId, sourceType, targetType);

    const props = updatedDoc.properties || {};
    return {
      ok: true,
      status: 200,
      body: {
        ...updatedDoc,
        ...(targetType === 'issue' && {
          state: props.state,
          priority: props.priority,
          assignee_id: props.assignee_id,
          source: props.source,
        }),
        ...(targetType === 'project' && {
          impact: props.impact,
          confidence: props.confidence,
          ease: props.ease,
          color: props.color,
          owner_id: props.owner_id,
        }),
        program_id: props.program_id,
        converted_from_type: sourceType,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
