// Shared SQL fragments and HTTP helpers for public /api/v1 routes (not route dispatch).
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { visibilityPredicate } from '../../../services/document-access.js';
import { sendPublicApiError } from './errors.js';
import { publicApiRequestIdFromRequest } from './middleware.js';

export function sendValidationError(req: Request, res: Response, error: z.ZodError): void {
  req.publicApiErrorCode = 'validation_failed';
  sendPublicApiError(res, 400, {
    code: 'validation_failed',
    message: 'Invalid request',
    details: { fields: error.flatten() },
    request_id: req.publicApi?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req),
  });
}

export function sendInvalidCursorError(req: Request, res: Response): void {
  req.publicApiErrorCode = 'validation_failed';
  sendPublicApiError(res, 400, {
    code: 'validation_failed',
    message: 'Invalid cursor',
    request_id: req.publicApi?.requestId ?? req.publicApiRequestId ?? publicApiRequestIdFromRequest(req),
  });
}

export function sendMissingContext(req: Request, res: Response): void {
  req.publicApiErrorCode = 'server_error';
  sendPublicApiError(res, 500, {
    code: 'server_error',
    message: 'Public API context missing',
    request_id: req.publicApiRequestId ?? 'unknown',
  });
}

export function accountabilityReadPredicate(
  tableAlias: string,
  userIdParam: string,
  isAdminParam: string
): string {
  return `(
    ${tableAlias}.document_type NOT IN ('weekly_plan', 'weekly_retro')
    OR ${isAdminParam} = TRUE
    OR EXISTS (
      SELECT 1
        FROM documents person
       WHERE person.id::text = ${tableAlias}.properties->>'person_id'
         AND person.workspace_id = ${tableAlias}.workspace_id
         AND person.document_type = 'person'
         AND person.archived_at IS NULL
         AND person.deleted_at IS NULL
         AND person.properties->>'user_id' = ${userIdParam}::text
         AND ${visibilityPredicate('person', userIdParam, isAdminParam)}
    )
  )`;
}
