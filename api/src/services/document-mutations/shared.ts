import type { Pool, PoolClient } from 'pg';
import type { DocumentType } from '@ship/shared';
import { pool } from '../../db/client.js';
import {
  extractGoalsFromContent,
  extractHypothesisFromContent,
  extractSuccessCriteriaFromContent,
  extractVisionFromContent,
} from '../../utils/extractHypothesis.js';
import { asApprovalRecord } from '../../utils/approval-workflow.js';
import { authorize, type DocumentMutationCapability } from '../../security/capabilities.js';
import type { Principal } from '../../security/principal.js';
import { guardDocumentMutation, mutationGuardDenial } from '../mutation-capability-guard.js';
import type { DocumentActor } from '../document-access.js';
import {
  type DocumentAccessRow,
  type DocumentProperties,
  type MutationResult,
  type UpdateDocumentPatch,
} from './types.js';

export type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export function asDocumentProperties(value: unknown): DocumentProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as DocumentProperties;
}

export async function guardMutationCapability(
  db: QueryRunner,
  principal: Principal,
  spec: DocumentMutationCapability,
  notFoundMessage = 'Document not found'
): Promise<MutationResult<never> | null> {
  const guard = await guardDocumentMutation(db, principal, spec, { notFoundMessage });
  if (guard.ok) return null;
  return mutationGuardDenial(guard);
}

export function defaultWriteCapability(documentId: string): DocumentMutationCapability {
  return { action: 'write', documentId };
}

export function creatorWriteCapability(documentId: string, includeArchived = false): DocumentMutationCapability {
  return { action: 'write', documentId, enforce: 'creator_or_admin', includeArchived };
}

export async function loadAccessibleDocument(
  db: QueryRunner,
  principal: Principal,
  documentId: string,
  options: { includeArchived?: boolean } = {}
): Promise<DocumentAccessRow | null> {
  const guard = await guardDocumentMutation(db, principal, {
    action: 'write',
    documentId,
    includeArchived: options.includeArchived,
  });
  if (!guard.ok || principal.kind === 'setup') {
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

export async function nextIssueTicketNumber(client: PoolClient, workspaceId: string): Promise<number> {
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

export async function removeAssociationsByRelatedId(
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

export async function validateReferences(
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

export function validateTipTapContent(content: { type?: unknown; content?: unknown }): MutationResult<never> | null {
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

export function extractedContentProperties(content: unknown) {
  return {
    plan: extractHypothesisFromContent(content),
    success_criteria: extractSuccessCriteriaFromContent(content),
    vision: extractVisionFromContent(content),
    goals: extractGoalsFromContent(content),
  };
}

export function collectTopLevelProperties(data: UpdateDocumentPatch, existingType: DocumentType): Record<string, unknown> {
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

export async function resetWeeklyApprovalAfterResubmission(
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

export async function projectOwnerForResponse(ownerId: unknown, workspaceId: string) {
  if (!ownerId) return null;
  const ownerResult = await pool.query<{ id: string; name: string; email: string }>(
    `SELECT (d.properties->>'user_id')::text as id, d.title as name, COALESCE(d.properties->>'email', u.email) as email
     FROM documents d
     LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
     WHERE (d.properties->>'user_id')::uuid = $1 AND d.workspace_id = $2 AND d.document_type = 'person'`,
    [ownerId, workspaceId]
  );
  return ownerResult.rows[0] ?? null;
}
