import type { Pool, PoolClient } from 'pg';
import type { BelongsTo, IssueProperties } from '@ship/shared';
import { pool } from '../db/client.js';
import { extractIssueFromRow, type IssueDocumentRow } from '../db/documents-repository.js';
import { VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import {
  logDocumentChange,
  getTimestampUpdates,
  getBelongsToAssociations,
  syncBelongsToAssociations,
  syncAssociationOfTypeForDocuments,
} from '../utils/document-crud.js';
import { broadcastToUser } from '../collaboration/index.js';
import {
  expectedTypeForRelationship,
  requireReferenceableDocument,
  type DocumentActor,
} from './document-access.js';
import {
  mapListedIssueIterationRow,
  mapStoredIssueIterationRow,
  type IssueIterationAuthorRow,
  type IssueIterationListRow,
  type IssueStoredIterationRow,
} from '../utils/issue-response.js';
import { requireFirstRow } from '../utils/query-rows.js';
import {
  issueStateSchema,
  type createIssueRequestSchema,
  type updateIssueRequestSchema,
} from '../schemas/document-boundary.js';
import type { z } from 'zod';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type IssueMutationResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: Record<string, unknown> };

type TicketNumberRow = { next_number: number };
type CountRow = { count: string | number };
type IdRow = { id: string };
type IssueTitlePropertiesRow = {
  id: string;
  title: string;
  properties: IssueProperties | Record<string, unknown> | null;
};
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
type OldSprintRow = {
  sprint_number: string | null;
  sprint_start_date: Date | string | null;
};

export type CreateIssueInput = {
  client: PoolClient;
  actor: DocumentActor;
  userId: string;
  workspaceId: string;
  data: z.infer<typeof createIssueRequestSchema>;
};

export type UpdateIssueInput = {
  client: PoolClient;
  actor: DocumentActor;
  userId: string;
  workspaceId: string;
  isAdmin: boolean;
  issueId: string;
  data: z.infer<typeof updateIssueRequestSchema>;
};

export type BulkUpdateIssuesInput = {
  client: PoolClient;
  userId: string;
  workspaceId: string;
  isAdmin: boolean;
  ids: string[];
  action: 'archive' | 'delete' | 'restore' | 'update';
  updates?: {
    state?: z.infer<typeof issueStateSchema>;
    sprint_id?: string | null;
    assignee_id?: string | null;
    project_id?: string | null;
  };
};

function toCount(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

async function workspaceAdvisoryLock(client: PoolClient, workspaceId: string): Promise<void> {
  const workspaceIdHex = workspaceId.replace(/-/g, '').substring(0, 15);
  const lockKey = parseInt(workspaceIdHex, 16);
  await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
}

export async function createIssueMutation(
  input: CreateIssueInput
): Promise<IssueMutationResult<Record<string, unknown>>> {
  const { client, actor, userId, workspaceId, data } = input;
  const {
    title,
    state,
    priority,
    assignee_id,
    belongs_to,
    source,
    due_date,
    is_system_generated,
    accountability_target_id,
    accountability_type,
  } = data;

  await client.query('BEGIN');
  await workspaceAdvisoryLock(client, workspaceId);

  const ticketResult = await client.query<TicketNumberRow>(
    `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
     FROM documents
     WHERE workspace_id = $1 AND document_type = 'issue'`,
    [workspaceId]
  );
  const ticketNumber = requireFirstRow(ticketResult.rows).next_number;

  const properties = {
    state: state || 'backlog',
    priority: priority || 'medium',
    source: source || 'internal',
    assignee_id: assignee_id || null,
    rejection_reason: null,
    due_date: due_date || null,
    is_system_generated: is_system_generated || false,
    accountability_target_id: accountability_target_id || null,
    accountability_type: accountability_type || null,
  };

  const result = await client.query<IssueDocumentRow>(
    `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, created_by)
     VALUES ($1, 'issue', $2, $3, $4, $5)
     RETURNING *`,
    [workspaceId, title, JSON.stringify(properties), ticketNumber, userId]
  );

  const newIssueId = requireFirstRow(result.rows).id;

  for (const assoc of belongs_to) {
    try {
      await requireReferenceableDocument(
        client,
        actor,
        assoc.id,
        expectedTypeForRelationship(assoc.type)
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'DOCUMENT_NOT_READABLE') {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, body: { error: 'Referenced document not found' } };
      }
      throw error;
    }
  }

  await syncBelongsToAssociations(
    newIssueId,
    belongs_to.map((assoc) => ({ id: assoc.id, type: assoc.type })),
    client
  );

  await client.query('COMMIT');

  const sprintAssociations = belongs_to.filter((bt) => bt.type === 'sprint');
  for (const sprintAssoc of sprintAssociations) {
    const issueCountResult = await pool.query<CountRow>(
      `SELECT COUNT(*) as count FROM document_associations
       WHERE related_id = $1 AND relationship_type = 'sprint'`,
      [sprintAssoc.id]
    );
    const issueCount = toCount(requireFirstRow(issueCountResult.rows).count);
    if (issueCount === 1) {
      broadcastToUser(userId, 'accountability:updated', { type: 'week_issues', targetId: sprintAssoc.id });
    }
  }

  const belongsToResult = await getBelongsToAssociations(newIssueId);
  const row = requireFirstRow(result.rows);
  const issue = extractIssueFromRow(row);
  return {
    ok: true,
    status: 201,
    body: {
      ...issue,
      display_id: `#${ticketNumber}`,
      belongs_to: belongsToResult,
    },
  };
}

