// Public FleetGraph routes expose read-only attention contexts through OAuth read scopes.
import { Router, type Request, type Response } from 'express';
import { PublicFleetGraphAttentionContextListQuerySchema } from '@ship/shared';
import { InProcessAttentionContextReader } from '../../../fleetgraph/attention-context-reader.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  requirePublicApiBearer,
} from './middleware.js';
import { sendMissingContext, sendValidationError } from './route-handlers.js';
import { publicFleetGraphAttentionContextsListRouteMetadata } from './route-metadata.js';

const inProcessAttentionContextReader = new InProcessAttentionContextReader();

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

    const data = await inProcessAttentionContextReader.listAttentionContexts({
      workspaceId: req.publicApi.workspaceId,
      viewerUserId: req.publicApi.userId,
      sourceIssueId: parsed.data.source_issue_id,
      sourceSprintId: parsed.data.source_sprint_id,
      limit: parsed.data.limit,
    });

    res.json({ data });
  })
);
