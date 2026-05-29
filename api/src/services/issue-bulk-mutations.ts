// Bulk issue archive/delete/restore/update with capability guards and domain validation.
import type { PoolClient } from 'pg';
import type { IssueProperties } from '@ship/shared';
import type { DocumentType } from '@ship/shared';
import { extractIssueFromRow, type IssueDocumentRow } from '../db/documents-repository.js';
import type { DocumentMutationCapability } from '../security/capabilities.js';
import type { Principal } from '../security/principal.js';
import { documentActorFromPrincipal } from '../security/document-actor.js';
import { guardDocumentMutationsBatch } from './mutation-capability-guard.js';
import {
  getTimestampUpdates,
  getBelongsToAssociationsBatch,
  syncAssociationOfTypeForDocuments,
} from '../utils/document-crud.js';
import {
  getDocumentAccessContext,
  requireReferenceableDocument,
  type DocumentActor,
} from './document-access.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { requireFirstRow } from '../utils/query-rows.js';
import { enqueueFleetGraphIssueAttentionEvents } from '../fleetgraph/events.js';
import { issueStateSchema } from '../schemas/document-boundary.js';
import type { z } from 'zod';

type IssueMutationResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: Record<string, unknown> };

type IdRow = { id: string };
type IssuePropertiesRow = {
  id: string;
  properties: IssueProperties | Record<string, unknown> | null;
};
type IncompleteChildRow = {
  id: string;
  title: string;
  ticket_number: number | null;
  state: string | null;
};

export type BulkUpdateIssuesInput = {
  client: PoolClient;
  principal: Principal;
  userId: string;
  workspaceId: string;
  ids: string[];
  action: 'archive' | 'delete' | 'restore' | 'update';
  updates?: {
    state?: z.infer<typeof issueStateSchema>;
    sprint_id?: string | null;
    assignee_id?: string | null;
    project_id?: string | null;
  };
};

function bulkIssueActionGuardSpec(
  action: BulkUpdateIssuesInput['action']
): Omit<DocumentMutationCapability, 'documentId'> & { expectedType: DocumentType } {
  const spec: Omit<DocumentMutationCapability, 'documentId'> & { expectedType: DocumentType } = {
    action: 'write',
    expectedType: 'issue',
  };
  switch (action) {
    case 'delete':
      spec.enforce = 'creator_or_admin';
      spec.includeArchived = true;
      break;
    case 'restore':
      spec.includeArchived = true;
      spec.includeDeleted = true;
      break;
    case 'update':
      spec.includeArchived = true;
      break;
    case 'archive':
      break;
  }
  return spec;
}

function bulkAllGuardFailuresStatus(failed: { id: string; error: string }[]): number {
  if (failed.every((entry) => entry.error === 'Issue not found')) return 404;
  if (failed.every((entry) => entry.error === 'Forbidden' || entry.error === 'token_scope_denied')) {
    return 403;
  }
  return 404;
}