export async function updateIssueMutation(
  input: UpdateIssueInput
): Promise<IssueMutationResult<Record<string, unknown>>> {
  const { client, actor, userId, workspaceId, isAdmin, issueId: id, data } = input;

  const existing = await client.query<IssueTitlePropertiesRow>(
    `SELECT id, title, properties
     FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [id, workspaceId, userId, isAdmin]
  );

  if (existing.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Issue not found' } };
  }

  const existingIssue = requireFirstRow(existing.rows);
  const currentProps = (existingIssue.properties ?? {}) as Partial<IssueProperties>;
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.belongs_to) {
    const hasSprintAssociation = data.belongs_to.some((bt) => bt.type === 'sprint');
    if (hasSprintAssociation) {
      const effectiveEstimate = data.estimate !== undefined ? data.estimate : currentProps.estimate;
      if (!effectiveEstimate) {
        return { ok: false, status: 400, body: { error: 'Estimate is required before assigning to a week' } };
      }
    }
  }

  const isClosingIssue = data.state && (data.state === 'done' || data.state === 'cancelled');
  const wasNotClosed = currentProps.state !== 'done' && currentProps.state !== 'cancelled';

  if (isClosingIssue && wasNotClosed) {
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

    if (incompleteChildren.length > 0 && !data.confirm_orphan_children) {
      return {
        ok: false,
        status: 409,
        body: {
          error: 'incomplete_children',
          message: `This issue has ${incompleteChildren.length} incomplete sub-issue(s). Closing it will remove their parent association.`,
          incomplete_children: incompleteChildren.map((child) => ({
            id: child.id,
            title: child.title,
            ticket_number: child.ticket_number,
            state: child.state,
          })),
          confirm_action: 'Set confirm_orphan_children: true to proceed',
        },
      };
    }

    if (incompleteChildren.length > 0 && data.confirm_orphan_children) {
      await client.query(
        `DELETE FROM document_associations
         WHERE related_id = $1
           AND relationship_type = 'parent'`,
        [id]
      );
    }
  }

  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];

  if (data.title !== undefined && data.title !== existingIssue.title) {
    updates.push(`title = $${paramIndex++}`);
    values.push(data.title);
    changes.push({ field: 'title', oldValue: existingIssue.title, newValue: data.title });
  }

  const newProps = { ...currentProps };
  let propsChanged = false;

  if (data.state !== undefined && data.state !== currentProps.state) {
    changes.push({ field: 'state', oldValue: currentProps.state || null, newValue: data.state });
    newProps.state = data.state;
    propsChanged = true;
    const timestampUpdates = getTimestampUpdates(currentProps.state || null, data.state);
    for (const [col, expr] of Object.entries(timestampUpdates)) {
      updates.push(`${col} = ${expr}`);
    }
  }
  if (data.priority !== undefined && data.priority !== currentProps.priority) {
    changes.push({ field: 'priority', oldValue: currentProps.priority || null, newValue: data.priority });
    newProps.priority = data.priority;
    propsChanged = true;
  }
  if (data.assignee_id !== undefined && data.assignee_id !== currentProps.assignee_id) {
    changes.push({ field: 'assignee_id', oldValue: currentProps.assignee_id || null, newValue: data.assignee_id });
    newProps.assignee_id = data.assignee_id;
    propsChanged = true;
  }
  if (data.estimate !== undefined && data.estimate !== currentProps.estimate) {
    changes.push({
      field: 'estimate',
      oldValue: currentProps.estimate?.toString() || null,
      newValue: data.estimate?.toString() || null,
    });
    newProps.estimate = data.estimate;
    propsChanged = true;
  }

  if (data.claude_metadata) {
    newProps.claude_metadata = {
      ...data.claude_metadata,
      updated_at: new Date().toISOString(),
    };
    propsChanged = true;
  }

  let propsValueIndex = -1;
  if (propsChanged) {
    updates.push(`properties = $${paramIndex++}`);
    propsValueIndex = values.length;
    values.push(JSON.stringify(newProps));
  }

  let belongsToChanged = false;
  let oldBelongsTo: BelongsTo[] = [];
  let newBelongsTo: BelongsTo[] = [];

  if (data.belongs_to !== undefined) {
    oldBelongsTo = await getBelongsToAssociations(id);
    newBelongsTo = data.belongs_to;

    const oldIds = oldBelongsTo.map((bt) => `${bt.type}:${bt.id}`).sort().join(',');
    const newIds = newBelongsTo.map((bt) => `${bt.type}:${bt.id}`).sort().join(',');

    if (oldIds !== newIds) {
      belongsToChanged = true;

      const oldSprintAssoc = oldBelongsTo.find((bt) => bt.type === 'sprint');
      const newSprintAssoc = newBelongsTo.find((bt) => bt.type === 'sprint');

      if (oldSprintAssoc && newSprintAssoc && oldSprintAssoc.id !== newSprintAssoc.id && currentProps.state !== 'done') {
        const oldSprintResult = await client.query<OldSprintRow>(
          `SELECT properties->>'sprint_number' as sprint_number, w.sprint_start_date
           FROM documents d
           JOIN workspaces w ON d.workspace_id = w.id
           WHERE d.id = $1 AND d.document_type = 'sprint'`,
          [oldSprintAssoc.id]
        );

        if (oldSprintResult.rows.length > 0) {
          const oldSprint = requireFirstRow(oldSprintResult.rows);
          const sprintNumber = parseInt(oldSprint.sprint_number ?? '', 10);
          const rawStartDate = oldSprint.sprint_start_date;
          const sprintDuration = 7;

          let startDate: Date;
          if (rawStartDate instanceof Date) {
            startDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
          } else if (typeof rawStartDate === 'string') {
            startDate = new Date(rawStartDate + 'T00:00:00Z');
          } else {
            startDate = new Date();
          }

          const sprintEndDate = new Date(startDate);
          sprintEndDate.setUTCDate(sprintEndDate.getUTCDate() + sprintNumber * sprintDuration - 1);

          if (new Date() > sprintEndDate) {
            newProps.carryover_from_sprint_id = oldSprintAssoc.id;
            propsChanged = true;
          }
        }
      } else if (oldSprintAssoc && !newSprintAssoc) {
        delete newProps.carryover_from_sprint_id;
        propsChanged = true;
      }

      changes.push({
        field: 'belongs_to',
        oldValue: JSON.stringify(oldBelongsTo.map((bt) => ({ id: bt.id, type: bt.type }))),
        newValue: JSON.stringify(newBelongsTo.map((bt) => ({ id: bt.id, type: bt.type }))),
      });
    }
  }

  if (propsChanged && propsValueIndex === -1) {
    updates.push(`properties = $${paramIndex++}`);
    propsValueIndex = values.length;
    values.push(JSON.stringify(newProps));
  } else if (propsChanged && propsValueIndex >= 0) {
    values[propsValueIndex] = JSON.stringify(newProps);
  }

  if (updates.length === 0 && !belongsToChanged) {
    return { ok: false, status: 400, body: { error: 'No fields to update' } };
  }

  await client.query('BEGIN');

  const automatedBy = data.claude_metadata?.updated_by;
  for (const change of changes) {
    await logDocumentChange(id, change.field, change.oldValue, change.newValue, userId, automatedBy, client);
  }

  if (updates.length > 0) {
    updates.push(`updated_at = now()`);
    await client.query(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1}`,
      [...values, id, workspaceId]
    );
  }

  if (belongsToChanged) {
    for (const assoc of newBelongsTo) {
      try {
        await requireReferenceableDocument(
          client,
          actor,
          assoc.id,
          expectedTypeForRelationship(assoc.type)
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'DOCUMENT_NOT_READABLE') {
          await client.query('ROLLBACK');
          return { ok: false, status: 404, body: { error: 'Referenced document not found' } };
        }
        throw error;
      }
    }

    await syncBelongsToAssociations(
      id,
      newBelongsTo.map((assoc) => ({ id: assoc.id, type: assoc.type })),
      client
    );
  }

  const result = await client.query<IssueDocumentRow>(
    `SELECT * FROM documents WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );

  await client.query('COMMIT');

  if (belongsToChanged) {
    const oldSprintIds = oldBelongsTo.filter((bt) => bt.type === 'sprint').map((bt) => bt.id);
    const newSprintIds = newBelongsTo.filter((bt) => bt.type === 'sprint').map((bt) => bt.id);
    const addedSprintIds = newSprintIds.filter((sprintId) => !oldSprintIds.includes(sprintId));

    for (const sprintId of addedSprintIds) {
      const issueCountResult = await pool.query<CountRow>(
        `SELECT COUNT(*) as count FROM document_associations
         WHERE related_id = $1 AND relationship_type = 'sprint'`,
        [sprintId]
      );
      const issueCount = toCount(requireFirstRow(issueCountResult.rows).count);
      if (issueCount === 1) {
        broadcastToUser(userId, 'accountability:updated', { type: 'week_issues', targetId: sprintId });
      }
    }
  }

  const row = requireFirstRow(result.rows);
  const issue = extractIssueFromRow(row);
  const belongsTo = await getBelongsToAssociations(id);

  if (isClosingIssue && wasNotClosed) {
    const props = (row.properties ?? {}) as Partial<IssueProperties>;
    if (props.source === 'action_items') {
      const assigneeId = props.assignee_id || userId;
      broadcastToUser(assigneeId, 'accountability:updated', { issueId: id, state: data.state });
    }
  }

  return {
    ok: true,
    status: 200,
    body: { ...issue, display_id: `#${row.ticket_number}`, belongs_to: belongsTo },
  };
}

