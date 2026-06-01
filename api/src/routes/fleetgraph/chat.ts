import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { defineRoute } from '../../openapi/define-route.js';
import { fleetGraphConfig } from '../../config/fleetgraph.js';
import { principalFromRequest } from '../../security/principal.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError, sendLegacyError } from '../../utils/route-http.js';
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
  FleetGraphReviewerWorkerTickResponseSchema,
  FleetGraphRunResponseSchema,
  FleetGraphChatRequestSchema,
  FleetGraphChatResponseSchema,
  fleetGraphFindingResponse,
  fleetGraphChatResponse,
  fleetGraphNotificationResponse,
  fleetGraphManualRunResultResponse,
  sendFleetGraphChangeSummaryResponse,
  sendFleetGraphRunResponse,
} from '../../fleetgraph/api-contract.js';
import { getFleetGraphBlastRadius } from '../../fleetgraph/blast-radius.js';
import { runFleetGraph } from '../../fleetgraph/core.js';
import { parseUtcCalendarDate } from '../../fleetgraph/date.js';
import { visibleOutputForFinding } from '../../fleetgraph/evidence.js';
import { runFleetGraphManualTick } from '../../fleetgraph/execution/manual-run.js';
import { runFleetGraphWorkerTick } from '../../fleetgraph/execution/worker.js';
import {
  listFleetGraphFindingsForSource,
  listFleetGraphFindingsByIds,
  listFleetGraphNotificationFindings,
  markFleetGraphNotificationRead,
  markVisibleFleetGraphNotificationsRead,
} from '../../fleetgraph/persistence.js';
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
} from '../../fleetgraph/reviewer-proof/index.js';
import {
  jsonReviewerChain,
  jsonReviewerChains,
  jsonReviewerProof,
  jsonReviewerRepair,
  jsonReviewerScenario,
  jsonReviewerWorkerTick,
} from '../../fleetgraph/reviewer-wire-response.js';
import { UuidSchema, ErrorResponseSchema, ApiErrorResponseSchema } from '../../openapi/schemas/common.js';
import {
  findingsQuerySchema,
  notificationsQuerySchema,
  findingParamsSchema,
  markNotificationsReadBodySchema,
  refineBodySchema,
  manualRunBodySchema,
  reviewerChainsQuerySchema,
  reviewerChainParamsSchema,
  reviewerScenarioBodySchema,
  reviewerRepairBodySchema,
  testFleetGraphTriggerEnabled,
  requireWorkspaceAdminForFleetGraph,
  requireInteractiveReviewerAdmin,
  requireReviewerProofEnabled,
  actorVisibleFindingIds,
} from './shared.js';

const router: ExpressRouter = Router();

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

export default router;
