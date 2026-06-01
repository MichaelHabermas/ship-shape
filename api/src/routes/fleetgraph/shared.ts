// FleetGraph routes expose visible findings, bounded on-demand graph actions, and gated manual runs.
import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from 'express';
import { z } from '../../openapi/registry.js';
import { authMiddleware } from '../../middleware/auth.js';
import { defineRoute } from '../../openapi/define-route.js';
import { fleetGraphConfig } from '../../config/fleetgraph.js';
import { principalFromRequest } from '../../security/principal.js';
import { authorizeRequest } from '../../security/route-capability.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError, sendLegacyError } from '../../utils/route-http.js';
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
import { isUtcCalendarDate, parseUtcCalendarDate } from '../../fleetgraph/date.js';
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

export const findingsQuerySchema = z.object({
  sourceIssueId: UuidSchema.optional(),
  sourceSprintId: UuidSchema.optional(),
}).refine((query) => query.sourceIssueId || query.sourceSprintId, {
  message: 'sourceIssueId or sourceSprintId is required',
});

export const notificationsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(99).optional() });

export const findingParamsSchema = z.object({ findingId: UuidSchema });

export const markNotificationsReadBodySchema = z.object({
  findingIds: z.array(UuidSchema).min(1).max(99),
});

export const markNotificationsReadResponseSchema = z.object({
  success: z.literal(true),
  markedRead: z.number().int().nonnegative(),
}).openapi('FleetGraphMarkNotificationsReadResponse');

export const refineBodySchema = z.object({
  instruction: z.string().min(1).max(2_000),
});

export const manualRunBodySchema = z.object({
  today: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isUtcCalendarDate, 'today must be a real YYYY-MM-DD calendar date')
    .optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export const reviewerChainsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

export const reviewerChainParamsSchema = z.object({
  chainId: UuidSchema,
});

export const reviewerScenarioBodySchema = z.object({
  triggerWorker: z.boolean().optional(),
  freshRun: z.boolean().optional(),
});

export const reviewerRepairBodySchema = z.object({
  chainId: UuidSchema,
});

export function testFleetGraphTriggerEnabled(): boolean {
  return process.env.NODE_ENV === 'test';
}

export async function requireWorkspaceAdminForFleetGraph(req: Request, res: Response): Promise<boolean> {
  const adminDecision = await authorizeRequest(req, { resource: 'workspace', action: 'admin' });
  if (adminDecision.allowed) return true;

  sendLegacyError(res, 403, 'Workspace admin access required');
  return false;
}

export async function requireInteractiveReviewerAdmin(req: Request, res: Response): Promise<boolean> {
  const principal = principalFromRequest(req);
  if (principal.kind !== 'session') {
    sendLegacyError(res, 403, 'Interactive reviewer session required');
    return false;
  }
  return requireWorkspaceAdminForFleetGraph(req, res);
}

export function requireReviewerProofEnabled(res: Response): boolean {
  if (fleetGraphReviewerProofEnabled()) return true;
  sendLegacyError(res, 403, 'FleetGraph reviewer proof controls are disabled');
  return false;
}

export async function actorVisibleFindingIds(input: {
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

