// FleetGraph routes expose visible findings, bounded on-demand graph actions, and gated manual runs.
import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from 'express';
import { z } from '../openapi/registry.js';
import { authMiddleware } from '../middleware/auth.js';
import { defineRoute } from '../openapi/define-route.js';
import { fleetGraphConfig } from '../config/fleetgraph.js';
import { principalFromRequest } from '../security/principal.js';
import { authorizeRequest } from '../security/route-capability.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendLegacyError } from '../utils/route-http.js';
import type { FleetGraphFindingResponse, FleetGraphNotificationResponse } from '@ship/shared';
import {
  FleetGraphFindingsListResponseSchema,
  FleetGraphBlastRadiusResponseSchema,
  FleetGraphNotificationsListResponseSchema,
  FleetGraphChangeSummaryResponseSchema,
  FleetGraphManualRunResponseSchema,
  FleetGraphReviewerChainResponseSchema,
  FleetGraphReviewerChainsResponseSchema,
  FleetGraphReviewerProofRequestSchema,
  FleetGraphReviewerProofResponseSchema,
  FleetGraphReviewerRepairResponseSchema,
  FleetGraphReviewerScenarioResponseSchema,
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
import { getFleetGraphBlastRadius } from '../fleetgraph/blast-radius.js';
import { runFleetGraph } from '../fleetgraph/core.js';
import { isUtcCalendarDate, parseUtcCalendarDate } from '../fleetgraph/date.js';
import { visibleOutputForFinding } from '../fleetgraph/evidence.js';
import { runFleetGraphManualTick } from '../fleetgraph/execution/manual-run.js';
import { runFleetGraphWorkerTick } from '../fleetgraph/execution/worker.js';
import {
  listFleetGraphFindingsForSource,
  listFleetGraphFindingsByIds,
  listFleetGraphNotificationFindings,
  markFleetGraphNotificationRead,
  markVisibleFleetGraphNotificationsRead,
} from '../fleetgraph/persistence.js';
import {
  fleetGraphReviewerProofEnabled,
  generateFleetGraphReviewerProof,
  getFleetGraphReviewerChain,
  listFleetGraphReviewerChains,
  recordFleetGraphReviewerChatMutationProof,
  repairFleetGraphReviewerProof,
  ReviewerProofCommandError,
  runFleetGraphReviewerWeekBlockerScenario,
  runFleetGraphReviewerWorkerTick,
  sourceSnapshotForReviewerChat,
} from '../fleetgraph/reviewer-proof/index.js';
import { UuidSchema, ErrorResponseSchema, ApiErrorResponseSchema } from '../openapi/schemas/common.js';

const router: ExpressRouter = Router();

const findingsQuerySchema = z.object({
  sourceIssueId: UuidSchema.optional(),
  sourceSprintId: UuidSchema.optional(),
}).refine((query) => query.sourceIssueId || query.sourceSprintId, {
  message: 'sourceIssueId or sourceSprintId is required',
});

const notificationsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(99).optional() });

const findingParamsSchema = z.object({ findingId: UuidSchema });

const markNotificationsReadBodySchema = z.object({
  findingIds: z.array(UuidSchema).min(1).max(99),
});

const markNotificationsReadResponseSchema = z.object({
  success: z.literal(true),
  markedRead: z.number().int().nonnegative(),
}).openapi('FleetGraphMarkNotificationsReadResponse');

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

const reviewerChainsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

const reviewerChainParamsSchema = z.object({
  chainId: UuidSchema,
});

const reviewerScenarioBodySchema = z.object({
  triggerWorker: z.boolean().optional(),
  freshRun: z.boolean().optional(),
});

const reviewerRepairBodySchema = z.object({
  chainId: UuidSchema,
});

function testFleetGraphTriggerEnabled(): boolean {
  return process.env.NODE_ENV === 'test';
}

async function requireWorkspaceAdminForFleetGraph(req: Request, res: Response): Promise<boolean> {
  const adminDecision = await authorizeRequest(req, { resource: 'workspace', action: 'admin' });
  if (adminDecision.allowed) return true;

  sendLegacyError(res, 403, 'Workspace admin access required');
  return false;
}

async function requireInteractiveReviewerAdmin(req: Request, res: Response): Promise<boolean> {
  const principal = principalFromRequest(req);
  if (principal.kind !== 'session') {
    sendLegacyError(res, 403, 'Interactive reviewer session required');
    return false;
  }
  return requireWorkspaceAdminForFleetGraph(req, res);
}

function requireReviewerProofEnabled(res: Response): boolean {
  if (fleetGraphReviewerProofEnabled()) return true;
  sendLegacyError(res, 403, 'FleetGraph reviewer proof controls are disabled');
  return false;
}

