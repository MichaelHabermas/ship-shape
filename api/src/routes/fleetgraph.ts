// FleetGraph routes expose visible findings, bounded on-demand graph actions, and gated manual runs.
import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { z } from '../openapi/registry.js';
import { authMiddleware } from '../middleware/auth.js';
import { defineRoute } from '../openapi/define-route.js';
import { fleetGraphConfig } from '../config/fleetgraph.js';
import { principalFromRequest } from '../security/principal.js';
import { authorizeRequest } from '../security/route-capability.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendLegacyError } from '../utils/route-http.js';
import {
  FleetGraphFindingsListResponseSchema,
  FleetGraphNotificationsListResponseSchema,
  type FleetGraphFindingResponse,
  type FleetGraphNotificationResponse,
  FleetGraphChangeSummaryResponseSchema,
  FleetGraphManualRunResponseSchema,
  FleetGraphRunResponseSchema,
  FleetGraphChatRequestSchema,
  FleetGraphChatResponseSchema,
  fleetGraphFindingResponse,
  fleetGraphChatResponse,
  fleetGraphNotificationResponse,
  fleetGraphManualRunResultResponse,
  sendFleetGraphChangeSummaryResponse,
  sendFleetGraphRunResponse,
} from '../fleetgraph/api-contract.js';
import { runFleetGraph } from '../fleetgraph/core.js';
import { isUtcCalendarDate, parseUtcCalendarDate } from '../fleetgraph/date.js';
import { visibleOutputForFinding } from '../fleetgraph/evidence.js';
import { runFleetGraphManualTick } from '../fleetgraph/execution/manual-run.js';
import { listFleetGraphFindingsForSource, listFleetGraphNotificationFindings } from '../fleetgraph/persistence.js';
import { UuidSchema, ErrorResponseSchema, ApiErrorResponseSchema } from '../openapi/schemas/common.js';

const router: ExpressRouter = Router();

const findingsQuerySchema = z.object({
  sourceIssueId: UuidSchema.optional(),
  sourceSprintId: UuidSchema.optional(),
}).refine((query) => query.sourceIssueId || query.sourceSprintId, {
  message: 'sourceIssueId or sourceSprintId is required',
});

const notificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(99).optional(),
});

const findingParamsSchema = z.object({
  findingId: UuidSchema,
});

const refineBodySchema = z.object({
  instruction: z.string().min(1).max(2_000),
});

const manualRunBodySchema = z.object({
  today: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isUtcCalendarDate, 'today must be a real YYYY-MM-DD calendar date')
    .optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

async function requireWorkspaceAdminForFleetGraph(req: Request, res: Response): Promise<boolean> {
  const adminDecision = await authorizeRequest(req, { resource: 'workspace', action: 'admin' });
  if (adminDecision.allowed) return true;

  sendLegacyError(res, 403, 'Workspace admin access required');
  return false;
}

router.get('/findings', authMiddleware, defineRoute({
  method: 'get',
  path: '/fleetgraph/findings',
  tags: ['FleetGraph'],
  summary: 'List visible FleetGraph findings for a source issue or sprint',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { query: findingsQuerySchema },
  responses: {
    200: { schema: FleetGraphFindingsListResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const findings = await listFleetGraphFindingsForSource({
        workspaceId,
        sourceIssueId: parsed.query.sourceIssueId,
        sourceSprintId: parsed.query.sourceSprintId,
      });
      const visibleFindings = (await Promise.all(findings.map(async (finding) => {
        const { output } = await visibleOutputForFinding({ principal, workspaceId, finding });
        if (output.noSafeOutput) return null;
        return fleetGraphFindingResponse({ ...finding, visibleOutput: output });
      }))).filter((finding): finding is FleetGraphFindingResponse => finding !== null);

      res.json({ findings: visibleFindings });
    } catch (err) {
      sendInternalError(res, err, 'List FleetGraph findings error');
    }
  },
}));

router.get('/notifications', authMiddleware, defineRoute({
  method: 'get',
  path: '/fleetgraph/notifications',
  tags: ['FleetGraph'],
  summary: 'List active FleetGraph notifications derived from visible open findings',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { query: notificationsQuerySchema },
  responses: {
    200: { schema: FleetGraphNotificationsListResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const findings = await listFleetGraphNotificationFindings({
        workspaceId,
        limit: parsed.query.limit,
      });
      const notifications = (await Promise.all(findings.map(async (finding) => {
        const { output } = await visibleOutputForFinding({ principal, workspaceId, finding });
        if (output.noSafeOutput) return null;
        return fleetGraphNotificationResponse({ finding, visibleOutput: output });
      })))
        .filter((notification): notification is FleetGraphNotificationResponse => notification !== null)
        .slice(0, parsed.query.limit ?? 25);

      res.json({ notifications });
    } catch (err) {
      sendInternalError(res, err, 'List FleetGraph notifications error');
    }
  },
}));

router.post('/findings/:findingId/changes', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/findings/{findingId}/changes',
  tags: ['FleetGraph'],
  summary: 'Summarize meaningful changes since the previous FleetGraph run',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: findingParamsSchema },
  responses: {
    200: { schema: FleetGraphChangeSummaryResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    403: { schema: ErrorResponseSchema },
    404: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const result = await runFleetGraph({
        workspaceId,
        principal,
        mode: 'on_demand',
        trigger: { type: 'summarize_changes', findingId: parsed.params.findingId },
      });
      sendFleetGraphChangeSummaryResponse(res, result);
    } catch (err) {
      sendInternalError(res, err, 'Summarize FleetGraph changes error');
    }
  },
}));

