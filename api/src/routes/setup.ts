import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { WELCOME_DOCUMENT_TITLE, WELCOME_DOCUMENT_CONTENT } from '../db/welcomeDocument.js';
import { defineRoute } from '../openapi/define-route.js';
import { ApiErrorResponseSchema } from '../openapi/schemas/common.js';
import {
  SetupInitializeRequestSchema,
  SetupInitializeResponseSchema,
  SetupStatusResponseSchema,
} from '../openapi/schemas/setup.js';

const router = Router();

router.get(
  '/status',
  defineRoute({
    method: 'get',
    path: '/setup/status',
    tags: ['Setup'],
    summary: 'Check whether initial setup is required',
    security: [],
    responses: {
      200: { schema: SetupStatusResponseSchema, description: 'Setup status' },
      500: { schema: ApiErrorResponseSchema, description: 'Internal server error' },
    },
    handler: async (_req, res) => {
      try {
        const result = await pool.query('SELECT COUNT(*) as count FROM users');
        const userCount = parseInt(result.rows[0].count);

        res.json({
          success: true,
          data: {
            needsSetup: userCount === 0,
          },
        });
      } catch (error) {
        console.error('Setup status error:', error);
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Failed to check setup status',
          },
        });
      }
    },
  })
);

router.post(
  '/initialize',
  defineRoute({
    method: 'post',
    path: '/setup/initialize',
    tags: ['Setup'],
    summary: 'Create first super admin and workspace',
    security: [],
    request: {
      body: SetupInitializeRequestSchema,
    },
    responses: {
      201: { schema: SetupInitializeResponseSchema, description: 'Setup complete' },
      400: { schema: ApiErrorResponseSchema, description: 'Validation error' },
      403: { schema: ApiErrorResponseSchema, description: 'Setup already completed' },
      500: { schema: ApiErrorResponseSchema, description: 'Internal server error' },
    },
    handler: async (_req, res, { body }) => {
      const { email, password, name } = body;

      if (password.length < 8) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Password must be at least 8 characters',
          },
        });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('ship_setup_initialize'))`);

        const countResult = await client.query('SELECT COUNT(*) as count FROM users');
        const userCount = parseInt(countResult.rows[0].count);

        if (userCount > 0) {
          await client.query('ROLLBACK');
          res.status(HTTP_STATUS.FORBIDDEN).json({
            success: false,
            error: {
              code: ERROR_CODES.FORBIDDEN,
              message: 'Setup has already been completed',
            },
          });
          return;
        }

        const workspaceResult = await client.query(
          `INSERT INTO workspaces (name)
           VALUES ($1)
           RETURNING id`,
          [`${name}'s Workspace`]
        );
        const workspaceId = workspaceResult.rows[0].id;

        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, name, is_super_admin, last_workspace_id)
           VALUES ($1, $2, $3, true, $4)
           RETURNING id, email, name, is_super_admin`,
          [email.toLowerCase(), passwordHash, name, workspaceId]
        );
        const user = userResult.rows[0];

        await client.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'admin')`,
          [workspaceId, user.id]
        );

        await client.query(
          `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
           VALUES ($1, 'person', $2, $3, $4)`,
          [workspaceId, name, JSON.stringify({ user_id: user.id, email: email.toLowerCase() }), user.id]
        );

        await client.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
           VALUES ($1, 'wiki', $2, $3, $4)`,
          [workspaceId, WELCOME_DOCUMENT_TITLE, JSON.stringify(WELCOME_DOCUMENT_CONTENT), user.id]
        );

        await client.query('COMMIT');

        console.log(`Initial setup complete: ${email} is now super admin`);

        res.status(HTTP_STATUS.CREATED).json({
          success: true,
          data: {
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              isSuperAdmin: user.is_super_admin,
            },
            message: 'Setup complete! You can now log in.',
          },
        });
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback errors after a failed transaction or closed client.
        }
        console.error('Setup initialization error:', error);
        res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Failed to complete setup',
          },
        });
      } finally {
        client.release();
      }
    },
  })
);

export default router;
