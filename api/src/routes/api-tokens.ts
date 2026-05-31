// Workspace-scoped API token create, list, and revoke routes.
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { requireFirstRow } from '../utils/query-rows.js';
import { authorize } from '../security/capabilities.js';
import { DEFAULT_API_TOKEN_SCOPES, generateApiToken, hashToken } from '../security/tokens.js';
import { principalFromRequest, type ApiTokenScope } from '../security/principal.js';
import { type IdRow } from './route-query-rows.js';

type ApiTokenCreatedRow = {
  id: string;
  name: string;
  token_prefix: string;
  expires_at: Date | string;
  created_at: Date | string;
};

type ApiTokenNameRow = {
  id: string;
  name: string;
};

const router = Router();
export { hashToken };

function denyWorkspaceAdminTokenAction(res: Response, action: 'create' | 'revoke'): void {
  res.status(HTTP_STATUS.FORBIDDEN).json({
    success: false,
    error: {
      code: ERROR_CODES.FORBIDDEN,
      message: `Workspace admin access required to ${action} API tokens`,
    },
  });
}

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  expires_in_days: z.number().int().positive().max(365).optional(),
  scopes: z.array(z.enum([
    'documents:read',
    'documents:write',
    'documents:content',
    'documents:governance',
    'files:read',
    'files:write',
    'collaboration:join',
    'admin:workspace',
  ])).optional(),
});

router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { userId, workspaceId } = getAuthenticatedRouteContext(req);
  const principal = principalFromRequest(req);
  const parseResult = createTokenSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid request',
        details: parseResult.error.flatten(),
      },
    });
    return;
  }

  const { name, expires_in_days } = parseResult.data;
  const scopes = parseResult.data.scopes ?? DEFAULT_API_TOKEN_SCOPES;

  try {
    const capability = await authorize(pool, principal, { resource: 'api_token', action: 'create' });
    if (!capability.allowed) {
      denyWorkspaceAdminTokenAction(res, 'create');
      return;
    }

    const existingResult = await pool.query<IdRow>(
      `SELECT id FROM api_tokens
       WHERE user_id = $1 AND workspace_id = $2 AND name = $3 AND revoked_at IS NULL`,
      [userId, workspaceId, name]
    );

    if (existingResult.rows.length > 0) {
      res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        error: {
          code: ERROR_CODES.ALREADY_EXISTS,
          message: `An active token named "${name}" already exists. Revoke it first or choose a different name.`,
        },
      });
      return;
    }

    const { token, hash, prefix } = generateApiToken();
    const expiresAt = new Date(Date.now() + (expires_in_days ?? 30) * 24 * 60 * 60 * 1000);

    const result = await pool.query<ApiTokenCreatedRow>(
      `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix, expires_at, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, token_prefix, expires_at, created_at`,
      [userId, workspaceId, name, hash, prefix, expiresAt, scopes]
    );
    const createdToken = requireFirstRow(result.rows);

    await logAuditEvent({
      workspaceId,
      actorUserId: userId,
      action: 'api_token.created',
      resourceType: 'api_token',
      resourceId: createdToken.id,
      details: { name, expires_at: expiresAt, scopes },
      req,
    });

    // Return the full token ONLY on creation (never stored or returned again)
    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        id: createdToken.id,
        name: createdToken.name,
        token: token, // ONLY returned here - user must save it
        token_prefix: createdToken.token_prefix,
        scopes,
        expires_at: createdToken.expires_at,
        created_at: createdToken.created_at,
        warning: 'Save this token now. It will not be shown again.',
      },
    });
  } catch (error) {
    console.error('Create API token error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to create API token',
      },
    });
  }
});

router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { userId, workspaceId } = getAuthenticatedRouteContext(req);

  try {
    const result = await pool.query<{
      id: string;
      name: string;
      token_prefix: string;
      scopes: ApiTokenScope[] | null;
      last_used_at: string | Date | null;
      expires_at: string | Date | null;
      revoked_at: string | Date | null;
      created_at: string | Date;
    }>(
      `SELECT id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at
       FROM api_tokens
       WHERE user_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC`,
      [userId, workspaceId]
    );

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        name: row.name,
        token_prefix: row.token_prefix,
        scopes: row.scopes ?? ['legacy:full'],
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        is_active: !row.revoked_at && (!row.expires_at || new Date(row.expires_at) > new Date()),
        revoked_at: row.revoked_at,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    console.error('List API tokens error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list API tokens',
      },
    });
  }
});

router.delete('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { userId, workspaceId } = getAuthenticatedRouteContext(req);
  const principal = principalFromRequest(req);
  const id = String(req.params.id);

  try {
    const capability = await authorize(pool, principal, { resource: 'api_token', action: 'revoke' });
    if (!capability.allowed) {
      denyWorkspaceAdminTokenAction(res, 'revoke');
      return;
    }

    const tokenResult = await pool.query<ApiTokenNameRow>(
      `SELECT id, name FROM api_tokens
       WHERE id = $1 AND user_id = $2 AND workspace_id = $3`,
      [id, userId, workspaceId]
    );

    if (tokenResult.rows.length === 0) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'API token not found',
        },
      });
      return;
    }

    await pool.query(
      `UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1`,
      [id]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: userId,
      action: 'api_token.revoked',
      resourceType: 'api_token',
      resourceId: id,
      details: { name: requireFirstRow(tokenResult.rows).name },
      req,
    });

    res.json({
      success: true,
      data: { message: 'API token revoked' },
    });
  } catch (error) {
    console.error('Revoke API token error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to revoke API token',
      },
    });
  }
});

export default router;
