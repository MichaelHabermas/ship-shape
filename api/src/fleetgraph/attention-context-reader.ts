// Attention context reader port abstracts in-process detection reads from HTTP loopback.
import {
  PublicFleetGraphAttentionContextSchema,
  asIssuePriority,
  asIssueState,
  type PublicFleetGraphAttentionContext,
} from '@ship/shared';
import type { ShipClient } from '@ship/sdk';
import { z } from 'zod';
import { getDocumentAccessContext } from '../services/document-access.js';
import {
  listFleetGraphIssueAttentionContexts,
  type FleetGraphIssueAttentionContext,
} from './detection/attention-context.js';

export type AttentionContextListParams = {
  workspaceId: string;
  viewerUserId: string;
  sourceIssueId?: string;
  sourceSprintId?: string;
  limit?: number;
};

export interface AttentionContextReader {
  listAttentionContexts(params: AttentionContextListParams): Promise<PublicFleetGraphAttentionContext[]>;
}

export function publicAttentionContextFromRow(
  row: FleetGraphIssueAttentionContext
): PublicFleetGraphAttentionContext {
  return PublicFleetGraphAttentionContextSchema.parse({
    workspace_id: row.workspace_id,
    issue_id: row.issue_id,
    issue_title: row.issue_title,
    issue_ticket_number: row.issue_ticket_number,
    issue_state: row.issue_state === null ? null : asIssueState(row.issue_state),
    issue_priority: asIssuePriority(row.issue_priority),
    issue_assignee_id: uuidOrNull(row.issue_assignee_id),
    issue_assignee_name: row.issue_assignee_name,
    issue_visibility: row.issue_visibility,
    issue_created_at: row.issue_created_at.toISOString(),
    issue_updated_at: row.issue_updated_at.toISOString(),
    sprint_id: row.sprint_id,
    sprint_title: row.sprint_title,
    sprint_number: row.sprint_number,
    sprint_owner_id: uuidOrNull(row.sprint_owner_id),
    sprint_owner_name: row.sprint_owner_name,
    project_id: uuidOrNull(row.project_id),
    project_title: row.project_title,
    project_owner_id: uuidOrNull(row.project_owner_id),
    project_owner_name: row.project_owner_name,
    program_id: uuidOrNull(row.program_id),
    program_title: row.program_title,
    program_owner_id: uuidOrNull(row.program_owner_id),
    program_owner_name: row.program_owner_name,
    blocker_text: row.blocker_text,
    blocker_iteration_id: uuidOrNull(row.blocker_iteration_id),
    blocker_iteration_created_at: row.blocker_iteration_created_at?.toISOString() ?? null,
    latest_iteration_id: uuidOrNull(row.latest_iteration_id),
    latest_iteration_created_at: row.latest_iteration_created_at?.toISOString() ?? null,
    meaningful_updated_at: row.meaningful_updated_at.toISOString(),
  });
}

export class InProcessAttentionContextReader implements AttentionContextReader {
  async listAttentionContexts(params: AttentionContextListParams): Promise<PublicFleetGraphAttentionContext[]> {
    const actor = {
      userId: params.viewerUserId,
      workspaceId: params.workspaceId,
      isSuperAdmin: false,
    };
    const { isAdmin } = await getDocumentAccessContext(actor);
    const contexts = await listFleetGraphIssueAttentionContexts({
      workspaceId: params.workspaceId,
      sourceIssueId: params.sourceIssueId,
      sourceSprintId: params.sourceSprintId,
      limit: params.limit,
      viewerUserId: params.viewerUserId,
      viewerIsAdmin: isAdmin,
    });
    return contexts.map(publicAttentionContextFromRow);
  }
}

export class HttpAttentionContextReader implements AttentionContextReader {
  constructor(private readonly client: ShipClient) {}

  async listAttentionContexts(params: AttentionContextListParams): Promise<PublicFleetGraphAttentionContext[]> {
    const result = await this.client.fleetgraph.attentionContexts.list({
      limit: params.limit,
      ...(params.sourceIssueId ? { source_issue_id: params.sourceIssueId } : {}),
      ...(params.sourceSprintId ? { source_sprint_id: params.sourceSprintId } : {}),
    });
    return result.data;
  }
}

function uuidOrNull(value: string | null): string | null {
  if (!value) return null;
  return z.string().uuid().safeParse(value).success ? value : null;
}
