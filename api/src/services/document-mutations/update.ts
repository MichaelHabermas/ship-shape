import type { DocumentVisibility } from '@ship/shared';
import { pool } from '../../db/client.js';
import {
  handleVisibilityChange,
  invalidateDocumentCache,
  broadcastToUser,
} from '../../collaboration/index.js';
import {
  addBelongsToAssociation,
  syncBelongsToAssociations,
  updateProgramAssociation,
  updateSprintAssociation,
} from '../../utils/document-crud.js';
import { checkDocumentCompleteness } from '../../utils/extractHypothesis.js';
import { upsertDocumentSearchIndex } from '../../utils/tiptap-search.js';
import {
  findForbiddenGovernanceKeys,
  findForbiddenRaciKeys,
  formatForbiddenGovernanceKeys,
  stripForbiddenGovernanceKeys,
} from '../../utils/document-governance.js';
import { getDocumentAccessContext, getReadableDocument } from '../document-access.js';
import { authorizeDocumentMutation } from '../../security/capabilities.js';
import { enqueueFleetGraphIssueAttentionEvents } from '../../fleetgraph/events.js';
import {
  collectTopLevelProperties,
  defaultWriteCapability,
  extractedContentProperties,
  guardMutationCapability,
  loadAccessibleDocument,
  nextIssueTicketNumber,
  projectOwnerForResponse,
  resetWeeklyApprovalAfterResubmission,
  validateReferences,
} from './shared.js';
import {
  type DocumentAccessRow,
  type MutationResult,
  type PersonOwnerRow,
  type UpdateDocumentInput,
} from './types.js';

function flattenDocumentResponse(updatedDoc: DocumentAccessRow, owner: PersonOwnerRow | null) {
  const props = updatedDoc.properties || {};
  return {
    ...updatedDoc,
    state: props.state,
    priority: props.priority,
    estimate: props.estimate,
    assignee_id: props.assignee_id,
    source: props.source,
    impact: props.impact,
    confidence: props.confidence,
    ease: props.ease,
    owner_id: props.owner_id,
    owner,
    prefix: props.prefix,
    color: props.color,
    status: props.status,
    plan: props.plan,
    plan_approval: props.plan_approval,
    review_approval: props.review_approval,
    review_rating: props.review_rating,
  };
}

