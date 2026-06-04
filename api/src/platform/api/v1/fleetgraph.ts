// Public FleetGraph routes expose read-only attention contexts through OAuth read scopes.
import { Router, type Request, type Response } from 'express';
import { PublicFleetGraphAttentionContextListQuerySchema } from '@ship/shared';
import { createAttentionContextReader } from '../../../fleetgraph/attention-context-factory.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  requirePublicApiBearer,
} from './middleware.js';
import { sendMissingContext, sendValidationError } from './public-sql-helpers.js';
import { publicFleetGraphAttentionContextsListRouteMetadata } from './route-metadata.js';
import { parsePublicRouteQuery } from './route-request.js';

export const publicFleetGraphRouter = Router();

publicFleetGraphRouter.get(
  publicFleetGraphAttentionContextsListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicFleetGraphAttentionContextsListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicFleetGraphAttentionContextsListRouteMetadata.path);
    const parsed = parsePublicRouteQuery(
      publicFleetGraphAttentionContextsListRouteMetadata.operationId,
      req.query,
      PublicFleetGraphAttentionContextListQuerySchema
    );
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const reader = await createAttentionContextReader({
      mode: 'in_process',
      workspaceId: req.publicApi.workspaceId,
      viewerUserId: req.publicApi.userId,
    });
    const data = await reader.listAttentionContexts({
      workspaceId: req.publicApi.workspaceId,
      viewerUserId: req.publicApi.userId,
      sourceIssueId: parsed.data.source_issue_id,
      sourceSprintId: parsed.data.source_sprint_id,
      limit: parsed.data.limit,
    });

    res.json({ data, next_cursor: null });
  })
);
