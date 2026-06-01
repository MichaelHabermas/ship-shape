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