async function actorVisibleFindingIds(input: {
  workspaceId: string;
  principal: ReturnType<typeof principalFromRequest>;
  findingIds: string[];
}): Promise<string[]> {
  const findings = await listFleetGraphFindingsByIds({
    workspaceId: input.workspaceId,
    findingIds: input.findingIds,
  });
  const visible = await Promise.all(findings.map(async (finding) => {
    const { output } = await visibleOutputForFinding({
      principal: input.principal,
      workspaceId: input.workspaceId,
      finding,
    });
    return output.noSafeOutput ? null : finding.id;
  }));
  return visible.filter((findingId): findingId is string => findingId !== null);
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
      const { workspaceId, userId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const findings = await listFleetGraphNotificationFindings({
        workspaceId,
        userId,
        limit: parsed.query.limit,
      });
      const notifications: FleetGraphNotificationResponse[] = [];
      for (const finding of findings) {
        const { output } = await visibleOutputForFinding({ principal, workspaceId, finding });
        if (!output.noSafeOutput) {
          notifications.push(fleetGraphNotificationResponse({ finding, visibleOutput: output }));
        }
        if (notifications.length >= (parsed.query.limit ?? 25)) break;
      }

      res.json({ notifications });
    } catch (err) {
      sendInternalError(res, err, 'List FleetGraph notifications error');
    }
  },
}));

router.get('/findings/:findingId/blast-radius-map', authMiddleware, defineRoute({
  method: 'get',
  path: '/fleetgraph/findings/{findingId}/blast-radius-map',
  tags: ['FleetGraph'],
  summary: 'Map the visible organizational blast radius for a FleetGraph finding',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: findingParamsSchema },
  responses: {
    200: { schema: FleetGraphBlastRadiusResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    404: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const blastRadius = await getFleetGraphBlastRadius({
        workspaceId,
        principal,
        findingId: parsed.params.findingId,
      });
      if (!blastRadius) {
        sendLegacyError(res, 404, 'FleetGraph finding not found');
        return;
      }
      res.json(blastRadius);
    } catch (err) {
      sendInternalError(res, err, 'Get FleetGraph blast radius map error');
    }
  },
}));

router.post('/notifications/read', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/notifications/read',
  tags: ['FleetGraph'],
  summary: 'Mark visible FleetGraph notifications as read for the current user',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: markNotificationsReadBodySchema },
  responses: {
    200: { schema: markNotificationsReadResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId, userId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const findingIds = await actorVisibleFindingIds({
        workspaceId,
        principal,
        findingIds: parsed.body.findingIds,
      });
      const markedRead = await markVisibleFleetGraphNotificationsRead({
        workspaceId,
        userId,
        findingIds,
      });
      res.json({ success: true, markedRead });
    } catch (err) {
      sendInternalError(res, err, 'Mark FleetGraph notifications read error');
    }
  },
}));

