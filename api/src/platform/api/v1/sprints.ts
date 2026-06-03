// Public sprint routes expose document-backed sprint read models through OAuth scopes.
import { Router, type Request, type Response } from 'express';
import {
  PublicSprintIssueListQuerySchema,
  PublicSprintListQuerySchema,
  PublicSprintParamsSchema,
} from '@ship/shared';
import { sendPublicApiError } from './errors.js';
import {
  listPublicIssuesPage,
  parsePublicIssueCursor,
} from './issue-read-model.js';
import {
  findPublicSprint,
  listPublicSprintsPage,
  parsePublicSprintCursor,
} from './sprint-read-model.js';
import {
  sendInvalidCursorError,
  sendMissingContext,
  sendValidationError,
} from './public-sql-helpers.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  requirePublicApiBearer,
} from './middleware.js';
import {
  publicSprintIssuesListRouteMetadata,
  publicSprintsGetRouteMetadata,
  publicSprintsListRouteMetadata,
} from './route-metadata.js';
import { parsePublicRouteParams, parsePublicRouteQuery } from './route-request.js';

export const publicSprintsRouter = Router();

publicSprintsRouter.get(
  publicSprintsListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicSprintsListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicSprintsListRouteMetadata.path);
    const parsed = parsePublicRouteQuery(
      publicSprintsListRouteMetadata.operationId,
      req.query,
      PublicSprintListQuerySchema
    );
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const cursor = parsePublicSprintCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor) {
      sendInvalidCursorError(req, res);
      return;
    }

    res.json(await listPublicSprintsPage({
      userId: req.publicApi.userId,
      workspaceId: req.publicApi.workspaceId,
      limit: parsed.data.limit,
      cursor,
    }));
  })
);

publicSprintsRouter.get(
  publicSprintsGetRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicSprintsGetRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicSprintsGetRouteMetadata.path);
    const parsed = parsePublicRouteParams(
      publicSprintsGetRouteMetadata.operationId,
      req.params,
      PublicSprintParamsSchema
    );
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const sprint = await findPublicSprint(
      parsed.data.id,
      req.publicApi.userId,
      req.publicApi.workspaceId
    );
    if (!sprint) {
      req.publicApiErrorCode = 'not_found';
      sendPublicApiError(res, 404, {
        code: 'not_found',
        message: 'Sprint not found',
        request_id: req.publicApi.requestId,
      });
      return;
    }

    res.json(sprint);
  })
);

publicSprintsRouter.get(
  publicSprintIssuesListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicSprintIssuesListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicSprintIssuesListRouteMetadata.path);
    const params = parsePublicRouteParams(
      publicSprintIssuesListRouteMetadata.operationId,
      req.params,
      PublicSprintParamsSchema
    );
    const query = parsePublicRouteQuery(
      publicSprintIssuesListRouteMetadata.operationId,
      req.query,
      PublicSprintIssueListQuerySchema
    );
    if (!params.success) {
      sendValidationError(req, res, params.error);
      return;
    }
    if (!query.success) {
      sendValidationError(req, res, query.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }
    const sprint = await findPublicSprint(
      params.data.id,
      req.publicApi.userId,
      req.publicApi.workspaceId
    );
    if (!sprint) {
      req.publicApiErrorCode = 'not_found';
      sendPublicApiError(res, 404, {
        code: 'not_found',
        message: 'Sprint not found',
        request_id: req.publicApi.requestId,
      });
      return;
    }

    const cursor = parsePublicIssueCursor(query.data.cursor);
    if (query.data.cursor && !cursor) {
      sendInvalidCursorError(req, res);
      return;
    }

    res.json(await listPublicIssuesPage({
      userId: req.publicApi.userId,
      workspaceId: req.publicApi.workspaceId,
      limit: query.data.limit,
      cursor,
      filters: { ...query.data, sprint_id: params.data.id },
    }));
  })
);
