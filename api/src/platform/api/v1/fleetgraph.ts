// Public FleetGraph routes expose read-only attention contexts through OAuth read scopes.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PublicFleetGraphAttentionContextListQuerySchema,
  PublicFleetGraphAttentionContextSchema,
  type PublicFleetGraphAttentionContext,
} from '@ship/shared';
import { getDocumentAccessContext } from '../../../services/document-access.js';
import { listFleetGraphIssueAttentionContexts } from '../../../fleetgraph/detection/attention-context.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  publicApiRequestIdFromRequest,
  requirePublicApiBearer,
} from './middleware.js';
import { sendPublicApiError } from './errors.js';
import { publicFleetGraphAttentionContextsListRouteMetadata } from './route-metadata.js';

export const publicFleetGraphRouter = Router();

publicFleetGraphRouter.get(
  publicFleetGraphAttentionContextsListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicFleetGraphAttentionContextsListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicFleetGraphAttentionContextsListRouteMetadata.path);
    const parsed = PublicFleetGraphAttentionContextListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const actor = {
      userId: req.publicApi.userId,
      workspaceId: req.publicApi.workspaceId,
      isSuperAdmin: false,
    };
    const { isAdmin } = await getDocumentAccessContext(actor);
    const contexts = await listFleetGraphIssueAttentionContexts({
      workspaceId: req.publicApi.workspaceId,
      sourceIssueId: parsed.data.source_issue_id,
      sourceSprintId: parsed.data.source_sprint_id,
      limit: parsed.data.limit,
      viewerUserId: req.publicApi.userId,
      viewerIsAdmin: isAdmin,
    });

    res.json({
      data: contexts.map(publicAttentionContextFromRow),
    });
  })
);

function publicAttentionContextFromRow(
  row: Awaited<ReturnType<typeof listFleetGraphIssueAttentionContexts>>[number]
): PublicFleetGraphAttentionContext {
  return PublicFleetGraphAttentionContextSchema.parse({
    workspace_id: row.workspace_id,
    issue_id: row.issue_id,
    issue_title: row.issue_title,
    issue_ticket_number: row.issue_ticket_number,
    issue_state: row.issue_state,
    issue_priority: row.issue_priority,
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

function uuidOrNull(value: string | null): string | null {
  if (!value) return null;
  return z.string().uuid().safeParse(value).success ? value : null;
}

function sendValidationError(req: Request, res: Response, error: z.ZodError): void {
  req.publicApiErrorCode = 'validation_failed';
  sendPublicApiError(res, 400, {
    code: 'validation_failed',
    message: 'Invalid request',
    details: { fields: error.flatten() },
    request_id: req.publicApi?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req),
  });
}

function sendMissingContext(req: Request, res: Response): void {
  req.publicApiErrorCode = 'server_error';
  sendPublicApiError(res, 500, {
    code: 'server_error',
    message: 'Public API context missing',
    request_id: req.publicApiRequestId ?? 'unknown',
  });
}
