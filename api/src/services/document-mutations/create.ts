import { pool } from '../../db/client.js';
import { broadcastToUser } from '../../collaboration/index.js';
import {
  addBelongsToAssociation,
  syncBelongsToAssociations,
} from '../../utils/document-crud.js';
import {
  findForbiddenGovernanceKeys,
  findForbiddenRaciKeys,
  formatForbiddenGovernanceKeys,
} from '../../utils/document-governance.js';
import { upsertDocumentSearchIndex } from '../../utils/tiptap-search.js';
import { getDocumentAccessContext, getReadableDocument } from '../document-access.js';
import {
  guardMutationCapability,
  nextIssueTicketNumber,
  validateReferences,
} from './shared.js';
import {
  type CreateDocumentInput,
  type DocumentAccessRow,
  type MutationResult,
} from './types.js';

export async function createDocumentMutation({
  actor,
  principal,
  input,
}: CreateDocumentInput): Promise<MutationResult<DocumentAccessRow>> {
  const denied = await guardMutationCapability(pool, principal, { action: 'write' });
  if (denied) return denied;

  const client = await pool.connect();

  try {
    const { isAdmin } = await getDocumentAccessContext(actor, client);
    const {
      document_type,
      parent_id,
      program_id,
      sprint_id,
      properties,
      content,
      belongs_to,
    } = input;
    let { visibility } = input;

    const forbiddenOnCreate = findForbiddenGovernanceKeys(properties);
    if (forbiddenOnCreate.length > 0) {
      return {
        ok: false,
        status: 403,
        body: { error: `Cannot set governance fields via this endpoint: ${formatForbiddenGovernanceKeys(forbiddenOnCreate)}` },
      };
    }

    const forbiddenRaciOnCreate = isAdmin ? [] : findForbiddenRaciKeys(properties);
    if (forbiddenRaciOnCreate.length > 0) {
      return {
        ok: false,
        status: 403,
        body: { error: `Cannot set RACI fields via this endpoint: ${forbiddenRaciOnCreate.join(', ')}` },
      };
    }

    if (parent_id && !visibility) {
      const parent = await getReadableDocument(client, actor, parent_id);
      if (!parent) {
        return { ok: false, status: 404, body: { error: 'Parent document not found' } };
      }
      visibility = parent.visibility;
    }

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
    const referencesResult = await validateReferences(client, principal, references);
    if (!referencesResult.ok) {
      return { ok: false, status: 404, body: { error: referencesResult.error } };
    }

    await client.query('BEGIN');

    const ticketNumber = document_type === 'issue'
      ? await nextIssueTicketNumber(client, actor.workspaceId)
      : null;

    const result = await client.query<DocumentAccessRow>(
      `INSERT INTO documents (workspace_id, document_type, title, parent_id, properties, created_by, visibility, content, ticket_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        actor.workspaceId,
        document_type,
        'Untitled',
        parent_id || null,
        JSON.stringify(properties || {}),
        actor.userId,
        visibility || 'workspace',
        content ? JSON.stringify(content) : null,
        ticketNumber,
      ]
    );

    const newDoc = result.rows[0];
    if (!newDoc) {
      await client.query('ROLLBACK');
      return { ok: false, status: 500, body: { error: 'Failed to create document' } };
    }

    if (belongs_to && belongs_to.length > 0) {
      await syncBelongsToAssociations(newDoc.id, belongs_to, client);
    }

    if (sprint_id) {
      await addBelongsToAssociation(newDoc.id, sprint_id, 'sprint', client);
    }

    if (program_id) {
      await addBelongsToAssociation(newDoc.id, program_id, 'program', client);
    }

    await client.query('COMMIT');
    await upsertDocumentSearchIndex(newDoc.id);

    if (document_type === 'weekly_plan' || (properties && 'outcome' in properties)) {
      broadcastToUser(actor.userId, 'accountability:updated', { documentId: newDoc.id, documentType: document_type });
    }

    return { ok: true, status: 201, body: newDoc };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