router.post('/findings/:findingId/read', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/findings/{findingId}/read',
  tags: ['FleetGraph'],
  summary: 'Mark one FleetGraph notification as read for the current user',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: findingParamsSchema },
  responses: {
    200: { schema: markNotificationsReadResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      const { workspaceId, userId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const [visibleFindingId] = await actorVisibleFindingIds({
        workspaceId,
        principal,
        findingIds: [parsed.params.findingId],
      });
      const markedRead = visibleFindingId ? await markFleetGraphNotificationRead({
        workspaceId,
        userId,
        findingId: visibleFindingId,
      }) : 0;
      res.json({ success: true, markedRead });
    } catch (err) {
      sendInternalError(res, err, 'Mark FleetGraph notification read error');
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
      const beforeMutation = await sourceSnapshotForReviewerChat({
        workspaceId,
        findingId: parsed.body.context.findingId,
        documentId: parsed.body.context.documentId,
      });
      const result = await runFleetGraph({
        workspaceId,
        principal,
        mode: 'on_demand',
        trigger: {
          type: 'context_chat',
          prompt: parsed.body.prompt,
          context: parsed.body.context,
          ...(parsed.body.history ? { history: parsed.body.history } : {}),
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
      if (result.run.trigger_reason === 'reviewer-source-mutation-proof') {
        const afterMutation = await sourceSnapshotForReviewerChat({
          workspaceId,
          findingId: parsed.body.context.findingId,
          documentId: parsed.body.context.documentId,
        });
        await recordFleetGraphReviewerChatMutationProof({
          workspaceId,
          before: beforeMutation,
          after: afterMutation,
          chatRunId: result.run.id,
        });
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

router.get('/reviewer/chains', authMiddleware, defineRoute({
  method: 'get',
  path: '/fleetgraph/reviewer/chains',
  tags: ['FleetGraph'],
  summary: 'List live FleetGraph reviewer proof chains',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { query: reviewerChainsQuerySchema },
  responses: {
    200: { schema: FleetGraphReviewerChainsResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      if (!requireReviewerProofEnabled(res)) return;
      if (!(await requireInteractiveReviewerAdmin(req, res))) return;

      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      res.json(await listFleetGraphReviewerChains({
        workspaceId,
        principal,
        limit: parsed.query.limit,
      }));
    } catch (err) {
      sendInternalError(res, err, 'List FleetGraph reviewer chains error');
    }
  },
}));

router.get('/reviewer/chains/:chainId', authMiddleware, defineRoute({
  method: 'get',
  path: '/fleetgraph/reviewer/chains/{chainId}',
  tags: ['FleetGraph'],
  summary: 'Get one live FleetGraph reviewer proof chain',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { params: reviewerChainParamsSchema },
  responses: {
    200: { schema: FleetGraphReviewerChainResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    404: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      if (!requireReviewerProofEnabled(res)) return;
      if (!(await requireInteractiveReviewerAdmin(req, res))) return;

      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const chain = await getFleetGraphReviewerChain({
        workspaceId,
        principal,
        chainId: parsed.params.chainId,
      });
      if (!chain) {
        sendLegacyError(res, 404, 'FleetGraph reviewer chain not found');
        return;
      }
      res.json({ chain });
    } catch (err) {
      sendInternalError(res, err, 'Get FleetGraph reviewer chain error');
    }
  },
}));

router.post('/reviewer/scenarios/week-blocker', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/reviewer/scenarios/week-blocker',
  tags: ['FleetGraph'],
  summary: 'Create or reset the live week-blocker reviewer scenario',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: reviewerScenarioBodySchema },
  responses: {
    200: { schema: FleetGraphReviewerScenarioResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    403: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      if (!requireReviewerProofEnabled(res)) return;
      if (!(await requireInteractiveReviewerAdmin(req, res))) return;

      const { workspaceId, userId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      res.json(await runFleetGraphReviewerWeekBlockerScenario({
        workspaceId,
        userId,
        principal,
        triggerWorker: parsed.body.triggerWorker,
        freshRun: parsed.body.freshRun,
      }));
    } catch (err) {
      sendInternalError(res, err, 'Run FleetGraph reviewer week-blocker scenario error');
    }
  },
}));

router.post('/reviewer/worker-tick', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/reviewer/worker-tick',
  tags: ['FleetGraph'],
  summary: 'Trigger one deployed-safe FleetGraph reviewer worker tick',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: { schema: z.object({ triggered: z.literal(true) }) },
    403: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response) {
    try {
      if (!requireReviewerProofEnabled(res)) return;
      if (!(await requireInteractiveReviewerAdmin(req, res))) return;

      const { workspaceId } = getAuthenticatedRouteContext(req);
      res.json(await runFleetGraphReviewerWorkerTick({ workspaceId }));
    } catch (err) {
      sendInternalError(res, err, 'Trigger FleetGraph reviewer worker tick error');
    }
  },
}));

router.post('/reviewer/repair', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/reviewer/repair',
  tags: ['FleetGraph'],
  summary: 'Repair safe missing FleetGraph reviewer proof gates',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: reviewerRepairBodySchema },
  responses: {
    200: { schema: FleetGraphReviewerRepairResponseSchema },
    400: { schema: ApiErrorResponseSchema },
    403: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      if (!requireReviewerProofEnabled(res)) return;
      if (!(await requireInteractiveReviewerAdmin(req, res))) return;

      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      res.json(await repairFleetGraphReviewerProof({
        workspaceId,
        principal,
        chainId: parsed.body.chainId,
      }));
    } catch (err) {
      sendInternalError(res, err, 'Repair FleetGraph reviewer proof error');
    }
  },
}));

router.post('/reviewer/proof', authMiddleware, defineRoute({
  method: 'post',
  path: '/fleetgraph/reviewer/proof',
  tags: ['FleetGraph'],
  summary: 'Generate the static FleetGraph proof packet from the live verifier',
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: FleetGraphReviewerProofRequestSchema },
  responses: {
    200: { schema: FleetGraphReviewerProofResponseSchema },
    403: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response, parsed) {
    try {
      if (!requireReviewerProofEnabled(res)) return;
      if (!(await requireInteractiveReviewerAdmin(req, res))) return;

      const { workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      res.json(await generateFleetGraphReviewerProof({
        workspaceId,
        principal,
        chainId: parsed.body.chainId,
      }));
    } catch (err) {
      if (err instanceof ReviewerProofCommandError) {
        res.status(500).json({
          error: 'Failed to generate proof packet',
          detail: err.message,
          command: err.command,
          outputTail: err.outputTail,
        });
        return;
      }
      sendInternalError(res, err, 'Generate FleetGraph reviewer proof error');
    }
  },
}));

router.post('/test/worker-tick', (req: Request, res: Response, next: NextFunction) => {
  if (!testFleetGraphTriggerEnabled()) {
    sendLegacyError(res, 404, 'Not found');
    return;
  }
  next();
}, authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!(await requireWorkspaceAdminForFleetGraph(req, res))) return;

    const { workspaceId } = getAuthenticatedRouteContext(req);
    const summary = await runFleetGraphWorkerTick({
      workspaceIds: [workspaceId],
      instanceId: `fleetgraph-test-${workspaceId}`,
    });

    res.json({
      success: true,
      eventCount: summary.eventCount,
      detectorDecisionCount: summary.detectorDecisionCount,
      resultCount: summary.resultCount,
      attentionEventIds: Array.isArray(summary.auditMetadata.attentionEventIds)
        ? summary.auditMetadata.attentionEventIds
        : [],
    });
  } catch (err) {
    sendInternalError(res, err, 'FleetGraph test worker tick error');
  }
});

export default router;
