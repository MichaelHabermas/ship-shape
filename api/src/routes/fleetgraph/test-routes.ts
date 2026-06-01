import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError, sendLegacyError } from '../../utils/route-http.js';
import { runFleetGraphWorkerTick } from '../../fleetgraph/execution/worker.js';
import {
  testFleetGraphTriggerEnabled,
  requireWorkspaceAdminForFleetGraph,
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
