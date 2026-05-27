// FleetGraph API contract owns schemas and safe response serialization.
import type { Response } from 'express';
import { z } from '../openapi/registry.js';
import { UuidSchema, ErrorResponseSchema, ApiErrorResponseSchema } from '../openapi/schemas/common.js';
import { traceMetadataForResponse } from './trace.js';
import type { FleetGraphResult, FleetGraphVisibleOutput } from './types.js';
import type { FleetGraphFinding } from './persistence.js';

export const FleetGraphEvidenceSchema = z.object({
  kind: z.string(),
  sourceDocumentId: UuidSchema.optional(),
  sourceType: z.enum(['issue', 'sprint']).optional(),
  claim: z.string(),
  excerpt: z.string().optional(),
  visibility: z.enum(['internal', 'actor_visible', 'restricted']),
  visibleFields: z.array(z.string()),
  redactionReason: z.string().optional(),
}).openapi('FleetGraphEvidence');

export const FleetGraphRecommendedActionSchema = z.object({
  label: z.string().optional(),
  text: z.string().optional(),
  summary: z.string().optional(),
}).openapi('FleetGraphRecommendedAction');

export const FleetGraphProposedRecipientSchema = z.object({
  role: z.string().optional(),
  userId: UuidSchema.nullable().optional(),
  rationale: z.string().optional(),
}).openapi('FleetGraphProposedRecipient');

export const FleetGraphVisibleOutputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  confidence: z.number().optional(),
  recommendedAction: FleetGraphRecommendedActionSchema.optional(),
  proposedRecipient: FleetGraphProposedRecipientSchema.optional(),
  recipientRationale: z.string().optional(),
  uncertaintyNotes: z.array(z.string()).optional(),
  evidence: z.array(FleetGraphEvidenceSchema),
  humanGate: z.record(z.unknown()),
  draftContent: z.record(z.unknown()).optional(),
  noSafeOutput: z.boolean().optional(),
}).openapi('FleetGraphVisibleOutput');

export const FleetGraphTraceSchema = z.object({
  mode: z.enum(['proactive', 'on_demand']),
  decision: z.string(),
  nodePath: z.array(z.string()),
  traceId: z.string().optional(),
  traceUrl: z.string().optional(),
  failureCategory: z.string().optional(),
}).openapi('FleetGraphTrace');

export const FleetGraphFindingResponseSchema = z.object({
  id: UuidSchema,
  status: z.string(),
  sourceIssueId: UuidSchema,
  sourceSprintId: UuidSchema,
  visibleOutput: FleetGraphVisibleOutputSchema,
  traceMetadata: FleetGraphTraceSchema,
}).openapi('FleetGraphFindingResponse');

export const FleetGraphFindingsListResponseSchema = z.object({
  findings: z.array(FleetGraphFindingResponseSchema),
}).openapi('FleetGraphFindingsListResponse');

export const FleetGraphRunResponseSchema = z.object({
  decision: z.string(),
  finding: FleetGraphFindingResponseSchema.optional(),
  visibleOutput: FleetGraphVisibleOutputSchema.optional(),
  traceMetadata: FleetGraphTraceSchema,
}).openapi('FleetGraphRunResponse');

export const FleetGraphManualRunResultSchema = z.object({
  decision: z.string(),
  findingId: UuidSchema.optional(),
  visibleOutput: FleetGraphVisibleOutputSchema.optional(),
  traceMetadata: FleetGraphTraceSchema,
}).openapi('FleetGraphManualRunResult');

export const FleetGraphManualRunResponseSchema = z.object({
  mode: z.literal('proactive'),
  detectorDecisions: z.number().int().nonnegative(),
  results: z.array(FleetGraphManualRunResultSchema),
}).openapi('FleetGraphManualRunResponse');

export type FleetGraphFindingResponse = z.infer<typeof FleetGraphFindingResponseSchema>;

export const fleetGraphErrorSchemas = {
  badRequest: ApiErrorResponseSchema,
  error: ErrorResponseSchema,
};

