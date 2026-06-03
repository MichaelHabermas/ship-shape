// Public document routes expose the unified document model through OAuth scopes.
import { Router, type Request, type Response } from 'express';
import {
  type DocumentType,
  type DocumentVisibility,
  PublicDocumentCreateSchema,
  PublicDocumentListQuerySchema,
  PublicDocumentParamsSchema,
  type PublicDocument,
} from '@ship/shared';
import { pool } from '../../../db/client.js';
import { createDocumentMutation } from '../../../services/document-mutations/index.js';
import type { DocumentAccessRow } from '../../../services/document-mutations/types.js';
import {
  getDocumentAccessContext,
  visibilityPredicate,
} from '../../../services/document-access.js';
import {
  markPublicApiRoute,
  publicApiAsyncHandler,
  publicApiPrincipalFromRequest,
  requirePublicApiBearer,
} from './middleware.js';
import { sendPublicApiError } from './errors.js';
import {
  accountabilityReadPredicate,
  sendMissingContext,
  sendValidationError,
} from './route-handlers.js';
import {
  publicDocumentsCreateRouteMetadata,
  publicDocumentsGetRouteMetadata,
  publicDocumentsListRouteMetadata,
} from './route-metadata.js';
import {
  decodePublicCursor,
  encodePublicCursor,
  publicListLimitFromQuery,
} from './pagination.js';

type PublicDocumentRow = {
  id: string;
  workspace_id: string;
  document_type: DocumentType;
  title: string;
  parent_id: string | null;
  ticket_number: number | null;
  properties: Record<string, unknown> | null;
  content?: unknown;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  visibility: DocumentVisibility;
};

export const publicDocumentsRouter = Router();

publicDocumentsRouter.get(
  publicDocumentsListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicDocumentsListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicDocumentsListRouteMetadata.path);
    const parsed = PublicDocumentListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error);
      return;
    }

    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const limit = publicListLimitFromQuery(parsed.data.limit);
    const cursor = parsed.data.cursor ? decodePublicCursor(parsed.data.cursor) : null;
    if (parsed.data.cursor && !cursor) {
      sendPublicApiError(res, 400, {
        code: 'validation_failed',
        message: 'Invalid cursor',
        request_id: req.publicApi.requestId,
      });
      return;
    }

    const actor = {
      userId: req.publicApi.userId,
      workspaceId: req.publicApi.workspaceId,
      isSuperAdmin: false,
    };
    const { isAdmin } = await getDocumentAccessContext(actor);
    const params: Array<string | boolean | number> = [
      actor.workspaceId,
      actor.userId,
      isAdmin,
      limit + 1,
    ];
    let typeFilter = '';
    if (parsed.data.type) {
      params.push(parsed.data.type);
      typeFilter = `AND d.document_type = $${params.length}`;
    }
    let cursorFilter = '';
    if (cursor) {
      params.push(cursor.timestamp, cursor.id);
      const timestampParam = params.length - 1;
      const idParam = params.length;
      cursorFilter = `AND (d.created_at < $${timestampParam}::timestamptz OR (d.created_at = $${timestampParam}::timestamptz AND d.id::text < $${idParam}))`;
    }

    const result = await pool.query<PublicDocumentRow>(
      `SELECT d.id, d.workspace_id, d.document_type, d.title, d.parent_id,
              d.ticket_number, d.properties, d.created_at, d.updated_at,
              d.created_by, d.visibility
         FROM documents d
        WHERE d.workspace_id = $1
          AND d.archived_at IS NULL
          AND d.deleted_at IS NULL
          AND ${visibilityPredicate('d', '$2', '$3')}
          AND ${accountabilityReadPredicate('d', '$2', '$3')}
          ${typeFilter}
          ${cursorFilter}
        ORDER BY d.created_at DESC, d.id::text DESC
        LIMIT $4`,
      params
    );

    const rows = result.rows.slice(0, limit);
    const nextRow = result.rows.length > limit ? rows[rows.length - 1] : null;
    res.json({
      data: rows.map(publicDocumentFromRow),
      next_cursor: nextRow
        ? encodePublicCursor({ id: nextRow.id, timestamp: nextRow.created_at.toISOString() })
        : null,
    });
  })
);

publicDocumentsRouter.get(
  publicDocumentsGetRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicDocumentsGetRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicDocumentsGetRouteMetadata.path);
    const parsed = PublicDocumentParamsSchema.safeParse(req.params);
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
    const result = await pool.query<PublicDocumentRow>(
      `SELECT d.id, d.workspace_id, d.document_type, d.title, d.parent_id,
              d.ticket_number, d.properties, d.content, d.created_at, d.updated_at,
              d.created_by, d.visibility
         FROM documents d
        WHERE d.id = $1
          AND d.workspace_id = $2
          AND d.archived_at IS NULL
          AND d.deleted_at IS NULL
          AND ${visibilityPredicate('d', '$3', '$4')}
          AND ${accountabilityReadPredicate('d', '$3', '$4')}`,
      [parsed.data.id, actor.workspaceId, actor.userId, isAdmin]
    );
    const document = result.rows[0];
    if (!document) {
      req.publicApiErrorCode = 'not_found';
      sendPublicApiError(res, 404, {
        code: 'not_found',
        message: 'Document not found',
        request_id: req.publicApi.requestId,
      });
      return;
    }

    res.json(publicDocumentFromRow(document));
  })
);

publicDocumentsRouter.post(
  publicDocumentsCreateRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicDocumentsCreateRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicDocumentsCreateRouteMetadata.path);
    const parsed = PublicDocumentCreateSchema.safeParse(req.body);
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

function publicDocumentFromMutationRow(row: DocumentAccessRow): PublicDocument {
  return publicDocumentFromRow({
    id: row.id,
    workspace_id: row.workspace_id,
    document_type: row.document_type,
    title: row.title,
    parent_id: row.parent_id,
    ticket_number: row.ticket_number,
    properties: row.properties,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    visibility: row.visibility,
  });
}

function publicDocumentFromRow(row: PublicDocumentRow): PublicDocument {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    document_type: row.document_type,
    title: row.title,
    parent_id: row.parent_id,
    ticket_number: row.ticket_number,
    properties: row.properties ?? {},
    ...(row.content !== undefined ? { content: row.content } : {}),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    created_by: row.created_by,
    visibility: row.visibility,
  };
}

function publicErrorCodeForStatus(status: number) {
  if (status === 400) return 'validation_failed';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'server_error';
}