router.post('/findings/:findingId/explain', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/findings/{findingId}/explain',
  tags: ['FleetGraph'],
  summary: 'Explain an existing FleetGraph finding using visible evidence',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: findingParamsSchema },
  responses: {
    200: { schema: FleetGraphRunResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    403: { schema: ErrorResponseSchema },
    404: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const result = await runFleetGraph({
        workspaceId,
        principal,
        mode: 'on_demand',
        trigger: { type: 'explain_finding', findingId: parsed.params.findingId },
      });
      sendFleetGraphRunResponse(res, result);
    } catch (err) {
      sendInternalError(res, err, 'Explain FleetGraph finding error');
    }
  },
}));

router.post('/findings/:findingId/refine', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/findings/{findingId}/refine',
  tags: ['FleetGraph'],
  summary: 'Refine a FleetGraph draft without mutating Ship source data',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: findingParamsSchema, body: refineBodySchema },
  responses: {
    200: { schema: FleetGraphRunResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    403: { schema: ErrorResponseSchema },
    404: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const result = await runFleetGraph({
        workspaceId,
        principal,
        mode: 'on_demand',
        trigger: {
          type: 'refine_draft',
          findingId: parsed.params.findingId,
          instruction: parsed.body.instruction,
        },
      });
      sendFleetGraphRunResponse(res, result);
    } catch (err) {
      sendInternalError(res, err, 'Refine FleetGraph finding error');
    }
  },
}));

router.post('/findings/:findingId/dismiss', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/findings/{findingId}/dismiss',
  tags: ['FleetGraph'],
  summary: 'Dismiss a FleetGraph finding without mutating Ship source data',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: findingParamsSchema },
  responses: {
    200: { schema: FleetGraphRunResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    403: { schema: ErrorResponseSchema },
    404: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId, userId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      if (!(await requireWorkspaceAdminForFleetGraph(req, res))) return;

      const result = await runFleetGraph({
        workspaceId,
        principal,
        mode: 'on_demand',
        trigger: {
          type: 'dismiss_finding',
          findingId: parsed.params.findingId,
          dismissedBy: userId,
        },
      });
      sendFleetGraphRunResponse(res, result);
    } catch (err) {
      sendInternalError(res, err, 'Dismiss FleetGraph finding error');
    }
  },
}));

router.post('/chat', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/chat',
  tags: ['FleetGraph'],
  summary: 'Answer a bounded FleetGraph chat prompt from the current context',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: FleetGraphChatRequestSchema },
  responses: {
    200: { schema: FleetGraphChatResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    403: { schema: ErrorResponseSchema },
    404: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const result = await runFleetGraph({
        workspaceId,
        principal,
        mode: 'on_demand',
        trigger: {
          type: 'context_chat',
          prompt: parsed.body.prompt,
          context: parsed.body.context,
        },
        triggerReason: 'context-chat',
      });

      if (result.visibleOutput?.noSafeOutput) {
        sendLegacyError(res, 404, 'FleetGraph context not found');
        return;
      }
      if (result.decision === 'error') {
        sendLegacyError(res, 500, 'FleetGraph chat failed');
        return;
      }

      res.json(fleetGraphChatResponse({ result, context: parsed.body.context }));
    } catch (err) {
      sendInternalError(res, err, 'FleetGraph chat error');
    }
  },
}));

router.post('/manual-run', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/manual-run',
  tags: ['FleetGraph'],
  summary: 'Run one gated FleetGraph detector-to-graph tick for validation',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: manualRunBodySchema },
  responses: {
    200: { schema: FleetGraphManualRunResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    403: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      if (!fleetGraphConfig().manualRunApiEnabled) {
        sendLegacyError(res, 403, 'FleetGraph manual run API is disabled');
        return;
      }

      if (!(await requireWorkspaceAdminForFleetGraph(req, res))) return;

      const summary = await runFleetGraphManualTick({
        workspaceId,
        principal,
        today: parsed.body.today ? parseUtcCalendarDate(parsed.body.today) ?? undefined : undefined,
        limit: parsed.body.limit,
      });
      const results = summary.results.map(fleetGraphManualRunResultResponse);
      const detectorDecisions = summary.detectorDecisions === 0
        ? 0
        : results.filter((result) => result.findingId || result.visibleOutput).length;

      res.json({
        mode: summary.mode,
        detectorDecisions,
        results,
      });
    } catch (err) {
      sendInternalError(res, err, 'FleetGraph manual run error');
    }
  },
}));

export default router;