async function applyBulkIssueStateUpdates(
  client: PoolClient,
  actor: DocumentActor,
  workspaceId: string,
  userId: string,
  issueIds: string[],
  newState: z.infer<typeof issueStateSchema>,
  failed: { id: string; error: string }[]
): Promise<string[]> {
  const { isAdmin } = await getDocumentAccessContext(actor, client);
  const isClosing = newState === 'done' || newState === 'cancelled';
  const keptIds: string[] = [];

  for (const id of issueIds) {
    const existing = await client.query<IssuePropertiesRow>(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, workspaceId]
    );
    if (existing.rows.length === 0) {
      failed.push({ id, error: 'Issue not found' });
      continue;
    }

    const currentProps = (requireFirstRow(existing.rows).properties ?? {}) as Partial<IssueProperties>;
    const wasNotClosed = currentProps.state !== 'done' && currentProps.state !== 'cancelled';

    if (isClosing && wasNotClosed) {
      const childrenResult = await client.query<IncompleteChildRow>(
        `SELECT d.id, d.title, d.ticket_number, d.properties->>'state' as state
         FROM documents d
         JOIN document_associations da ON da.document_id = d.id
         WHERE da.related_id = $1
           AND da.relationship_type = 'parent'
           AND d.workspace_id = $2
           AND d.document_type = 'issue'
           AND d.archived_at IS NULL
           AND d.deleted_at IS NULL
           AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
        [id, workspaceId, userId, isAdmin]
      );
      const incompleteChildren = childrenResult.rows.filter(
        (child) => child.state !== 'done' && child.state !== 'cancelled'
      );
      if (incompleteChildren.length > 0) {
        failed.push({ id, error: 'incomplete_children' });
        continue;
      }
    }

    const newProps = { ...currentProps, state: newState };
    const timestampUpdates = getTimestampUpdates(currentProps.state || null, newState);
    const setParts = ['properties = $1', 'updated_at = NOW()'];
    const values: unknown[] = [JSON.stringify(newProps)];
    for (const [column, expression] of Object.entries(timestampUpdates)) {
      setParts.push(`${column} = ${expression}`);
    }
    values.push(id, workspaceId);
    await client.query(
      `UPDATE documents SET ${setParts.join(', ')}
       WHERE id = $${values.length - 1} AND workspace_id = $${values.length}`,
      values
    );
    keptIds.push(id);
  }

  return keptIds;
}

async function filterIdsWithEstimateForSprintAssignment(
  client: PoolClient,
  workspaceId: string,
  targetIds: string[],
  failed: { id: string; error: string }[]
): Promise<string[]> {
  const missingEstimateResult = await client.query<IdRow>(
    `SELECT id FROM documents
     WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'issue'
       AND NOT (
         properties ? 'estimate'
         AND jsonb_typeof(properties->'estimate') = 'number'
         AND (properties->>'estimate')::numeric > 0
       )`,
    [targetIds, workspaceId]
  );
  const missingEstimateIds = new Set(missingEstimateResult.rows.map((row) => row.id));
  for (const id of targetIds) {
    if (missingEstimateIds.has(id)) {
      failed.push({ id, error: 'estimate_required_for_sprint_assignment' });
    }
  }
  return targetIds.filter((id) => !missingEstimateIds.has(id));
}

async function applyBulkIssueScalarUpdates(
  client: PoolClient,
  workspaceId: string,
  targetIds: string[],
  updates: NonNullable<BulkUpdateIssuesInput['updates']>
): Promise<{ rows: IssueDocumentRow[] }> {
  if (updates.assignee_id !== undefined) {
    return client.query<IssueDocumentRow>(
      `UPDATE documents SET
         updated_at = NOW(),
         properties = jsonb_set(COALESCE(properties, '{}'), '{assignee_id}', $3::jsonb)
       WHERE id = ANY($1) AND workspace_id = $2
       RETURNING *`,
      [
        targetIds,
        workspaceId,
        updates.assignee_id === null ? 'null' : JSON.stringify(updates.assignee_id),
      ]
    );
  }

  if (updates.state !== undefined) {
    return client.query<IssueDocumentRow>(
      `SELECT * FROM documents
       WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'issue'`,
      [targetIds, workspaceId]
    );
  }

  return client.query<IssueDocumentRow>(
    `UPDATE documents SET updated_at = NOW()
     WHERE id = ANY($1) AND workspace_id = $2
     RETURNING *`,
    [targetIds, workspaceId]
  );
}

async function syncBulkIssueAssociations(
  client: PoolClient,
  actor: DocumentActor,
  targetIds: string[],
  updates: NonNullable<BulkUpdateIssuesInput['updates']>
): Promise<{ ok: false; status: number; body: Record<string, unknown> } | null> {
  if (updates.project_id !== undefined) {
    if (updates.project_id !== null) {
      try {
        await requireReferenceableDocument(client, actor, updates.project_id, 'project');
      } catch (error) {
        if (error instanceof Error && error.message === 'DOCUMENT_NOT_READABLE') {
          return { ok: false, status: 404, body: { error: 'Referenced document not found' } };
        }
        throw error;
      }
    }
    await syncAssociationOfTypeForDocuments(targetIds, 'project', updates.project_id, client);
  }

  if (updates.sprint_id !== undefined) {
    if (updates.sprint_id !== null) {
      try {
        await requireReferenceableDocument(client, actor, updates.sprint_id, 'sprint');
      } catch (error) {
        if (error instanceof Error && error.message === 'DOCUMENT_NOT_READABLE') {
          return { ok: false, status: 404, body: { error: 'Referenced document not found' } };
        }
        throw error;
      }
    }
    await syncAssociationOfTypeForDocuments(targetIds, 'sprint', updates.sprint_id, client);
  }

  return null;
}

async function runBulkIssueUpdateAction(
  client: PoolClient,
  actor: DocumentActor,
  workspaceId: string,
  userId: string,
  targetIds: string[],
  updates: NonNullable<BulkUpdateIssuesInput['updates']>,
  failed: { id: string; error: string }[]
): Promise<
  | { ok: true; result: { rows: IssueDocumentRow[] }; failed: { id: string; error: string }[] }
  | { ok: false; status: number; body: Record<string, unknown> }
  | { ok: true; empty: true; failed: { id: string; error: string }[] }
> {
  let ids = [...targetIds];

  if (updates.sprint_id !== undefined && updates.sprint_id !== null) {
    ids = await filterIdsWithEstimateForSprintAssignment(client, workspaceId, ids, failed);
    if (ids.length === 0) {
      return { ok: true, empty: true, failed };
    }
  }

  if (updates.state !== undefined) {
    ids = await applyBulkIssueStateUpdates(client, actor, workspaceId, userId, ids, updates.state, failed);
    if (ids.length === 0) {
      return { ok: true, empty: true, failed };
    }
  }

  const result = await applyBulkIssueScalarUpdates(client, workspaceId, ids, updates);

  const associationError = await syncBulkIssueAssociations(client, actor, ids, updates);
  if (associationError) {
    return associationError;
  }

  return { ok: true, result, failed };
}

export async function bulkUpdateIssuesMutation(
  input: BulkUpdateIssuesInput
): Promise<IssueMutationResult<{ updated: Record<string, unknown>[]; failed: { id: string; error: string }[] }>> {
  const { client, principal, workspaceId, userId, ids, action, updates } = input;
  const actor = documentActorFromPrincipal(principal);

  const failed: { id: string; error: string }[] = [];
  const validIds: string[] = [];

  const guardResults = await guardDocumentMutationsBatch(
    client,
    principal,
    ids,
    bulkIssueActionGuardSpec(action),
    { notFoundMessage: 'Issue not found' }
  );
  for (const result of guardResults) {
    if (!result.ok) {
      failed.push({ id: result.id, error: result.body.error });
      continue;
    }
    validIds.push(result.id);
  }

  await client.query('BEGIN');

  if (validIds.length === 0) {
    await client.query('ROLLBACK');
    return {
      ok: false,
      status: bulkAllGuardFailuresStatus(failed),
      body: { error: 'No valid issues found', failed },
    };
  }

  let targetIds = [...validIds];
  let result: { rows: IssueDocumentRow[] };

  switch (action) {
    case 'archive':
      result = await client.query<IssueDocumentRow>(
        `UPDATE documents SET archived_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1) AND workspace_id = $2
         RETURNING *`,
        [validIds, workspaceId]
      );
      break;

    case 'delete': {
      const systemGeneratedResult = await client.query<IdRow>(
        `SELECT id FROM documents
         WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'issue'
           AND properties->>'is_system_generated' = 'true'`,
        [targetIds, workspaceId]
      );
      const blockedIds = new Set(systemGeneratedResult.rows.map((row) => row.id));
      for (const id of targetIds) {
        if (blockedIds.has(id)) {
          failed.push({ id, error: 'Cannot delete system-generated accountability issues' });
        }
      }
      targetIds = targetIds.filter((id) => !blockedIds.has(id));
      if (targetIds.length === 0) {
        await client.query('COMMIT');
        return { ok: true, status: 200, body: { updated: [], failed } };
      }
      result = await client.query<IssueDocumentRow>(
        `UPDATE documents SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1) AND workspace_id = $2
         RETURNING *`,
        [targetIds, workspaceId]
      );
      break;
    }

    case 'restore':
      result = await client.query<IssueDocumentRow>(
        `UPDATE documents SET archived_at = NULL, deleted_at = NULL, updated_at = NOW()
         WHERE id = ANY($1) AND workspace_id = $2
         RETURNING *`,
        [validIds, workspaceId]
      );
      break;

    case 'update':
      if (!updates || Object.keys(updates).length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 400, body: { error: 'Updates required for update action' } };
      }

      {
        const updateOutcome = await runBulkIssueUpdateAction(
          client,
          actor,
          workspaceId,
          userId,
          targetIds,
          updates,
          failed
        );
        if (!updateOutcome.ok) {
          await client.query('ROLLBACK');
          return updateOutcome;
        }
        if ('empty' in updateOutcome) {
          await client.query('COMMIT');
          return { ok: true, status: 200, body: { updated: [], failed: updateOutcome.failed } };
        }
        result = updateOutcome.result;
      }
      break;

    default:
      await client.query('ROLLBACK');
      return { ok: false, status: 400, body: { error: 'Invalid action' } };
  }

  await client.query('COMMIT');

  await enqueueFleetGraphIssueAttentionEvents({
    workspaceId,
    issueIds: result.rows.map((row) => row.id),
    eventType: updates?.sprint_id !== undefined ? 'issue_week_changed' : 'issue_changed',
    reason: `bulk_issue_${action}`,
  });

  const associationsMap = await getBelongsToAssociationsBatch(result.rows.map((row) => row.id));
  const updated = result.rows.map((row) => {
    const issue = extractIssueFromRow(row);
    return {
      ...issue,
      display_id: `#${issue.ticket_number}`,
      archived_at: row.archived_at,
      deleted_at: row.deleted_at,
      belongs_to: associationsMap.get(row.id) ?? [],
    };
  });

  return { ok: true, status: 200, body: { updated, failed } };
}