export async function bulkUpdateIssuesMutation(
  input: BulkUpdateIssuesInput
): Promise<IssueMutationResult<{ updated: Record<string, unknown>[]; failed: { id: string; error: string }[] }>> {
  const { client, userId, workspaceId, isAdmin, ids, action, updates } = input;

  await client.query('BEGIN');

  const accessCheck = await client.query<IdRow>(
    `SELECT id FROM documents
     WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [ids, workspaceId, userId, isAdmin]
  );

  const accessibleIds = new Set(accessCheck.rows.map((r) => r.id));
  const failed: { id: string; error: string }[] = [];

  for (const id of ids) {
    if (!accessibleIds.has(id)) {
      failed.push({ id, error: 'Not found or no access' });
    }
  }

  const validIds = ids.filter((id) => accessibleIds.has(id));

  if (validIds.length === 0) {
    await client.query('ROLLBACK');
    return { ok: false, status: 404, body: { error: 'No valid issues found', failed } };
  }

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

    case 'delete':
      result = await client.query<IssueDocumentRow>(
        `UPDATE documents SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1) AND workspace_id = $2
         RETURNING *`,
        [validIds, workspaceId]
      );
      break;

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

      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [validIds, workspaceId];
      let paramIdx = 3;

      if (updates.state !== undefined) {
        setClauses.push(`properties = jsonb_set(COALESCE(properties, '{}'), '{state}', $${paramIdx}::jsonb)`);
        values.push(JSON.stringify(updates.state));
        paramIdx++;
      }

      if (updates.assignee_id !== undefined) {
        setClauses.push(`properties = jsonb_set(COALESCE(properties, '{}'), '{assignee_id}', $${paramIdx}::jsonb)`);
        values.push(updates.assignee_id === null ? 'null' : JSON.stringify(updates.assignee_id));
        paramIdx++;
      }

      result = await client.query<IssueDocumentRow>(
        `UPDATE documents SET ${setClauses.join(', ')}
         WHERE id = ANY($1) AND workspace_id = $2
         RETURNING *`,
        values
      );

      if (updates.project_id !== undefined) {
        let projectId: string | null = updates.project_id;
        if (projectId !== null) {
          const projectCheck = await client.query<IdRow>(
            `SELECT id FROM documents
             WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
               AND deleted_at IS NULL`,
            [projectId, workspaceId]
          );
          if (projectCheck.rows.length === 0) {
            projectId = null;
          }
        }
        await syncAssociationOfTypeForDocuments(validIds, 'project', projectId, client);
      }

      if (updates.sprint_id !== undefined) {
        let sprintId: string | null = updates.sprint_id;
        if (sprintId !== null) {
          const sprintCheck = await client.query<IdRow>(
            `SELECT id FROM documents
             WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
               AND deleted_at IS NULL`,
            [sprintId, workspaceId]
          );
          if (sprintCheck.rows.length === 0) {
            sprintId = null;
          }
        }
        await syncAssociationOfTypeForDocuments(validIds, 'sprint', sprintId, client);
      }
      break;

    default:
      await client.query('ROLLBACK');
      return { ok: false, status: 400, body: { error: 'Invalid action' } };
  }

  await client.query('COMMIT');

  const updated = result.rows.map((row) => {
    const issue = extractIssueFromRow(row);
    return {
      ...issue,
      display_id: `#${issue.ticket_number}`,
      archived_at: row.archived_at,
      deleted_at: row.deleted_at,
    };
  });

  return { ok: true, status: 200, body: { updated, failed } };
}

