// FleetGraph routes expose visible findings and bounded on-demand graph actions.
import { Router, type Request, type Response } from 'express';
import { z } from '../openapi/registry.js';
import { authMiddleware } from '../middleware/auth.js';
import { defineRoute } from '../openapi/define-route.js';
import { principalFromRequest } from '../security/principal.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendLegacyError } from '../utils/route-http.js';
import { runFleetGraph } from '../fleetgraph/core.js';
import { visibleOutputForFinding } from '../fleetgraph/evidence.js';
import { listFleetGraphFindingsForSource, type FleetGraphFinding } from '../fleetgraph/persistence.js';
import { traceMetadataForResponse } from '../fleetgraph/trace.js';
import type { FleetGraphResult, FleetGraphVisibleOutput } from '../fleetgraph/types.js';
import { UuidSchema, ErrorResponseSchema, ApiErrorResponseSchema } from '../openapi/schemas/common.js';

const router = Router();

const FleetGraphEvidenceSchema = z.object({
  kind: z.string(),
  sourceDocumentId: UuidSchema.optional(),
  sourceType: z.enum(['issue', 'sprint']).optional(),
  claim: z.string(),
  excerpt: z.string().optional(),
  visibility: z.enum(['internal', 'actor_visible', 'restricted']),
  visibleFields: z.array(z.string()),
  redactionReason: z.string().optional(),
}).openapi('FleetGraphEvidence');

const FleetGraphVisibleOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  evidence: z.array(FleetGraphEvidenceSchema),
  humanGate: z.record(z.unknown()),
  draftContent: z.record(z.unknown()).optional(),
  noSafeOutput: z.boolean().optional(),
}).openapi('FleetGraphVisibleOutput');

const FleetGraphTraceSchema = z.object({
  mode: z.enum(['proactive', 'on_demand']),
  decision: z.string(),
  nodePath: z.array(z.string()),
  traceId: z.string().optional(),
  traceUrl: z.string().optional(),
  failureCategory: z.string().optional(),
}).openapi('FleetGraphTrace');

const FleetGraphFindingResponseSchema = z.object({
  id: UuidSchema,
  status: z.string(),
  sourceIssueId: UuidSchema,
  sourceSprintId: UuidSchema,
  visibleOutput: FleetGraphVisibleOutputSchema,
  traceMetadata: FleetGraphTraceSchema,
}).openapi('FleetGraphFindingResponse');

const FleetGraphFindingsListResponseSchema = z.object({
  findings: z.array(FleetGraphFindingResponseSchema),
}).openapi('FleetGraphFindingsListResponse');

const FleetGraphRunResponseSchema = z.object({
  decision: z.string(),
  finding: FleetGraphFindingResponseSchema.optional(),
  visibleOutput: FleetGraphVisibleOutputSchema.optional(),
  traceMetadata: FleetGraphTraceSchema,
}).openapi('FleetGraphRunResponse');

const findingsQuerySchema = z.object({
  sourceIssueId: UuidSchema.optional(),
  sourceSprintId: UuidSchema.optional(),
}).refine((query) => query.sourceIssueId || query.sourceSprintId, {
  message: 'sourceIssueId or sourceSprintId is required',
});

const findingParamsSchema = z.object({
  findingId: UuidSchema,
});

const refineBodySchema = z.object({
  instruction: z.string().min(1).max(2_000),
});

function responseForFinding(input: {
  id: string;
  status: string;
  source_issue_id: string;
  source_sprint_id: string;
  trace_metadata: unknown;
  visibleOutput: FleetGraphVisibleOutput;
}): z.infer<typeof FleetGraphFindingResponseSchema> {
  return {
    id: input.id,
    status: input.status,
    sourceIssueId: input.source_issue_id,
    sourceSprintId: input.source_sprint_id,
    visibleOutput: serializeVisibleOutput(input.visibleOutput),
    traceMetadata: traceMetadataForResponse(input.trace_metadata, {
      mode: 'proactive',
      decision: 'create_finding',
    }),
  };
}

function serializeVisibleOutput(output: FleetGraphVisibleOutput): z.infer<typeof FleetGraphVisibleOutputSchema> {
  return {
    ...output,
    evidence: output.evidence.map((item) => ({
      ...item,
      visibleFields: [...item.visibleFields],
    })),
  };
}

function findingIsSafeToSerialize(
  result: Pick<FleetGraphResult, 'finding' | 'visibleOutput'>
): result is { finding: FleetGraphFinding; visibleOutput: FleetGraphVisibleOutput } {
  return Boolean(result.finding && result.visibleOutput && !result.visibleOutput.noSafeOutput);
}

function resultIsNotFound(result: FleetGraphResult): boolean {
  return result.decision === 'error' && result.errorMetadata.category === 'not_found';
}

function sendFleetGraphRunResult(res: Response, result: FleetGraphResult): void {
  if (resultIsNotFound(result)) {
    sendLegacyError(res, 404, 'FleetGraph finding not found');
    return;
  }
  if (result.decision === 'error') {
    sendLegacyError(res, 500, 'FleetGraph run failed');
    return;
  }

  res.json({
    decision: result.decision,
    ...(findingIsSafeToSerialize(result)
      ? { finding: responseForFinding({ ...result.finding, visibleOutput: result.visibleOutput }) }
      : {}),
    visibleOutput: result.visibleOutput ? serializeVisibleOutput(result.visibleOutput) : undefined,
    traceMetadata: traceMetadataForResponse(result.traceMetadata, {
      mode: 'on_demand',
      decision: result.decision,
    }),
  });
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
        return responseForFinding({ ...finding, visibleOutput: output });
      }))).filter((finding): finding is z.infer<typeof FleetGraphFindingResponseSchema> => finding !== null);

      res.json({ findings: visibleFindings });
    } catch (err) {
      sendInternalError(res, err, 'List FleetGraph findings error');
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
      sendFleetGraphRunResult(res, result);
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
      sendFleetGraphRunResult(res, result);
    } catch (err) {
      sendInternalError(res, err, 'Refine FleetGraph finding error');
    }
  },
}));

export default router;
