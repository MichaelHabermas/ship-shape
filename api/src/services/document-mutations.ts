// Document mutation service centralizes canonical document writes and post-commit side effects.
import type { Pool, PoolClient } from 'pg';
import type { BelongsTo, DocumentType, DocumentVisibility } from '@ship/shared';
import { pool } from '../db/client.js';
import {
  handleVisibilityChange,
  invalidateDocumentCache,
  handleDocumentConversion,
  broadcastToUser,
} from '../collaboration/index.js';
import {
  addBelongsToAssociation,
  removeAssociationsByType,
  syncBelongsToAssociations,
  updateProgramAssociation,
  updateSprintAssociation,
} from '../utils/document-crud.js';
import {
  extractGoalsFromContent,
  extractHypothesisFromContent,
  extractSuccessCriteriaFromContent,
  extractVisionFromContent,
  checkDocumentCompleteness,
} from '../utils/extractHypothesis.js';
import { upsertDocumentSearchIndex } from '../utils/tiptap-search.js';
import {
  findForbiddenGovernanceKeys,
  findForbiddenRaciKeys,
  formatForbiddenGovernanceKeys,
  stripForbiddenGovernanceKeys,
} from '../utils/document-governance.js';
import { asApprovalRecord } from '../utils/approval-workflow.js';
import { getDocumentAccessContext, getReadableDocument, type DocumentActor } from './document-access.js';
import {
  authorize,
  authorizeDocumentMutation,
  capabilityDenialStatus,
  type DocumentMutationCapability,
} from '../security/capabilities.js';
import type { Principal } from '../security/principal.js';
import { enqueueFleetGraphIssueAttentionEvents } from '../fleetgraph/events.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type MutationResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: { error: string; [key: string]: unknown } };

export type DocumentProperties = Record<string, unknown> & {
  is_complete?: boolean;
  missing_fields?: string[];
};

export type DocumentAccessRow = {
  id: string;
  workspace_id: string;
  document_type: DocumentType;
  title: string;
  parent_id: string | null;
  position: number | null;
  ticket_number: number | null;
  properties: DocumentProperties | null;
  content?: unknown;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: DocumentVisibility;
  archived_at?: Date | null;
  deleted_at?: Date | null;
  converted_to_id?: string | null;
  converted_by?: string | null;
};

type DocumentContentRow = {
  id: string;
  title: string;
  content: unknown;
};

type PersonOwnerRow = {
  id: string;
  name: string;
  email: string;
};

export type UpdateDocumentPatch = {
  title?: string;
  content?: unknown;
  parent_id?: string | null;
  position?: number;
  properties?: Record<string, unknown>;
  visibility?: DocumentVisibility;
  document_type?: DocumentType;
  state?: string;
  priority?: string;
  estimate?: number | null;
  assignee_id?: string | null;
  source?: 'internal' | 'external' | 'action_items';
  rejection_reason?: string | null;
  belongs_to?: BelongsTo[];
  confirm_orphan_children?: boolean;
  impact?: number | null;
  confidence?: number | null;
  ease?: number | null;
  color?: string;
  owner_id?: string | null;
  has_design_review?: boolean | null;
  design_review_notes?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  program_id?: string | null;
  sprint_id?: string | null;
  status?: 'planning' | 'active' | 'completed';
  hypothesis?: string;
  plan?: string;
};

export type CreateDocumentInput = {
  actor: DocumentActor;
  principal: Principal;
  input: {
    title: string;
    document_type: DocumentType;
    parent_id?: string | null;
    program_id?: string | null;
    sprint_id?: string | null;
    properties?: Record<string, unknown>;
    visibility?: DocumentVisibility;
    content?: unknown;
    belongs_to?: BelongsTo[];
  };
  source: 'rest' | 'collaboration' | 'system';
};

export type UpdateDocumentContentInput = {
  actor: DocumentActor;
  principal: Principal;
  documentId: string;
  content: { type?: unknown; content?: unknown };
  source: 'rest' | 'collaboration' | 'system';
};

export type UpdateDocumentInput = {
  actor: DocumentActor;
  principal: Principal;
  documentId: string;
  patch: UpdateDocumentPatch;
  capability?: DocumentMutationCapability;
  source: 'rest' | 'collaboration' | 'system';
};

export type DeleteDocumentInput = {
  actor: DocumentActor;
  principal: Principal;
  documentId: string;
  source: 'rest' | 'collaboration' | 'system';
};

export type ConvertDocumentInput = {
  actor: DocumentActor;
  principal: Principal;
  documentId: string;
  targetType: 'issue' | 'project';
  source: 'rest' | 'collaboration' | 'system';
};

