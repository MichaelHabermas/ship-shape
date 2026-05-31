import { Router, type Router as ExpressRouter, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/client.js';
import { isTestEnv } from '../config/runtime.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import { defineRoute } from '../openapi/define-route.js';
import {
  CreateFeedbackRequestSchema,
  FeedbackItemSchema,
  FeedbackIdParamsSchema,
  FeedbackLegacyErrorSchema,
  FeedbackProgramParamsSchema,
  FeedbackProgramPublicSchema,
} from '../openapi/schemas/feedback.js';
import { getActor, getDocumentAccessContext, visibilityPredicate } from '../services/document-access.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { requireFirstRow } from '../utils/query-rows.js';

// Public routes - no auth/CSRF required
export const publicFeedbackRouter: ExpressRouter = Router();

const publicFeedbackSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv() ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback submissions. Please try again later.' },
});

// Protected routes - auth/CSRF required
const router = Router();

type FeedbackRow = {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  ticket_number: number | null;
  program_id?: string | null;
  content: unknown;
  created_at: Date | string;
  updated_at: Date | string;
  created_by: string | null;
  program_name?: string | null;
  program_prefix?: string | null;
  program_color?: string | null;
  created_by_name?: string | null;
};

// Helper to extract feedback from row
function extractFeedbackFromRow(row: FeedbackRow, programPrefix?: string | null) {
  const props = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'triage',
    priority: props.priority || 'medium',
    source: props.source || 'external',
    rejection_reason: props.rejection_reason || null,
    assignee_id: props.assignee_id || null,
    ticket_number: row.ticket_number,
    program_id: row.program_id,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    program_name: row.program_name,
    program_prefix: row.program_prefix || programPrefix,
    program_color: row.program_color,
    created_by_name: row.created_by_name,
    display_id: `#${row.ticket_number}`,
  };
}

// Create feedback - PUBLIC endpoint (no auth required)
// Creates an issue with source='external', state='triage'
publicFeedbackRouter.post(
  '/',
  publicFeedbackSubmitLimiter,
  defineRoute({
    method: 'post',
    path: '/feedback',
    tags: ['Feedback'],
    summary: 'Submit public feedback',
    security: [],
    request: {
      body: CreateFeedbackRequestSchema,
    },
    responses: {
      201: { schema: FeedbackItemSchema, description: 'Feedback created' },
      400: { schema: FeedbackLegacyErrorSchema, description: 'Validation error' },
      404: { schema: FeedbackLegacyErrorSchema, description: 'Program not found' },
      500: { schema: FeedbackLegacyErrorSchema, description: 'Internal server error' },
    },
    validationError: (res, error) => sendValidationError(res, error.zodError),
    handler: async (_req: Request, res: Response, { body }) => {
      try {
        const { title, program_id, submitter_email, content } = body;

        // Verify public feedback is enabled for this workspace-visible program.
        const programResult = await pool.query<{
          id: string;
          workspace_id: string;
          prefix: string | null;
        }>(
          `SELECT id, workspace_id, properties->>'prefix' as prefix
           FROM documents
           WHERE id = $1
             AND document_type = 'program'
             AND visibility = 'workspace'
             AND archived_at IS NULL
             AND deleted_at IS NULL
             AND properties->>'public_feedback_enabled' = 'true'`,
          [program_id]
        );

        if (programResult.rows.length === 0) {
          res.status(404).json({ error: 'Program not found' });
          return;
        }

        const programRow = requireFirstRow(programResult.rows, 'Program not found');
        const workspaceId = programRow.workspace_id;
        const programPrefix = programRow.prefix;

        // Get next ticket number for workspace
        const ticketResult = await pool.query<{ next_number: number }>(
          `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
           FROM documents
           WHERE workspace_id = $1 AND document_type = 'issue'`,
          [workspaceId]
        );
        const ticketNumber = requireFirstRow(ticketResult.rows).next_number;

        // Build properties JSONB - external feedback goes directly to triage
        const properties = {
          state: 'triage',
          priority: 'medium',
          source: 'external',
          submitter_email: submitter_email || null,
          assignee_id: null,
          rejection_reason: null,
        };

        // Create the feedback issue (no created_by for public submissions)
        const result = await pool.query<FeedbackRow>(
          `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, content)
           VALUES ($1, 'issue', $2, $3, $4, $5)
           RETURNING *`,
          [workspaceId, title, JSON.stringify(properties), ticketNumber, content ? JSON.stringify(content) : null]
        );

        const created = requireFirstRow(result.rows);
        const feedbackId = created.id;

        // Create program association via document_associations
        await pool.query(
          `INSERT INTO document_associations (document_id, related_id, relationship_type)
           VALUES ($1, $2, 'program') ON CONFLICT DO NOTHING`,
          [feedbackId, program_id]
        );

        res.status(201).json({ ...extractFeedbackFromRow(created, programPrefix), program_id });
      } catch (err) {
        sendInternalError(res, err, 'Create feedback error');
      }
    },
  })
);

