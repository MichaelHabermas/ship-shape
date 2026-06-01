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
      jsonReviewerChains(res, await listFleetGraphReviewerChains({
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
      jsonReviewerChain(res, { chain });
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
      jsonReviewerScenario(res, await runFleetGraphReviewerWeekBlockerScenario({
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
    200: { schema: FleetGraphReviewerWorkerTickResponseSchema },
    403: { schema: ErrorResponseSchema },
    500: { schema: ErrorResponseSchema },
  },
  async handler(req: Request, res: Response) {
    try {
      if (!requireReviewerProofEnabled(res)) return;
      if (!(await requireInteractiveReviewerAdmin(req, res))) return;

      const { workspaceId } = getAuthenticatedRouteContext(req);
      jsonReviewerWorkerTick(res, await runFleetGraphReviewerWorkerTick({ workspaceId }));
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
      jsonReviewerRepair(res, await repairFleetGraphReviewerProof({
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
      jsonReviewerProof(res, await generateFleetGraphReviewerProof({
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


export default router;
