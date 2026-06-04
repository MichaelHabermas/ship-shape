// Document delete service owns soft deletion and post-delete side effects.
import { pool } from '../../db/client.js';
import {
  commitDomainWebhooks,
  publishDomainWebhookInTransaction,
} from '../../platform/webhooks/mutation-publisher.js';
import {
  creatorWriteCapability,
  guardMutationCapability,
  loadAccessibleDocument,
} from './shared.js';
import { type DeleteDocumentInput, type DocumentAccessRow, type MutationResult } from './types.js';
import { buildDocumentDeletedWebhookEvent } from './webhook-events.js';

export async function deleteDocumentMutation({
  actor,
  principal,
  documentId,
}: DeleteDocumentInput): Promise<MutationResult<null>> {
  const denied = await guardMutationCapability(
    pool,
    principal,
    creatorWriteCapability(documentId, true),
  );
  if (denied) return denied;

  const existing = await loadAccessibleDocument(pool, principal, documentId, { includeArchived: true });
  if (!existing) {
    return { ok: false, status: 404, body: { error: 'Document not found' } };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<DocumentAccessRow>(
      `UPDATE documents
       SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [documentId, actor.workspaceId]
    );
    const deleted = result.rows[0];
    if (!deleted?.deleted_at) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, body: { error: 'Document not found' } };
    }

    const webhook = await publishDomainWebhookInTransaction(
      buildDocumentDeletedWebhookEvent({
        workspaceId: actor.workspaceId,
        actorUserId: actor.userId,
        row: deleted,
        deletedAt: deleted.deleted_at,
      }),
      client
    );
    await client.query('COMMIT');
    commitDomainWebhooks(webhook.deliveryIds);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return { ok: true, status: 204, body: null };
}