// Get program info for public feedback form (no auth required)
publicFeedbackRouter.get(
  '/program/:programId',
  defineRoute({
    method: 'get',
    path: '/feedback/program/{programId}',
    tags: ['Feedback'],
    summary: 'Get public program info for feedback form',
    security: [],
    request: {
      params: FeedbackProgramParamsSchema,
    },
    responses: {
      200: { schema: FeedbackProgramPublicSchema, description: 'Program metadata' },
      404: { schema: FeedbackLegacyErrorSchema, description: 'Program not found' },
      500: { schema: FeedbackLegacyErrorSchema, description: 'Internal server error' },
    },
    validationError: (res) => {
      res.status(404).json({ error: 'Program not found' });
    },
    handler: async (_req: Request, res: Response, { params }) => {
      try {
        const { programId } = params;

        const result = await pool.query(
          `SELECT id, title as name, properties->>'prefix' as prefix, properties->>'color' as color
           FROM documents
           WHERE id = $1
             AND document_type = 'program'
             AND visibility = 'workspace'
             AND archived_at IS NULL
             AND deleted_at IS NULL
             AND properties->>'public_feedback_enabled' = 'true'`,
          [programId]
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Program not found' });
          return;
        }

        res.json(result.rows[0]);
      } catch (err) {
        sendInternalError(res, err, 'Get program for feedback error');
      }
    },
  })
);

// Get single feedback item
router.get(
  '/:id',
  authMiddleware,
  defineRoute({
    method: 'get',
    path: '/feedback/{id}',
    tags: ['Feedback'],
    summary: 'Get feedback by ID',
    request: {
      params: FeedbackIdParamsSchema,
    },
    responses: {
      200: { schema: FeedbackItemSchema, description: 'Feedback details' },
      404: { schema: FeedbackLegacyErrorSchema, description: 'Feedback not found' },
    },
    handler: async (req, res, { params }) => {
      try {
        const { id } = params;
        const { userId, workspaceId } = getAuthenticatedRouteContext(req);
        const actor = getActor(req);
        const { isAdmin } = await getDocumentAccessContext(actor);

        const result = await pool.query(
          `SELECT d.id, d.title, d.properties, d.ticket_number,
              prog_da.related_id as program_id,
              d.content, d.created_at, d.updated_at, d.created_by,
              p.title as program_name,
              p.properties->>'prefix' as program_prefix,
              p.properties->>'color' as program_color,
              creator.name as created_by_name
       FROM documents d
       LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
       LEFT JOIN documents p ON prog_da.related_id = p.id AND p.document_type = 'program'
       LEFT JOIN users creator ON d.created_by = creator.id
       WHERE d.id = $1
         AND d.workspace_id = $2
         AND d.document_type = 'issue'
         AND d.properties->>'source' = 'external'
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND ${visibilityPredicate('d', '$3', '$4')}`,
          [id, workspaceId, userId, isAdmin]
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: 'Feedback not found' });
          return;
        }

        res.json(extractFeedbackFromRow(result.rows[0] as FeedbackRow));
      } catch (err) {
        sendInternalError(res, err, 'Get feedback error');
      }
    },
  })
);

// Note: Accept and reject actions are now handled via /api/issues/:id/accept and /api/issues/:id/reject

export default router;
