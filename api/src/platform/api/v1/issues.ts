// Public issue routes expose document-backed work items through OAuth issue scopes.
import { Router, type Request, type Response } from 'express';
import {
  PublicIssueCreateSchema,
  PublicIssueListQuerySchema,
  PublicIssueParamsSchema,
  PublicIssueUpdateSchema,
} from '@ship/shared';
import { pool } from '../../../db/client.js';
import {
  createIssueMutation,
  updateIssueMutation,
} from '../../../services/issue-mutations/index.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  publicApiPrincipalFromRequest,
  publicApiRequestIdFromRequest,
  requirePublicApiBearer,
} from './middleware.js';
import { sendPublicApiError } from './errors.js';
import {
  sendInvalidCursorError,
  sendMissingContext,
  sendValidationError,
} from './route-handlers.js';
import {
  findPublicIssue,
  listPublicIssuesPage,
  parsePublicIssueCursor,
} from './issue-read-model.js';
import {
  publicIssuesCreateRouteMetadata,
  publicIssuesGetRouteMetadata,
  publicIssuesListRouteMetadata,
  publicIssuesUpdateRouteMetadata,
} from './route-metadata.js';

export const publicIssuesRouter = Router();

publicIssuesRouter.get(
  publicIssuesListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicIssuesListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicIssuesListRouteMetadata.path);
    const parsed = PublicIssueListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const cursor = parsePublicIssueCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor) {
      sendInvalidCursorError(req, res);
      return;
    }

    res.json(await listPublicIssuesPage({
      userId: req.publicApi.userId,
      workspaceId: req.publicApi.workspaceId,
      limit: parsed.data.limit,
      cursor,
      filters: parsed.data,
    }));
  })
);

publicIssuesRouter.get(
  publicIssuesGetRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicIssuesGetRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicIssuesGetRouteMetadata.path);
    const parsed = PublicIssueParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const issue = await findPublicIssue(parsed.data.id, req.publicApi.userId, req.publicApi.workspaceId);
    if (!issue) {
      req.publicApiErrorCode = 'not_found';
      sendPublicApiError(res, 404, {
        code: 'not_found',
        message: 'Issue not found',
        request_id: req.publicApi.requestId,
      });
      return;
    }

    res.json(issue);
  })
);

publicIssuesRouter.post(
  publicIssuesCreateRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicIssuesCreateRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicIssuesCreateRouteMetadata.path);
    const parsed = PublicIssueCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const client = await pool.connect();
    try {
      const result = await createIssueMutation({
        client,
        actor: {
          userId: req.publicApi.userId,
          workspaceId: req.publicApi.workspaceId,
          isSuperAdmin: false,
        },
        principal: publicApiPrincipalFromRequest(req),
        userId: req.publicApi.userId,
        workspaceId: req.publicApi.workspaceId,
        data: {
          ...parsed.data,
          is_system_generated: false,
          accountability_target_id: null,
          accountability_type: null,
        },
      });
      if (!result.ok) {
        sendMutationError(req, res, result.status, result.body);
        return;
      }
      const issueId = publicIssueIdFromMutationBody(result.body);
      const issue = await findPublicIssue(issueId, req.publicApi.userId, req.publicApi.workspaceId);
      if (!issue) {
        sendMissingContext(req, res);
        return;
      }
      res.status(201).json(issue);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

publicIssuesRouter.patch(
  publicIssuesUpdateRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicIssuesUpdateRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicIssuesUpdateRouteMetadata.path);
    const params = PublicIssueParamsSchema.safeParse(req.params);
    const body = PublicIssueUpdateSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      const error = params.success ? body.error : params.error;
      if (error) sendValidationError(req, res, error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const client = await pool.connect();
    try {
      const result = await updateIssueMutation({
        client,
        actor: {
          userId: req.publicApi.userId,
          workspaceId: req.publicApi.workspaceId,
          isSuperAdmin: false,
        },
        principal: publicApiPrincipalFromRequest(req),
        userId: req.publicApi.userId,
        workspaceId: req.publicApi.workspaceId,
        issueId: params.data.id,
        data: body.data,
      });
      if (!result.ok) {
        sendMutationError(req, res, result.status, result.body);
        return;
      }
      const issue = await findPublicIssue(params.data.id, req.publicApi.userId, req.publicApi.workspaceId);
      if (!issue) {
        req.publicApiErrorCode = 'not_found';
        sendPublicApiError(res, 404, {
          code: 'not_found',
          message: 'Issue not found',
          request_id: req.publicApi.requestId,
        });
        return;
      }
      res.json(issue);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

function publicIssueIdFromMutationBody(body: Record<string, unknown>): string {
  if (typeof body.id === 'string') return body.id;
  throw new Error('Issue mutation returned no issue id');
}

function sendMutationError(
  req: Request,
  res: Response,
  status: number,
  body: Record<string, unknown>
): void {
  req.publicApiErrorCode = status === 404 ? 'not_found' : status === 403 ? 'forbidden' : 'validation_failed';
  sendPublicApiError(res, status, {
    code: req.publicApiErrorCode,
    message: typeof body.error === 'string' ? body.error : 'Issue mutation failed',
    request_id: req.publicApi?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req),
  });
}
