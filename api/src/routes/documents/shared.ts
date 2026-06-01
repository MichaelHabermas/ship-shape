/** Shared document route types, schemas, and helpers. */
import { Request } from 'express';
import { pool } from '../../db/client.js';
import { z } from 'zod';
import { belongsToSchema, documentTypeSchema, documentVisibilitySchema, issueSourceSchema } from '../../schemas/document-boundary.js';
import {
  canReadAccountabilityDocument,
  getActor,
  type AccessibleDocument,
} from '../../services/document-access.js';
import { authorize } from '../../security/capabilities.js';
import { principalFromRequest } from '../../security/principal.js';

export type DocumentProperties = Record<string, unknown> & {
  is_complete?: boolean;
  missing_fields?: string[];
};

export type DocumentAccessRow = {
  id: string;
  workspace_id: string;
  document_type: string;
  title: string;
  parent_id: string | null;
  position: number | null;
  ticket_number: number | null;
  properties: DocumentProperties | null;
  content?: unknown;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: 'private' | 'workspace';
  archived_at?: Date | null;
  deleted_at?: Date | null;
  converted_to_id?: string | null;
  converted_by?: string | null;
  can_access: boolean;
};

export type DocumentListRow = {
  id: string;
  workspace_id: string;
  document_type: string;
  title: string;
  parent_id: string | null;
  position: number | null;
  ticket_number: number | null;
  properties: DocumentProperties | null;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: 'private' | 'workspace';
};

export type ConvertedDocumentRow = {
  id: string;
  title: string;
  original_type: string;
  converted_type: string;
  converted_ticket_number: number | null;
  original_ticket_number: number | null;
  converted_at: Date | null;
  converted_by: string | null;
  converted_by_name: string | null;
};

export type DocumentTypeRow = {
  id: string;
  document_type: string;
};

export type PersonOwnerRow = {
  id: string;
  name: string;
  email: string;
};

export type PersonTitleRow = {
  title: string;
};

export type BelongsToAssocRow = {
  id: string;
  type: string;
  title: string | null;
  color: string | null;
};

export type DocumentContentAccessRow = {
  id: string;
  content: unknown;
  yjs_state: Buffer | null;
  title: string;
  can_access: boolean;
};

export type DocumentSnapshotRow = {
  id: string;
  document_id: string;
  document_type: string;
  title: string;
  properties: DocumentProperties | null;
  ticket_number: number | null;
  snapshot_reason: string;
  created_at: Date;
  created_by: string;
};

export type NextTicketNumberRow = {
  next_number: number;
};

export function extractBelongsToAssocFromRow(row: BelongsToAssocRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title || undefined,
    color: row.color || undefined,
  };
}

export async function loadDocumentForRead(
  req: Request,
  documentId: string
): Promise<{ allowed: boolean; doc: DocumentAccessRow | null }> {
  const actor = getActor(req);
  const decision = await authorize(pool, principalFromRequest(req), {
    resource: 'document',
    action: 'read',
    documentId,
  });

  if (!decision.allowed) {
    return { allowed: false, doc: null };
  }

  const result = await pool.query<DocumentAccessRow>(
    `SELECT d.*, true AS can_access
       FROM documents d
      WHERE d.id = $1 AND d.workspace_id = $2 AND d.deleted_at IS NULL`,
    [documentId, actor.workspaceId]
  );

  const doc = result.rows[0] ?? null;
  return { allowed: Boolean(doc), doc };
}

export async function canReadDocumentWithAccountability(
  doc: Pick<DocumentAccessRow, 'document_type' | 'properties'>,
  actor: ReturnType<typeof getActor>
): Promise<boolean> {
  return canReadAccountabilityDocument(pool, actor, {
    document_type: doc.document_type as AccessibleDocument['document_type'],
    properties: doc.properties ?? {},
  });
}

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional().default('Untitled'),
  document_type: documentTypeSchema.optional().default('wiki'),
  parent_id: z.string().uuid().optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
  properties: z.record(z.unknown()).optional(),
  visibility: documentVisibilitySchema.optional(),
  content: z.unknown().optional(),
  belongs_to: z.array(belongsToSchema).optional(),
});

export const updateContentSchema = z.object({
  content: z
    .object({
      type: z.unknown().optional(),
      content: z.unknown().optional(),
    })
    .passthrough(),
});

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.unknown().optional(),
  parent_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(0).optional(),
  properties: z.record(z.unknown()).optional(),
  visibility: documentVisibilitySchema.optional(),
  document_type: documentTypeSchema.optional(),
  // Issue-specific fields (stored in properties but accepted at top level for convenience)
  state: z.string().optional(),
  priority: z.string().optional(),
  estimate: z.number().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  source: issueSourceSchema.optional(),
  rejection_reason: z.string().nullable().optional(),
  belongs_to: z.array(belongsToSchema).optional(),
  confirm_orphan_children: z.boolean().optional(),
  // Project-specific fields (stored in properties but accepted at top level)
  impact: z.number().min(1).max(10).nullable().optional(),
  confidence: z.number().min(1).max(10).nullable().optional(),
  ease: z.number().min(1).max(10).nullable().optional(),
  color: z.string().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  has_design_review: z.boolean().nullable().optional(),
  design_review_notes: z.string().max(2000).nullable().optional(),
  // RACI fields for projects and programs (stored in properties)
  accountable_id: z.string().uuid().nullable().optional(), // A - Accountable (approver)
  consulted_ids: z.array(z.string().uuid()).optional(), // C - Consulted (provide input)
  informed_ids: z.array(z.string().uuid()).optional(), // I - Informed (kept in loop)
  // Common association fields (shared across document types)
  program_id: z.string().uuid().nullable().optional(),
  sprint_id: z.string().uuid().nullable().optional(),
  // Sprint-specific fields (stored in properties but accepted at top level)
  // Note: start_date/end_date are computed from sprint_number + workspace.sprint_start_date
  status: z.enum(['planning', 'active', 'completed']).optional(),
  hypothesis: z.string().optional(),
  plan: z.string().optional(), // Alias for hypothesis (frontend sends 'plan', stored as 'plan' in properties)
});

export const convertDocumentSchema = z.object({
  target_type: z.enum(['issue', 'project']),
});

export const documentCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_governance'), properties: z.record(z.unknown()) }),
  z.object({ type: z.literal('set_raci'), properties: z.record(z.unknown()) }),
  z.object({ type: z.literal('set_workflow_status'), status: z.enum(['planning', 'active', 'completed']) }),
  z.object({ type: z.literal('set_visibility'), visibility: documentVisibilitySchema }),
  z.object({ type: z.literal('set_parent'), parent_id: z.string().uuid().nullable() }),
  z.object({ type: z.literal('set_associations'), belongs_to: z.array(belongsToSchema) }),
  z.object({ type: z.literal('edit_content'), content: z.object({ type: z.unknown(), content: z.unknown() }).passthrough() }),
  z.object({ type: z.literal('convert'), target_type: z.enum(['issue', 'project']) }),
  z.object({ type: z.literal('delete') }),
]);

