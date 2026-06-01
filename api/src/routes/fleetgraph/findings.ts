import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { defineRoute } from '../../openapi/define-route.js';
import { principalFromRequest } from '../../security/principal.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError, sendLegacyError } from '../../utils/route-http.js';
import {
  FleetGraphFindingsListResponseSchema,
  FleetGraphBlastRadiusResponseSchema,
  FleetGraphNotificationsListResponseSchema,
  FleetGraphChangeSummaryResponseSchema,
  FleetGraphRunResponseSchema,
  fleetGraphFindingResponse,
  fleetGraphNotificationResponse,
  sendFleetGraphChangeSummaryResponse,
  sendFleetGraphRunResponse,
} from '../../fleetgraph/api-contract.js';
import { getFleetGraphBlastRadius } from '../../fleetgraph/blast-radius.js';
import { runFleetGraph } from '../../fleetgraph/core.js';
import { visibleOutputForFinding } from '../../fleetgraph/evidence.js';
import {
  listFleetGraphFindingsForSource,
  listFleetGraphNotificationFindings,
  markFleetGraphNotificationRead,
  markVisibleFleetGraphNotificationsRead,
} from '../../fleetgraph/persistence.js';
import type { FleetGraphFindingResponse, FleetGraphNotificationResponse } from '@ship/shared';
import { ErrorResponseSchema, ApiErrorResponseSchema } from '../../openapi/schemas/common.js';
import {
  findingsQuerySchema,
  notificationsQuerySchema,
  findingParamsSchema,
  markNotificationsReadBodySchema,
  refineBodySchema,
  requireWorkspaceAdminForFleetGraph,
  actorVisibleFindingIds,
  markNotificationsReadResponseSchema,
} from './shared.js';

const router: ExpressRouter = Router();

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


export default router;