export async function updateDocumentMutation({
  actor,
  principal,
  documentId,
  patch,
  capability,
}: UpdateDocumentInput): Promise<MutationResult<ReturnType<typeof flattenDocumentResponse>>> {
  const denied = await guardMutationCapability(
    pool,
    principal,
    capability ?? defaultWriteCapability(documentId),
  );
  if (denied) return denied;

  const client = await pool.connect();
  let contentUpdated = false;
  let visibilityChanged: { next: DocumentVisibility; previousCreatedBy: string } | null = null;
  let resubmissionTarget: { sprintId: string; reviewerUserId: string | null } | null = null;

  try {
    const existing = await loadAccessibleDocument(client, principal, documentId, { includeArchived: true });
    if (!existing) {
      return { ok: false, status: 404, body: { error: 'Document not found' } };
    }

    const { isAdmin } = await getDocumentAccessContext(actor, client);
    const isGovernanceCommand = capability?.action === 'governance';

    const forbiddenGovernanceKeys = isGovernanceCommand
      ? []
      : findForbiddenGovernanceKeys(patch.properties);
    if (forbiddenGovernanceKeys.length > 0) {
      return {
        ok: false,
        status: 403,
        body: { error: `Cannot modify governance fields via this endpoint: ${formatForbiddenGovernanceKeys(forbiddenGovernanceKeys)}` },
      };
    }

    const forbiddenRaciKeys = isAdmin ? [] : findForbiddenRaciKeys(patch.properties);
    if (forbiddenRaciKeys.length > 0) {
      return { ok: false, status: 403, body: { error: `Cannot modify RACI fields via this endpoint: ${forbiddenRaciKeys.join(', ')}` } };
    }

    if (!isAdmin) {
      if (patch.accountable_id !== undefined) {
        return { ok: false, status: 403, body: { error: 'Only workspace admins can change accountable_id' } };
      }
      const topLevelRaciKeys = [
        ...(patch.owner_id !== undefined ? ['owner_id'] : []),
        ...(patch.consulted_ids !== undefined ? ['consulted_ids'] : []),
        ...(patch.informed_ids !== undefined ? ['informed_ids'] : []),
      ];
      if (topLevelRaciKeys.length > 0) {
        return { ok: false, status: 403, body: { error: `Cannot modify RACI fields via this endpoint: ${topLevelRaciKeys.join(', ')}` } };
      }
      if (existing.document_type === 'sprint' && patch.status !== undefined) {
        return { ok: false, status: 403, body: { error: 'Sprint status cannot be changed via this endpoint' } };
      }
      if (existing.document_type === 'sprint' && patch.properties?.status !== undefined) {
        return { ok: false, status: 403, body: { error: 'Sprint status cannot be changed via this endpoint' } };
      }
    }

    const references = [
      ...(patch.parent_id ? [{ id: patch.parent_id, type: 'parent' as const, label: 'Parent document' }] : []),
      ...(patch.program_id ? [{ id: patch.program_id, type: 'program' as const, label: 'Program' }] : []),
      ...(patch.sprint_id ? [{ id: patch.sprint_id, type: 'sprint' as const, label: 'Sprint' }] : []),
      ...((patch.belongs_to || []).map((association) => ({
        id: association.id,
        type: association.type,
        label: `${association.type} document`,
      }))),
    ];
    const referencesResult = await validateReferences(client, principal, references);
    if (!referencesResult.ok) {
      return { ok: false, status: 404, body: { error: referencesResult.error } };
    }

    if (patch.visibility !== undefined && patch.visibility !== existing.visibility) {
      const visibilityDecision = await authorizeDocumentMutation(client, principal, {
        action: 'write',
        documentId,
        enforce: 'creator_or_admin',
        includeArchived: true,
      });
      if (!visibilityDecision.allowed) {
        return { ok: false, status: 403, body: { error: 'Only the creator or admin can change document visibility' } };
      }
    }

    if (patch.parent_id !== undefined && patch.parent_id !== null && patch.visibility === undefined) {
      const parent = await getReadableDocument(client, actor, patch.parent_id);
      if (parent?.visibility === 'workspace' && existing.visibility === 'private') {
        patch.visibility = 'workspace';
      }
    }

    if (existing.document_type === 'person' && patch.properties?.reports_to !== undefined) {
      const adminDecision = await authorizeDocumentMutation(client, principal, {
        action: 'governance',
        documentId,
        enforce: 'workspace_admin',
        includeArchived: true,
      });
      if (!adminDecision.allowed) {
        return { ok: false, status: 403, body: { error: 'Only workspace admins can set the reports_to field' } };
      }
    }

    await client.query('BEGIN');

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    let extractedProps: Record<string, unknown> = {};

    if (patch.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(patch.title);
    }
    if (patch.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(JSON.stringify(patch.content));
      updates.push('yjs_state = NULL');
      extractedProps = extractedContentProperties(patch.content);
      contentUpdated = true;
    }
    if (patch.parent_id !== undefined) {
      updates.push(`parent_id = $${paramIndex++}`);
      values.push(patch.parent_id);
    }
    if (patch.position !== undefined) {
      updates.push(`position = $${paramIndex++}`);
      values.push(patch.position);
    }

    const topLevelProps = collectTopLevelProperties(patch, existing.document_type);
    const hasTopLevelProps = Object.keys(topLevelProps).length > 0;
    if (patch.properties !== undefined || contentUpdated || hasTopLevelProps) {
      const dataProps = patch.properties || {};
      let newProps = {
        ...(existing.properties || {}),
        ...dataProps,
        ...topLevelProps,
        ...(contentUpdated ? extractedProps : {}),
      };
      if (!isGovernanceCommand) {
        newProps = stripForbiddenGovernanceKeys(newProps);
      }

      if (existing.document_type === 'project' || existing.document_type === 'sprint') {
        let linkedIssuesCount = 0;
        if (existing.document_type === 'sprint') {
          const issueCountResult = await client.query<{ count: string }>(
            `SELECT COUNT(*) as count FROM documents d
             JOIN document_associations da ON da.document_id = d.id
             WHERE da.related_id = $1 AND da.relationship_type = 'sprint' AND d.document_type = $2`,
            [documentId, 'issue']
          );
          linkedIssuesCount = parseInt(issueCountResult.rows[0]?.count || '0', 10);
        }

        const completeness = checkDocumentCompleteness(existing.document_type, newProps, linkedIssuesCount);
        newProps = {
          ...newProps,
          is_complete: completeness.isComplete,
          missing_fields: completeness.missingFields,
        };
      }

      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }
    if (patch.visibility !== undefined) {
      updates.push(`visibility = $${paramIndex++}`);
      values.push(patch.visibility);
    }

    if (patch.document_type !== undefined && patch.document_type !== existing.document_type) {
      const convertDecision = await authorizeDocumentMutation(client, principal, {
        action: 'write',
        documentId,
        enforce: 'creator_or_admin',
        includeArchived: true,
      });
      if (!convertDecision.allowed) {
        await client.query('ROLLBACK');
        return { ok: false, status: 403, body: { error: 'Only the document creator can change its type' } };
      }

      const restrictedTypes = ['program', 'person'];
      if (restrictedTypes.includes(existing.document_type) || restrictedTypes.includes(patch.document_type)) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, body: { error: 'Cannot change to or from program or person document types' } };
      }

      updates.push(`document_type = $${paramIndex++}`);
      values.push(patch.document_type);

      if (patch.document_type === 'issue' && !existing.ticket_number) {
        updates.push(`ticket_number = $${paramIndex++}`);
        values.push(await nextIssueTicketNumber(client, actor.workspaceId));
      }
    }

    const hasBelongsToUpdate = patch.belongs_to !== undefined;
    const hasProgramIdUpdate = patch.program_id !== undefined;
    const hasSprintIdUpdate = patch.sprint_id !== undefined;
    if (hasBelongsToUpdate && (hasProgramIdUpdate || hasSprintIdUpdate)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        body: { error: 'Use either belongs_to or program_id/sprint_id association fields, not both' },
      };
    }
    if (updates.length === 0 && !hasBelongsToUpdate && !hasProgramIdUpdate && !hasSprintIdUpdate) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, body: { error: 'No fields to update' } };
    }

    if (hasBelongsToUpdate) {
      await syncBelongsToAssociations(documentId, patch.belongs_to || [], client);
    }
    if (patch.sprint_id !== undefined && !hasBelongsToUpdate) {
      await updateSprintAssociation(documentId, null, client);
      if (patch.sprint_id !== null) {
        await addBelongsToAssociation(documentId, patch.sprint_id, 'sprint', client);
      }
    }
    if (patch.program_id !== undefined && !hasBelongsToUpdate) {
      await updateProgramAssociation(documentId, null, client);
      if (patch.program_id !== null) {
        await addBelongsToAssociation(documentId, patch.program_id, 'program', client);
      }
    }

    updates.push('updated_at = now()');
    const result = await client.query<DocumentAccessRow>(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} RETURNING *`,
      [...values, documentId, actor.workspaceId]
    );

    if (contentUpdated) {
      resubmissionTarget = await resetWeeklyApprovalAfterResubmission(client, actor, existing);
    }

    if (patch.visibility !== undefined && patch.visibility !== existing.visibility) {
      await client.query(
        `WITH RECURSIVE descendants AS (
          SELECT id FROM documents WHERE parent_id = $1
          UNION ALL
          SELECT d.id FROM documents d
          INNER JOIN descendants descendant ON d.parent_id = descendant.id
        )
        UPDATE documents SET visibility = $2, updated_at = now()
        WHERE id IN (SELECT id FROM descendants)`,
        [documentId, patch.visibility]
      );
      visibilityChanged = { next: patch.visibility, previousCreatedBy: existing.created_by };
    }

    if (visibilityChanged && existing.document_type === 'issue') {
      await enqueueFleetGraphIssueAttentionEvents({
        workspaceId: actor.workspaceId,
        issueIds: [documentId],
        eventType: 'issue_visibility_changed',
        reason: 'issue_visibility_changed',
        db: client,
        logger: console,
      });
    }

    await client.query('COMMIT');
    await upsertDocumentSearchIndex(documentId);

    if (contentUpdated) {
      invalidateDocumentCache(documentId);
    }

    if (visibilityChanged) {
      handleVisibilityChange(documentId, visibilityChanged.next, visibilityChanged.previousCreatedBy).catch((err) => {
        console.error('Failed to handle visibility change for collaboration:', err);
      });
    }

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

    const updatedDoc = result.rows[0];
    if (!updatedDoc) {
      return { ok: false, status: 404, body: { error: 'Document not found' } };
    }
    const owner = updatedDoc.document_type === 'project'
      ? await projectOwnerForResponse(updatedDoc.properties?.owner_id, actor.workspaceId)
      : null;

    return { ok: true, status: 200, body: flattenDocumentResponse(updatedDoc, owner) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