export async function acceptIssueMutation(input: {
  issueId: string;
  userId: string;
  workspaceId: string;
  isAdmin: boolean;
}): Promise<IssueMutationResult<Record<string, unknown>>> {
  const { issueId: id, userId, workspaceId, isAdmin } = input;

  const existing = await pool.query<IssuePropertiesRow>(
    `SELECT id, properties FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [id, workspaceId, userId, isAdmin]
  );

  if (existing.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Issue not found' } };
  }

  const props = (requireFirstRow(existing.rows).properties ?? {}) as Partial<IssueProperties>;
  if (props.state !== 'triage') {
    return { ok: false, status: 400, body: { error: 'Issue must be in triage state to be accepted' } };
  }

  const newProps = { ...props, state: 'backlog' as const };
  const result = await pool.query<IssueDocumentRow>(
    `UPDATE documents
     SET properties = $3, updated_at = now()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *`,
    [id, workspaceId, JSON.stringify(newProps)]
  );

  await logDocumentChange(id, 'state', 'triage', 'backlog', userId);
  const issue = extractIssueFromRow(requireFirstRow(result.rows));
  return { ok: true, status: 200, body: { ...issue, display_id: `#${issue.ticket_number}` } };
}

export async function rejectIssueMutation(input: {
  issueId: string;
  userId: string;
  workspaceId: string;
  isAdmin: boolean;
  reason: string;
}): Promise<IssueMutationResult<Record<string, unknown>>> {
  const { issueId: id, userId, workspaceId, isAdmin, reason } = input;

  const existing = await pool.query<IssuePropertiesRow>(
    `SELECT id, properties FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [id, workspaceId, userId, isAdmin]
  );

  if (existing.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Issue not found' } };
  }

  const props = (requireFirstRow(existing.rows).properties ?? {}) as Partial<IssueProperties>;
  if (props.state !== 'triage') {
    return { ok: false, status: 400, body: { error: 'Issue must be in triage state to be rejected' } };
  }

  const newProps = { ...props, state: 'cancelled' as const, rejection_reason: reason };
  const result = await pool.query<IssueDocumentRow>(
    `UPDATE documents
     SET properties = $3, cancelled_at = NOW(), updated_at = now()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *`,
    [id, workspaceId, JSON.stringify(newProps)]
  );

  await logDocumentChange(id, 'state', 'triage', 'cancelled', userId);
  const issue = extractIssueFromRow(requireFirstRow(result.rows));
  return { ok: true, status: 200, body: { ...issue, display_id: `#${issue.ticket_number}` } };
}

export async function createIssueIterationMutation(input: {
  issueId: string;
  userId: string;
  workspaceId: string;
  isAdmin: boolean;
  status: 'pass' | 'fail' | 'in_progress';
  what_attempted?: string;
  blockers_encountered?: string;
}): Promise<IssueMutationResult<ReturnType<typeof mapStoredIssueIterationRow>>> {
  const { issueId, userId, workspaceId, isAdmin, status, what_attempted, blockers_encountered } = input;

  const issueCheck = await pool.query<IdRow>(
    `SELECT id, title FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [issueId, workspaceId, userId, isAdmin]
  );

  if (issueCheck.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Issue not found' } };
  }

  const result = await pool.query<IssueStoredIterationRow>(
    `INSERT INTO issue_iterations
     (issue_id, workspace_id, status, what_attempted, blockers_encountered, author_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [issueId, workspaceId, status, what_attempted || null, blockers_encountered || null, userId]
  );

  const authorResult = await pool.query<IssueIterationAuthorRow>(
    'SELECT id, name, email FROM users WHERE id = $1',
    [userId]
  );

  const iteration = requireFirstRow(result.rows);
  const author = requireFirstRow(authorResult.rows);
  return { ok: true, status: 201, body: mapStoredIssueIterationRow(iteration, author) };
}

export async function listIssueIterations(
  db: QueryRunner,
  input: {
    issueId: string;
    workspaceId: string;
    userId: string;
    isAdmin: boolean;
    status?: 'pass' | 'fail' | 'in_progress';
  }
): Promise<IssueMutationResult<ReturnType<typeof mapListedIssueIterationRow>[]>> {
  const { issueId, workspaceId, userId, isAdmin, status } = input;

  const issueCheck = await db.query<IdRow>(
    `SELECT id FROM documents
     WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
       AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
    [issueId, workspaceId, userId, isAdmin]
  );

  if (issueCheck.rows.length === 0) {
    return { ok: false, status: 404, body: { error: 'Issue not found' } };
  }

  let query = `
    SELECT i.*, u.name as author_name, u.email as author_email
    FROM issue_iterations i
    JOIN users u ON i.author_id = u.id
    WHERE i.issue_id = $1 AND i.workspace_id = $2
  `;
  const params: unknown[] = [issueId, workspaceId];
  let paramIndex = 3;

  if (status) {
    query += ` AND i.status = $${paramIndex++}`;
    params.push(status);
  }

  query += ' ORDER BY i.created_at DESC';

  const result = await db.query<IssueIterationListRow>(query, params);
  return { ok: true, status: 200, body: result.rows.map(mapListedIssueIterationRow) };
}
