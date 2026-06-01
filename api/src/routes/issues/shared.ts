import { Response } from 'express';
import { z } from 'zod';
import type { IssueProperties } from '@ship/shared';
import { pool } from '../../db/client.js';
import {
  extractIssueFromRow,
  type IssueDetailRow,
} from '../../db/documents-repository.js';
import {
  issuePrioritySchema,
  issueSourceSchema,
  issueStateSchema,
  createIssueRequestSchema,
  updateIssueRequestSchema,
} from '../../schemas/document-boundary.js';
import { getBelongsToAssociations } from '../../utils/document-crud.js';
import {
  getReadableDocument,
  type DocumentActor,
} from '../../services/document-access.js';
import type { IssueMutationResult } from '../../services/issue-mutations/index.js';

export type PersonIdRow = { id: string };
export type IssuePropertiesRow = {
  id: string;
  properties: IssueProperties | Record<string, unknown> | null;
};

export const createIssueSchema = createIssueRequestSchema;
export const updateIssueSchema = updateIssueRequestSchema;

export const rejectIssueSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export const listIssuesQuerySchema = z.object({
  state: z.string().optional(),
  priority: issuePrioritySchema.optional(),
  assignee_id: z.string().optional(),
  program_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  sprint_id: z.string().uuid().optional(),
  source: issueSourceSchema.optional(),
  parent_filter: z.enum(['top_level', 'has_children', 'is_sub_issue']).optional(),
});

export const logHistorySchema = z.object({
  field: z.string().min(1).max(100),
  old_value: z.string().nullable(),
  new_value: z.string().nullable(),
  automated_by: z.string().optional(),
});

export const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['archive', 'delete', 'restore', 'update']),
  updates: z.object({
    state: issueStateSchema.optional(),
    sprint_id: z.string().uuid().nullable().optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
  }).optional(),
});

export const createIterationSchema = z.object({
  status: z.enum(['pass', 'fail', 'in_progress']),
  what_attempted: z.string().max(5000).optional(),
  blockers_encountered: z.string().max(5000).optional(),
});

export const listIterationsSchema = z.object({
  status: z.enum(['pass', 'fail', 'in_progress']).optional(),
});

export function respondIssueMutation<T>(res: Response, result: IssueMutationResult<T>): void {
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.status(result.status).json(result.body);
}

export async function sendIssueDetailResponse(
  res: Response,
  row: IssueDetailRow,
  actor: DocumentActor
): Promise<void> {
  if (row.converted_to_id) {
    const newDoc = await getReadableDocument(pool, actor, row.converted_to_id);

    if (newDoc) {
      res.set('X-Converted-Type', newDoc.document_type);
      res.set('X-Converted-To', newDoc.id);
      res.redirect(301, `/api/${newDoc.document_type}s/${newDoc.id}`);
      return;
    }
  }

  const issue = extractIssueFromRow(row);
  const belongs_to = await getBelongsToAssociations(row.id);
  res.json({
    ...issue,
    display_id: `#${issue.ticket_number}`,
    belongs_to,
  });
}
