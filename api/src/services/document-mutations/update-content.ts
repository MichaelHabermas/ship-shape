import { pool } from '../../db/client.js';
import { invalidateDocumentCache, broadcastToUser } from '../../collaboration/index.js';
import { stampWeeklyAccountabilitySubmittedAt } from '../../utils/document-governance.js';
import { upsertDocumentSearchIndex } from '../../utils/tiptap-search.js';
import {
  defaultWriteCapability,
  extractedContentProperties,
  guardMutationCapability,
  loadAccessibleDocument,
  resetWeeklyApprovalAfterResubmission,
  validateTipTapContent,
} from './shared.js';
import {
  type DocumentContentRow,
  type MutationResult,
  type UpdateDocumentContentInput,
} from './types.js';

export async function updateDocumentContentMutation({
  actor,
  principal,
  documentId,
  content,
}: UpdateDocumentContentInput): Promise<MutationResult<DocumentContentRow>> {
  const denied = await guardMutationCapability(pool, principal, defaultWriteCapability(documentId));
  if (denied) return denied;

  const validationError = validateTipTapContent(content);
  if (validationError) return validationError;

  const client = await pool.connect();
  let resubmissionTarget: { sprintId: string; reviewerUserId: string | null } | null = null;

  try {
    const existing = await loadAccessibleDocument(client, principal, documentId, { includeArchived: true });
    if (!existing) {
      return { ok: false, status: 404, body: { error: 'Document not found' } };
    }

    const contentChanged = JSON.stringify(content) !== JSON.stringify(existing.content ?? null);
    const newProps = stampWeeklyAccountabilitySubmittedAt(
      existing.document_type,
      {
        ...(existing.properties || {}),
        ...extractedContentProperties(content),
      },
      contentChanged
    );

    await client.query('BEGIN');
    await client.query(
      `UPDATE documents
       SET content = $1, yjs_state = $2, properties = $3, updated_at = now()
       WHERE id = $4 AND workspace_id = $5`,
      [JSON.stringify(content), null, JSON.stringify(newProps), documentId, actor.workspaceId]
    );
    resubmissionTarget = await resetWeeklyApprovalAfterResubmission(client, actor, existing);

    const result = await client.query<DocumentContentRow>(
      `SELECT id, title, content FROM documents WHERE id = $1 AND workspace_id = $2`,
      [documentId, actor.workspaceId]
    );

    await client.query('COMMIT');

    invalidateDocumentCache(documentId);
    await upsertDocumentSearchIndex(documentId);

    if (resubmissionTarget) {
      broadcastToUser(actor.userId, 'accountability:updated', {
        type: existing.document_type,
        targetId: resubmissionTarget.sprintId,
      });
      if (resubmissionTarget.reviewerUserId && resubmissionTarget.reviewerUserId !== actor.userId) {
        broadcastToUser(resubmissionTarget.reviewerUserId, 'accountability:updated', {
          type: existing.document_type,
          targetId: resubmissionTarget.sprintId,
        });
      }
    }

    const updated = result.rows[0];
    if (!updated) {
      return { ok: false, status: 404, body: { error: 'Document not found' } };
    }

    return { ok: true, status: 200, body: updated };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
