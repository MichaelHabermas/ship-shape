// Public issue routes expose document-backed work items through OAuth issue scopes.
import { Router, type Request, type Response } from 'express';
import {
  PublicIssueCreateSchema,
  PublicIssueListQuerySchema,
  PublicIssueParamsSchema,
  PublicIssueIncompleteChildrenDetailsSchema,
  PublicIssueUpdateSchema,
  asIssueState,
  type PublicIssueIncompleteChildrenDetails,
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
  const requestId = req.publicApi?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req);

  if (status === 404) {
    req.publicApiErrorCode = 'not_found';
    sendPublicApiError(res, status, {
      code: 'not_found',
      message: typeof body.error === 'string' ? body.error : 'Issue not found',
      request_id: requestId,
    });
    return;
  }

  if (status === 403) {
    req.publicApiErrorCode = 'forbidden';
    sendPublicApiError(res, status, {
      code: 'forbidden',
      message: typeof body.error === 'string' ? body.error : 'Forbidden',
      request_id: requestId,
    });
    return;
  }

  if (status === 409 && body.error === 'incomplete_children') {
    const details = buildIncompleteChildrenDetails(body);
    req.publicApiErrorCode = 'conflict';
    sendPublicApiError(res, status, {
      code: 'conflict',
      message: typeof body.message === 'string' ? body.message : 'Issue update conflict',
      details,
      request_id: requestId,
    });
    return;
  }

  req.publicApiErrorCode = 'validation_failed';
  sendPublicApiError(res, status, {
    code: 'validation_failed',
    message: typeof body.error === 'string' ? body.error : 'Issue mutation failed',
    request_id: requestId,
  });
}

function buildIncompleteChildrenDetails(body: Record<string, unknown>): PublicIssueIncompleteChildrenDetails {
  const rawChildren = Array.isArray(body.incomplete_children) ? body.incomplete_children : [];
  const incompleteChildren = rawChildren.flatMap((child) => {
    if (!child || typeof child !== 'object') return [];
    const row = child as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.title !== 'string') return [];
    const ticketNumber = typeof row.ticket_number === 'number' ? row.ticket_number : null;
    const state = row.state === null || row.state === undefined
      ? null
      : asIssueState(row.state);
    return [{ id: row.id, title: row.title, ticket_number: ticketNumber, state }];
  });

  return PublicIssueIncompleteChildrenDetailsSchema.parse({
    reason: 'incomplete_children',
    incomplete_children: incompleteChildren,
    confirm_action: typeof body.confirm_action === 'string'
      ? body.confirm_action
      : 'Set confirm_orphan_children: true to proceed',
  });
}
