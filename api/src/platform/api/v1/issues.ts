// Public issue routes expose document-backed work items through OAuth issue scopes.
import { Router, type Request, type Response } from 'express';
import {
  PublicIssueCreateSchema,
  PublicIssueExternalLinkInputSchema,
  PublicIssueExternalLinkSchema,
  PublicIssueListQuerySchema,
  PublicIssueParamsSchema,
  PublicIssueIncompleteChildrenDetailsSchema,
  PublicIssueUpdateSchema,
  asIssueState,
  type PublicIssueExternalLink,
  type PublicIssueExternalLinkInput,
  type PublicIssueIncompleteChildrenDetails,
} from '@ship/shared';
import { pool } from '../../../db/client.js';
import {
  createIssueMutation,
  updateIssueMutation,
} from '../../../services/issue-mutations/index.js';
import { guardIssueMutation } from '../../../services/issue-mutation-guards.js';
import { logDocumentChange } from '../../../utils/document-crud.js';
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
} from './public-sql-helpers.js';
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
  publicIssueExternalLinksUpsertRouteMetadata,
} from './route-metadata.js';
import { parsePublicRouteBody, parsePublicRouteParams, parsePublicRouteQuery } from './route-request.js';

export const publicIssuesRouter = Router();

publicIssuesRouter.get(
  publicIssuesListRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicIssuesListRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicIssuesListRouteMetadata.path);
    const parsed = parsePublicRouteQuery(
      publicIssuesListRouteMetadata.operationId,
      req.query,
      PublicIssueListQuerySchema
    );
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
    const parsed = parsePublicRouteParams(
      publicIssuesGetRouteMetadata.operationId,
      req.params,
      PublicIssueParamsSchema
    );
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
    const parsed = parsePublicRouteBody(
      publicIssuesCreateRouteMetadata.operationId,
      req.body,
      PublicIssueCreateSchema
    );
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

publicIssuesRouter.post(
  publicIssueExternalLinksUpsertRouteMetadata.handlerMountPath,
  requirePublicApiBearer(publicIssueExternalLinksUpsertRouteMetadata.requiredScopes),
  publicApiAsyncHandler(async (req: Request, res: Response): Promise<void> => {
    markPublicApiRoute(req, publicIssueExternalLinksUpsertRouteMetadata.path);
    const params = parsePublicRouteParams(
      publicIssueExternalLinksUpsertRouteMetadata.operationId,
      req.params,
      PublicIssueParamsSchema
    );
    const body = parsePublicRouteBody(
      publicIssueExternalLinksUpsertRouteMetadata.operationId,
      req.body,
      PublicIssueExternalLinkInputSchema
    );
    if (!params.success) {
      sendValidationError(req, res, params.error);
      return;
    }
    if (!body.success) {
      sendValidationError(req, res, body.error);
      return;
    }
    if (!req.publicApi) {
      sendMissingContext(req, res);
      return;
    }

    const client = await pool.connect();
    try {
      const denied = await guardIssueMutation(client, publicApiPrincipalFromRequest(req), {
        action: 'write',
        documentId: params.data.id,
        expectedType: 'issue',
      });
      if (denied) {
        sendMutationError(req, res, denied.status, denied.body);
        return;
      }

      await client.query('BEGIN');
      const result = await client.query<IssueExternalLinksRow>(
        `SELECT properties
           FROM documents
          WHERE id = $1
            AND workspace_id = $2
            AND document_type = 'issue'
          FOR UPDATE`,
        [params.data.id, req.publicApi.workspaceId]
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        req.publicApiErrorCode = 'not_found';
        sendPublicApiError(res, 404, {
          code: 'not_found',
          message: 'Issue not found',
          request_id: req.publicApi.requestId,
        });
        return;
      }

      const properties = recordFromJson(row.properties);
      const currentLinks = externalLinksFromProperties(properties);
      const upsert = upsertExternalLink(currentLinks, body.data, new Date().toISOString());
      if (upsert.changed) {
        const nextProperties = {
          ...properties,
          external_links: upsert.links,
        };
        await logDocumentChange(
          params.data.id,
          'external_links',
          currentLinks.length > 0 ? JSON.stringify(currentLinks) : null,
          JSON.stringify(upsert.links),
          req.publicApi.userId,
          undefined,
          client
        );
        await client.query(
          `UPDATE documents
              SET properties = $3,
                  updated_at = NOW()
            WHERE id = $1
              AND workspace_id = $2`,
          [params.data.id, req.publicApi.workspaceId, JSON.stringify(nextProperties)]
        );
      }
      await client.query('COMMIT');
      res.status(upsert.created ? 201 : 200).json(upsert.link);
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
    const params = parsePublicRouteParams(
      publicIssuesUpdateRouteMetadata.operationId,
      req.params,
      PublicIssueParamsSchema
    );
    const body = parsePublicRouteBody(
      publicIssuesUpdateRouteMetadata.operationId,
      req.body,
      PublicIssueUpdateSchema
    );
    if (!params.success) {
      sendValidationError(req, res, params.error);
      return;
    }
    if (!body.success) {
      sendValidationError(req, res, body.error);
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

type IssueExternalLinksRow = {
  properties: Record<string, unknown> | null;
};

function recordFromJson(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function externalLinksFromProperties(props: Record<string, unknown>): PublicIssueExternalLink[] {
  const rawLinks = props.external_links;
  if (!Array.isArray(rawLinks)) return [];
  return rawLinks.flatMap((link) => {
    const parsed = PublicIssueExternalLinkSchema.safeParse(link);
    return parsed.success ? [parsed.data] : [];
  });
}

function upsertExternalLink(
  currentLinks: PublicIssueExternalLink[],
  input: PublicIssueExternalLinkInput,
  now: string
): {
  link: PublicIssueExternalLink;
  links: PublicIssueExternalLink[];
  created: boolean;
  changed: boolean;
} {
  const index = currentLinks.findIndex((link) =>
    link.provider === input.provider && link.external_id === input.external_id
  );
  if (index === -1) {
    const link = PublicIssueExternalLinkSchema.parse({
      ...input,
      created_at: now,
      updated_at: now,
    });
    return {
      link,
      links: [...currentLinks, link],
      created: true,
      changed: true,
    };
  }

  const existing = currentLinks[index];
  if (!existing) throw new Error('External link index disappeared during upsert');
  const changed = externalLinkFieldsChanged(existing, input);
  const link = PublicIssueExternalLinkSchema.parse({
    ...input,
    created_at: existing.created_at,
    updated_at: changed ? now : existing.updated_at,
  });
  const links = currentLinks.map((candidate, candidateIndex) =>
    candidateIndex === index ? link : candidate
  );
  return { link, links, created: false, changed };
}

function externalLinkFieldsChanged(
  existing: PublicIssueExternalLink,
  input: PublicIssueExternalLinkInput
): boolean {
  return (
    existing.kind !== input.kind ||
    existing.url !== input.url ||
    existing.title !== input.title ||
    (existing.status ?? null) !== (input.status ?? null)
  );
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
    req.publicApiErrorCode = 'validation_failed';
    sendPublicApiError(res, status, {
      code: 'validation_failed',
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