function recommendedActionForResponse(action: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!action) return undefined;
  const safe: Record<string, unknown> = {};
  for (const key of ['label', 'text', 'summary']) {
    const value = action[key];
    if (typeof value === 'string' && value.trim()) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function proposedRecipientForResponse(recipient: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!recipient) return undefined;
  const safe: Record<string, unknown> = {};
  const role = recipient.role;
  const userId = recipient.userId;
  const rationale = recipient.rationale;
  if (typeof role === 'string' && role.trim()) safe.role = role;
  if (typeof userId === 'string' || userId === null) safe.userId = userId;
  if (typeof rationale === 'string' && rationale.trim()) safe.rationale = rationale;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function serializeFleetGraphVisibleOutput(
  output: FleetGraphVisibleOutput
): z.infer<typeof FleetGraphVisibleOutputSchema> {
  return {
    title: output.title,
    summary: output.summary,
    severity: output.severity,
    confidence: output.confidence,
    recommendedAction: recommendedActionForResponse(output.recommendedAction),
    proposedRecipient: proposedRecipientForResponse(output.proposedRecipient),
    recipientRationale: output.recipientRationale,
    uncertaintyNotes: output.uncertaintyNotes,
    evidence: output.evidence.map((item) => ({
      ...item,
      visibleFields: [...item.visibleFields],
    })),
    humanGate: output.humanGate,
    draftContent: output.draftContent,
    noSafeOutput: output.noSafeOutput,
  };
}

export function fleetGraphFindingResponse(input: {
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
    visibleOutput: serializeFleetGraphVisibleOutput(input.visibleOutput),
    traceMetadata: traceMetadataForResponse(input.trace_metadata, {
      mode: 'proactive',
      decision: 'create_finding',
    }),
  };
}

export function fleetGraphResultIsNotFound(result: FleetGraphResult): boolean {
  return result.decision === 'error' && result.errorMetadata.category === 'not_found';
}

export function fleetGraphFindingIsSafeToSerialize(
  result: Pick<FleetGraphResult, 'finding' | 'visibleOutput'>
): result is { finding: FleetGraphFinding; visibleOutput: FleetGraphVisibleOutput } {
  return Boolean(result.finding && result.visibleOutput && !result.visibleOutput.noSafeOutput);
}

export function fleetGraphRunResponse(result: FleetGraphResult): z.infer<typeof FleetGraphRunResponseSchema> {
  return {
    decision: result.decision,
    ...(fleetGraphFindingIsSafeToSerialize(result)
      ? { finding: fleetGraphFindingResponse({ ...result.finding, visibleOutput: result.visibleOutput }) }
      : {}),
    visibleOutput: result.visibleOutput ? serializeFleetGraphVisibleOutput(result.visibleOutput) : undefined,
    traceMetadata: traceMetadataForResponse(result.traceMetadata, {
      mode: 'on_demand',
      decision: result.decision,
    }),
  };
}

export function sendFleetGraphRunResponse(res: Response, result: FleetGraphResult): void {
  if (fleetGraphResultIsNotFound(result) || result.visibleOutput?.noSafeOutput) {
    res.status(404).json({ error: 'FleetGraph finding not found' });
    return;
  }
  if (result.decision === 'error') {
    res.status(500).json({ error: 'FleetGraph run failed' });
    return;
  }

  res.json(fleetGraphRunResponse(result));
}

export function fleetGraphManualRunResultResponse(
  result: FleetGraphResult
): z.infer<typeof FleetGraphManualRunResultSchema> {
  return {
    decision: result.decision,
    ...(fleetGraphFindingIsSafeToSerialize(result) ? { findingId: result.finding.id } : {}),
    visibleOutput: result.visibleOutput && !result.visibleOutput.noSafeOutput
      ? serializeFleetGraphVisibleOutput(result.visibleOutput)
      : undefined,
    traceMetadata: traceMetadataForResponse(result.traceMetadata, {
      mode: 'proactive',
      decision: result.decision,
    }),
  };
}
