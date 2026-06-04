// Public document routes expose the unified document model through OAuth scopes.
import { Router, type Request, type Response } from 'express';
import {
  PublicDocumentCreateSchema,
  PublicDocumentListQuerySchema,
  PublicDocumentParamsSchema,
} from '@ship/shared';
import { createDocumentMutation } from '../../../services/document-mutations/index.js';
import {
  findPublicDocument,
  listPublicDocumentsPage,
  parsePublicDocumentCursor,
  publicDocumentFromMutationRow,
} from './document-read-model.js';
import { sendPublicApiError } from './errors.js';
import {
  sendInvalidCursorError,
  sendMissingContext,
  sendValidationError,
} from './public-sql-helpers.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  publicApiPrincipalFromRequest,
  requirePublicApiBearer,
} from './middleware.js';
import {
  publicDocumentsCreateRouteMetadata,
  publicDocumentsGetRouteMetadata,
  publicDocumentsListRouteMetadata,
} from './route-metadata.js';
import { parsePublicRouteBody, parsePublicRouteParams, parsePublicRouteQuery } from './route-request.js';

export const publicDocumentsRouter = Router();

publicDocumentsRouter.get(
  publicDocumentsListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicDocumentsListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicDocumentsListRouteMetadata.path);
    const parsed = parsePublicRouteQuery(
      publicDocumentsListRouteMetadata.operationId,
      req.query,
      PublicDocumentListQuerySchema
    );
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const cursor = parsePublicDocumentCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor) {
      sendInvalidCursorError(req, res);
      return;
    }

    res.json(await listPublicDocumentsPage({
      userId: req.publicApi.userId,
      workspaceId: req.publicApi.workspaceId,
      limit: parsed.data.limit,
      cursor,
      type: parsed.data.type,
    }));
  })
);

publicDocumentsRouter.get(
  publicDocumentsGetRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicDocumentsGetRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicDocumentsGetRouteMetadata.path);
    const parsed = parsePublicRouteParams(
      publicDocumentsGetRouteMetadata.operationId,
      req.params,
      PublicDocumentParamsSchema
    );
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const document = await findPublicDocument(
      parsed.data.id,
      req.publicApi.userId,
      req.publicApi.workspaceId
    );
    if (!document) {
      req.publicApiErrorCode = 'not_found';
      sendPublicApiError(res, 404, {
        code: 'not_found',
        message: 'Document not found',
        request_id: req.publicApi.requestId,
      });
      return;
    }

    res.json(document);
  })
);

publicDocumentsRouter.post(
  publicDocumentsCreateRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicDocumentsCreateRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicDocumentsCreateRouteMetadata.path);
    const parsed = parsePublicRouteBody(
      publicDocumentsCreateRouteMetadata.operationId,
      req.body,
      PublicDocumentCreateSchema
    );
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
    const mutation = await createDocumentMutation({
      actor,
      principal: publicApiPrincipalFromRequest(req),
      input: parsed.data,
      source: 'rest',
    });

    if (!mutation.ok) {
      req.publicApiErrorCode = publicErrorCodeForStatus(mutation.status);
      sendPublicApiError(res, mutation.status, {
        code: req.publicApiErrorCode,
        message: String(mutation.body.error ?? 'Document create failed'),
        request_id: req.publicApi.requestId,
      });
      return;
    }

    res.status(201).json(publicDocumentFromMutationRow(mutation.body));
  })
);

function publicErrorCodeForStatus(status: number) {
  if (status === 400) return 'validation_failed';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'server_error';
}
