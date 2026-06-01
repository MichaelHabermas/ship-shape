import { pool } from '../../db/client.js';
import {
  creatorWriteCapability,
  guardMutationCapability,
  loadAccessibleDocument,
} from './shared.js';
import { type DeleteDocumentInput, type MutationResult } from './types.js';

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

  const result = await pool.query<{ id: string }>(
    `UPDATE documents
     SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [documentId, actor.workspaceId]
  );

  if (result.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Document not found' } };
  }

  return { ok: true, status: 204, body: null };
}
