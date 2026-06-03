// FleetGraph chat routes run user-initiated agent turns and optional public-API source reads.
import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { defineRoute } from '../../openapi/define-route.js';
import { fleetGraphConfig } from '../../config/fleetgraph.js';
import { createAttentionContextReader } from '../../fleetgraph/attention-context-factory.js';
import { createShipAgentPublicClient } from '../../fleetgraph/public-api-client.js';
import type { AttentionContextReader } from '../../fleetgraph/attention-context-reader.js';
import { principalFromRequest } from '../../security/principal.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import { sendInternalError, sendLegacyError } from '../../utils/route-http.js';
import {
  FleetGraphChatRequestSchema,
  FleetGraphChatResponseSchema,
  FleetGraphManualRunResponseSchema,
  fleetGraphChatResponse,
  fleetGraphManualRunResultResponse,
} from '../../fleetgraph/api-contract.js';
import { runFleetGraph } from '../../fleetgraph/core.js';
import { parseUtcCalendarDate } from '../../fleetgraph/date.js';
import { runFleetGraphManualTick } from '../../fleetgraph/execution/manual-run.js';
import {
  recordFleetGraphReviewerChatMutationProof,
  sourceSnapshotForReviewerChat,
} from '../../fleetgraph/reviewer-proof/index.js';
import { ErrorResponseSchema, ApiErrorResponseSchema } from '../../openapi/schemas/common.js';
import type { FleetGraphChatContext } from '@ship/shared';
import {
  manualRunBodySchema,
  requireWorkspaceAdminForFleetGraph,
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
      const { userId, workspaceId } = getAuthenticatedRouteContext(req);
      const principal = principalFromRequest(req);
      const config = fleetGraphConfig();
      const agentPublicClient = config.usePublicApi
        ? await createShipAgentPublicClient({ workspaceId, userId })
        : null;
      if (agentPublicClient) {
        const reader = await createAttentionContextReader({
          mode: 'http_loopback',
          workspaceId,
          viewerUserId: userId,
          shipClient: agentPublicClient.client,
        });
        await readAttentionContextViaPublicApi(reader, workspaceId, userId, parsed.body.context);
      }
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
      }, agentPublicClient ? { publicSourceClient: agentPublicClient.client } : undefined);

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

async function readAttentionContextViaPublicApi(
  reader: AttentionContextReader,
  workspaceId: string,
  viewerUserId: string,
  context: FleetGraphChatContext
): Promise<void> {
  const params = attentionContextParams(context);
  if (!params) return;
  await reader.listAttentionContexts({
    workspaceId,
    viewerUserId,
    limit: 25,
    sourceIssueId: params.source_issue_id,
    sourceSprintId: params.source_sprint_id,
  });
}

function attentionContextParams(
  context: FleetGraphChatContext
): { source_issue_id?: string; source_sprint_id?: string } | null {
  for (const candidate of [context, ...(context.attachedContexts ?? [])]) {
    const documentId = candidate.documentId ?? documentIdFromSourcePath(candidate.sourcePath);
    if (!documentId) continue;
    if (candidate.kind === 'issue') return { source_issue_id: documentId };
    if (candidate.kind === 'sprint') return { source_sprint_id: documentId };
  }
  return null;
}

function documentIdFromSourcePath(sourcePath: string | undefined): string | null {
  const match = sourcePath?.match(/^\/(?:documents|issues|projects|programs|sprints)\/([^/?#]+)/);
  return match?.[1] ?? null;
}

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