function asDocumentProperties(value: unknown): DocumentProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as DocumentProperties;
}

async function guardMutationCapability(
  db: QueryRunner,
  principal: Principal,
  spec: DocumentMutationCapability
): Promise<MutationResult<never> | null> {
  const decision = await authorizeDocumentMutation(db, principal, spec);
  if (decision.allowed) return null;
  return {
    ok: false,
    status: capabilityDenialStatus(decision.reason),
    body: { error: decision.reason },
  };
}

function defaultWriteCapability(documentId: string): DocumentMutationCapability {
  return { action: 'write', documentId };
}

function creatorWriteCapability(documentId: string, includeArchived = false): DocumentMutationCapability {
  return { action: 'write', documentId, enforce: 'creator_or_admin', includeArchived };
}

async function loadAccessibleDocument(
  db: QueryRunner,
  principal: Principal,
  documentId: string,
  options: { includeArchived?: boolean } = {}
): Promise<DocumentAccessRow | null> {
  const decision = await authorizeDocumentMutation(db, principal, {
    action: 'write',
    documentId,
    includeArchived: options.includeArchived,
  });
  if (!decision.allowed || !decision.document || principal.kind === 'setup') {
    return null;
  }

  const result = await db.query<DocumentAccessRow>(
    `SELECT id, workspace_id, document_type, title, parent_id, position, ticket_number,
            properties, content, created_at, updated_at, created_by, visibility,
            archived_at, deleted_at, converted_to_id, converted_by
       FROM documents
      WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [documentId, principal.workspaceId]
  );

  return result.rows[0] ?? null;
}

async function nextIssueTicketNumber(client: PoolClient, workspaceId: string): Promise<number> {
  const workspaceIdHex = workspaceId.replace(/-/g, '').substring(0, 15);
  const lockKey = parseInt(workspaceIdHex, 16);
  await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
  const ticketResult = await client.query<{ next_number: number }>(
    `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
     FROM documents
     WHERE workspace_id = $1 AND document_type = 'issue'`,
    [workspaceId]
  );
  return ticketResult.rows[0]?.next_number ?? 1;
}

async function removeAssociationsByRelatedId(
  client: PoolClient,
  relatedId: string,
  relationshipType: 'program' | 'project' | 'sprint' | 'parent'
): Promise<void> {
  await client.query(
    `DELETE FROM document_associations
     WHERE related_id = $1 AND relationship_type = $2`,
    [relatedId, relationshipType]
  );
}

async function validateReferences(
  db: QueryRunner,
  principal: Principal,
  references: Array<{ id: string; type?: 'program' | 'project' | 'sprint' | 'parent'; label: string }>
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const reference of references) {
    if (!reference.type) continue;
    const decision = await authorize(db, principal, {
      resource: 'document_reference',
      action: 'link',
      targetId: reference.id,
      relationship: reference.type,
    });
    if (!decision.allowed) {
      return { ok: false, error: `${reference.label} not found` };
    }
  }
  return { ok: true };
}

function validateTipTapContent(content: { type?: unknown; content?: unknown }): MutationResult<never> | null {
  if (!content || typeof content !== 'object') {
    return { ok: false, status: 400, body: { error: 'Content is required and must be a valid TipTap JSON object' } };
  }

  if (content.type !== 'doc' || !Array.isArray(content.content)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Invalid content structure. Content must be a TipTap document with type "doc" and a content array.',
        expected: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '...' }] }] },
        received: { type: content.type, hasContentArray: Array.isArray(content.content) },
      },
    };
  }

  return null;
}

function extractedContentProperties(content: unknown) {
  return {
    plan: extractHypothesisFromContent(content),
    success_criteria: extractSuccessCriteriaFromContent(content),
    vision: extractVisionFromContent(content),
    goals: extractGoalsFromContent(content),
  };
}

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

    const newProps = {
      ...(existing.properties || {}),
      ...extractedContentProperties(content),
    };

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

function collectTopLevelProperties(data: UpdateDocumentPatch, existingType: DocumentType): Record<string, unknown> {
  const topLevelProps: Record<string, unknown> = {};
  if (data.state !== undefined) topLevelProps.state = data.state;
  if (data.priority !== undefined) topLevelProps.priority = data.priority;
  if (data.estimate !== undefined) topLevelProps.estimate = data.estimate;
  if (data.assignee_id !== undefined) topLevelProps.assignee_id = data.assignee_id;
  if (data.source !== undefined) topLevelProps.source = data.source;
  if (data.rejection_reason !== undefined) topLevelProps.rejection_reason = data.rejection_reason;
  if (data.impact !== undefined) topLevelProps.impact = data.impact;
  if (data.confidence !== undefined) topLevelProps.confidence = data.confidence;
  if (data.ease !== undefined) topLevelProps.ease = data.ease;
  if (data.color !== undefined) topLevelProps.color = data.color;
  if (data.owner_id !== undefined) topLevelProps.owner_id = data.owner_id;
  if (data.accountable_id !== undefined) topLevelProps.accountable_id = data.accountable_id;
  if (data.consulted_ids !== undefined) topLevelProps.consulted_ids = data.consulted_ids;
  if (data.informed_ids !== undefined) topLevelProps.informed_ids = data.informed_ids;
  if (data.has_design_review !== undefined) topLevelProps.has_design_review = data.has_design_review;
  if (data.design_review_notes !== undefined) topLevelProps.design_review_notes = data.design_review_notes;
  if (data.owner_id !== undefined && existingType === 'sprint') {
    topLevelProps.assignee_ids = data.owner_id ? [data.owner_id] : [];
  }
  if (data.status !== undefined) topLevelProps.status = data.status;
  if (data.hypothesis !== undefined) topLevelProps.plan = data.hypothesis;
  if (data.plan !== undefined) topLevelProps.plan = data.plan;
  return topLevelProps;
}

async function resetWeeklyApprovalAfterResubmission(
  client: PoolClient,
  actor: DocumentActor,
  existing: DocumentAccessRow
): Promise<{ sprintId: string; reviewerUserId: string | null } | null> {
  if (existing.document_type !== 'weekly_plan' && existing.document_type !== 'weekly_retro') {
    return null;
  }

  const docProps = existing.properties || {};
  const personId = typeof docProps.person_id === 'string' ? docProps.person_id : null;
  const projectId = typeof docProps.project_id === 'string' ? docProps.project_id : null;
  const rawWeekNumber = docProps.week_number;
  const weekNumber = typeof rawWeekNumber === 'number'
    ? rawWeekNumber
    : typeof rawWeekNumber === 'string'
      ? Number.parseInt(rawWeekNumber, 10)
      : NaN;

  if (!personId || !projectId || !Number.isFinite(weekNumber)) {
    return null;
  }

  const sprintResult = await client.query<{ id: string; properties: unknown }>(
    `SELECT id, properties
       FROM documents
      WHERE workspace_id = $1
        AND document_type = 'sprint'
        AND deleted_at IS NULL
        AND (properties->>'project_id') = $2
        AND (properties->>'sprint_number')::int = $3
        AND (
          properties->>'owner_id' = $4
          OR EXISTS (
            SELECT 1
              FROM jsonb_array_elements_text(COALESCE(properties->'assignee_ids', '[]'::jsonb)) AS assignee_id
             WHERE assignee_id = $4
          )
        )
      ORDER BY updated_at DESC
      LIMIT 1`,
    [actor.workspaceId, projectId, weekNumber, personId]
  );

  const sprint = sprintResult.rows[0];
  if (!sprint) {
    return null;
  }

  const sprintProps = asDocumentProperties(sprint.properties);
  const approvalKey = existing.document_type === 'weekly_plan' ? 'plan_approval' : 'review_approval';
  const approval = asApprovalRecord(sprintProps[approvalKey]);
  if (approval?.state !== 'changes_requested') {
    return null;
  }

  await client.query(
    `UPDATE documents SET properties = $1, updated_at = now()
     WHERE id = $2 AND document_type = 'sprint'`,
    [
      JSON.stringify({
        ...sprintProps,
        [approvalKey]: { ...approval, state: 'changed_since_approved' },
      }),
      sprint.id,
    ]
  );

  return {
    sprintId: String(sprint.id),
    reviewerUserId: typeof approval.approved_by === 'string' ? approval.approved_by : null,
  };
}

async function projectOwnerForResponse(ownerId: unknown, workspaceId: string): Promise<PersonOwnerRow | null> {
  if (!ownerId) return null;
  const ownerResult = await pool.query<PersonOwnerRow>(
    `SELECT (d.properties->>'user_id')::text as id, d.title as name, COALESCE(d.properties->>'email', u.email) as email
     FROM documents d
     LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
     WHERE (d.properties->>'user_id')::uuid = $1 AND d.workspace_id = $2 AND d.document_type = 'person'`,
    [ownerId, workspaceId]
  );
  return ownerResult.rows[0] ?? null;
}

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

    const forbiddenOnCreate = isAdmin ? [] : findForbiddenGovernanceKeys(properties);
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

    const forbiddenGovernanceKeys = isAdmin ? [] : findForbiddenGovernanceKeys(patch.properties);
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
      newProps = stripForbiddenGovernanceKeys(newProps, { isAdmin });

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
