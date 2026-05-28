// FleetGraph API contract owns schemas and safe response serialization.
import type { Response } from 'express';
import { z } from '../openapi/registry.js';
import { UuidSchema, ErrorResponseSchema, ApiErrorResponseSchema } from '../openapi/schemas/common.js';
import { traceMetadataForResponse } from './trace.js';
import type { FleetGraphResult, FleetGraphVisibleOutput } from './types.js';
import type { FleetGraphFinding, FleetGraphNotificationFinding } from './persistence.js';
import { signalLabelForType, signalTypeFromDedupeKey, type FleetGraphSignalType } from './persistence.js';
import { chatAnswerFromChangeSummary, chatAnswerFromVisibleOutput, unsupportedChatAnswer } from './runtime/chat.js';

export type {
  FleetGraphChangeSummaryResponse,
  FleetGraphChatAnswer,
  FleetGraphChatContext,
  FleetGraphChatRequest,
  FleetGraphChatResponse,
  FleetGraphFindingResponse,
  FleetGraphFindingsListResponse,
  FleetGraphManualRunResponse,
  FleetGraphManualRunResult,
  FleetGraphNotificationResponse,
  FleetGraphNotificationsListResponse,
  FleetGraphRunResponse,
  FleetGraphTrace,
  FleetGraphVisibleOutput as FleetGraphWireVisibleOutput,
} from '@ship/shared';

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
  displayName: z.string().optional(),
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

const FleetGraphAttentionSignalFieldsSchema = z.object({
  signalType: z.enum(['blocked', 'stale', 'at_risk']),
  signalLabel: z.string(),
  reason: z.string(),
});

const FleetGraphSourceReferenceFieldsSchema = z.object({
  sourceIssueId: UuidSchema,
  sourceSprintId: UuidSchema,
});

const FleetGraphVisibleResponseFieldsSchema = z.object({
  visibleOutput: FleetGraphVisibleOutputSchema,
  traceMetadata: FleetGraphTraceSchema,
});

export const FleetGraphFindingResponseSchema = FleetGraphAttentionSignalFieldsSchema
  .merge(FleetGraphSourceReferenceFieldsSchema)
  .merge(FleetGraphVisibleResponseFieldsSchema)
  .extend({
    id: UuidSchema,
    kind: z.literal('blocker'),
    status: z.string(),
}).openapi('FleetGraphFindingResponse');

export const FleetGraphFindingsListResponseSchema = z.object({
  findings: z.array(FleetGraphFindingResponseSchema),
}).openapi('FleetGraphFindingsListResponse');

const FleetGraphNotificationDisplayFieldsSchema = z.object({
  title: z.string(),
  issueTitle: z.string(),
  context: z.string(),
  owner: z.string().nullable(),
  notificationText: z.string(),
  blockerText: z.string(),
  sourcePath: z.string(),
  detectedAt: z.string(),
});

export const FleetGraphNotificationResponseSchema = FleetGraphAttentionSignalFieldsSchema
  .merge(FleetGraphSourceReferenceFieldsSchema)
  .merge(FleetGraphVisibleResponseFieldsSchema)
  .merge(FleetGraphNotificationDisplayFieldsSchema)
  .extend({
    id: UuidSchema,
    findingId: UuidSchema,
}).openapi('FleetGraphNotificationResponse');

export const FleetGraphNotificationsListResponseSchema = z.object({
  notifications: z.array(FleetGraphNotificationResponseSchema),
}).openapi('FleetGraphNotificationsListResponse');

export const FleetGraphRunResponseSchema = z.object({
  decision: z.string(),
  finding: FleetGraphFindingResponseSchema.optional(),
  visibleOutput: FleetGraphVisibleOutputSchema.optional(),
  traceMetadata: FleetGraphTraceSchema,
}).openapi('FleetGraphRunResponse');

export const FleetGraphChangeSummaryRowSchema = z.object({
  label: z.enum(['Now', 'Changed', 'Cleared', 'Next', 'Unknown', 'Not done']),
  text: z.string(),
}).openapi('FleetGraphChangeSummaryRow');

export const FleetGraphChangeSummaryResponseSchema = z.object({
  headline: z.string(),
  rows: z.array(FleetGraphChangeSummaryRowSchema),
  traceMetadata: FleetGraphTraceSchema,
}).openapi('FleetGraphChangeSummaryResponse');

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

export const FleetGraphChatContextSchema = z.object({
  kind: z.enum(['issue', 'sprint', 'project', 'program', 'document', 'workspace', 'notification', 'finding']),
  documentId: UuidSchema.optional(),
  findingId: UuidSchema.optional(),
  sourcePath: z.string().max(512).optional(),
}).refine((context) => context.findingId || context.documentId || context.kind === 'workspace', {
  message: 'context requires findingId, documentId, or workspace kind',
}).openapi('FleetGraphChatContext');

export const FleetGraphChatRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  context: FleetGraphChatContextSchema,
  clientMessageId: z.string().max(128).optional(),
}).openapi('FleetGraphChatRequest');

export const FleetGraphChatAnswerSchema = z.object({
  title: z.string(),
  body: z.string(),
  nextStep: z.string().optional(),
  sources: z.array(z.object({
    label: z.string(),
    kind: z.string(),
  })),
  humanGate: z.record(z.unknown()),
}).openapi('FleetGraphChatAnswer');

export const FleetGraphChatResponseSchema = z.object({
  decision: z.string(),
  answer: FleetGraphChatAnswerSchema,
  context: FleetGraphChatContextSchema,
  visibleOutput: FleetGraphVisibleOutputSchema.optional(),
  changeSummary: FleetGraphChangeSummaryResponseSchema.omit({ traceMetadata: true }).optional(),
  traceMetadata: FleetGraphTraceSchema,
}).openapi('FleetGraphChatResponse');

type FleetGraphRecommendedActionWire = z.infer<typeof FleetGraphRecommendedActionSchema>;
type FleetGraphProposedRecipientWire = z.infer<typeof FleetGraphProposedRecipientSchema>;
type FleetGraphVisibleOutputWire = z.infer<typeof FleetGraphVisibleOutputSchema>;
type FleetGraphFindingResponseWire = z.infer<typeof FleetGraphFindingResponseSchema>;
type FleetGraphNotificationResponseWire = z.infer<typeof FleetGraphNotificationResponseSchema>;
type FleetGraphRunResponseWire = z.infer<typeof FleetGraphRunResponseSchema>;
type FleetGraphChatAnswerWire = z.infer<typeof FleetGraphChatAnswerSchema>;
type FleetGraphChatContextWire = z.infer<typeof FleetGraphChatContextSchema>;
type FleetGraphChatResponseWire = z.infer<typeof FleetGraphChatResponseSchema>;
type FleetGraphManualRunResultWire = z.infer<typeof FleetGraphManualRunResultSchema>;

const fleetGraphSeveritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
const fleetGraphChangeSummaryBodySchema = FleetGraphChangeSummaryResponseSchema.omit({ traceMetadata: true });
type FleetGraphChangeSummaryRowWire = z.infer<typeof FleetGraphChangeSummaryRowSchema>;
type FleetGraphChangeSummaryBodyWire = {
  headline: string;
  rows: FleetGraphChangeSummaryRowWire[];
};

export const fleetGraphErrorSchemas = {
  badRequest: ApiErrorResponseSchema,
  error: ErrorResponseSchema,
};

function recommendedActionForResponse(action: Record<string, unknown> | undefined): FleetGraphRecommendedActionWire | undefined {
  if (!action) return undefined;
  const safe: FleetGraphRecommendedActionWire = {};
  for (const key of ['label', 'text', 'summary'] as const) {
    const value = action[key];
    if (typeof value === 'string' && value.trim()) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function proposedRecipientForResponse(recipient: Record<string, unknown> | undefined): FleetGraphProposedRecipientWire | undefined {
  if (!recipient) return undefined;
  const safe: FleetGraphProposedRecipientWire = {};
  const role = recipient.role;
  const userId = recipient.userId;
  const displayName = recipient.displayName;
  const rationale = recipient.rationale;
  if (typeof role === 'string' && role.trim()) safe.role = role;
  if (typeof userId === 'string' || userId === null) safe.userId = userId;
  if (typeof displayName === 'string' && displayName.trim()) safe.displayName = displayName;
  if (typeof rationale === 'string' && rationale.trim()) safe.rationale = rationale;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function severityForResponse(value: unknown): FleetGraphVisibleOutputWire['severity'] {
  const parsed = fleetGraphSeveritySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function changeSummaryForResponse(value: unknown): FleetGraphChangeSummaryBodyWire | undefined {
  const parsed = fleetGraphChangeSummaryBodySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function chatAnswerForResponse(result: FleetGraphResult): FleetGraphChatAnswerWire {
  const changeSummary = changeSummaryForResponse(result.changeSummary);
  if (changeSummary) {
    return FleetGraphChatAnswerSchema.parse(chatAnswerFromChangeSummary(changeSummary));
  }
  if (result.visibleOutput) {
    return FleetGraphChatAnswerSchema.parse(chatAnswerFromVisibleOutput(result.visibleOutput));
  }
  return FleetGraphChatAnswerSchema.parse(
    unsupportedChatAnswer('FleetGraph could not answer from this context.')
  );
}

export function serializeFleetGraphVisibleOutput(
  output: FleetGraphVisibleOutput
): FleetGraphVisibleOutputWire {
  return {
    title: output.title,
    summary: output.summary,
    severity: severityForResponse(output.severity),
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
  dedupe_key: string;
  summary: string;
  run_metadata: Record<string, unknown>;
  trace_metadata: unknown;
  visibleOutput: FleetGraphVisibleOutput;
}): FleetGraphFindingResponseWire {
  const signalType = signalTypeForFinding(input);
  const reason = reasonForFinding(input);
  return {
    id: input.id,
    kind: 'blocker',
    signalType,
    signalLabel: signalLabelForType(signalType),
    reason,
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

export function fleetGraphNotificationResponse(input: {
  finding: FleetGraphNotificationFinding;
  visibleOutput: FleetGraphVisibleOutput;
}): FleetGraphNotificationResponseWire {
  const signalType = signalTypeForFinding(input.finding);
  const reason = reasonForFinding(input.finding);
  const notificationText = notificationTextForOutput(input.visibleOutput, reason);
  return {
    id: input.finding.id,
    findingId: input.finding.id,
    signalType,
    signalLabel: signalLabelForType(signalType),
    reason,
    title: input.finding.issue_title,
    issueTitle: input.finding.issue_title,
    context: input.finding.context_title || 'Current week',
    owner: input.finding.owner_name,
    notificationText,
    blockerText: blockerTextForNotification(input.visibleOutput) || notificationText,
    sourceIssueId: input.finding.source_issue_id,
    sourceSprintId: input.finding.source_sprint_id,
    sourcePath: `/documents/${input.finding.source_issue_id}`,
    detectedAt: input.finding.first_detected_at.toISOString(),
    visibleOutput: serializeFleetGraphVisibleOutput(input.visibleOutput),
    traceMetadata: traceMetadataForResponse(input.finding.trace_metadata, {
      mode: 'proactive',
      decision: 'create_finding',
    }),
  };
}

function blockerTextForNotification(output: FleetGraphVisibleOutput): string | undefined {
  return output.evidence.find((item) => item.kind === 'blocker' && item.excerpt?.trim())?.excerpt;
}

function signalTypeForFinding(finding: Pick<FleetGraphFinding, 'dedupe_key' | 'run_metadata'>): FleetGraphSignalType {
  const stored = finding.run_metadata?.signalType;
  if (stored === 'blocked' || stored === 'stale' || stored === 'at_risk') return stored;
  return signalTypeFromDedupeKey(finding.dedupe_key);
}

function reasonForFinding(finding: Pick<FleetGraphFinding, 'summary' | 'run_metadata'>): string {
  const reason = finding.run_metadata?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : finding.summary;
}

function notificationTextForOutput(output: FleetGraphVisibleOutput, reason: string): string {
  return blockerTextForNotification(output) || output.summary || reason;
}

export function fleetGraphResultIsNotFound(result: FleetGraphResult): boolean {
  return result.decision === 'error' && result.errorMetadata.category === 'not_found';
}

export function fleetGraphFindingIsSafeToSerialize(
  result: Pick<FleetGraphResult, 'finding' | 'visibleOutput'>
): result is { finding: FleetGraphFinding; visibleOutput: FleetGraphVisibleOutput } {
  return Boolean(result.finding && result.visibleOutput && !result.visibleOutput.noSafeOutput);
}

export function fleetGraphRunResponse(result: FleetGraphResult): FleetGraphRunResponseWire {
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

export function fleetGraphChatResponse(input: {
  result: FleetGraphResult;
  context: FleetGraphChatContextWire;
}): FleetGraphChatResponseWire {
  return {
    decision: input.result.decision,
    answer: chatAnswerForResponse(input.result),
    context: input.context,
    visibleOutput: input.result.visibleOutput && !input.result.visibleOutput.noSafeOutput
      ? serializeFleetGraphVisibleOutput(input.result.visibleOutput)
      : undefined,
    changeSummary: changeSummaryForResponse(input.result.changeSummary),
    traceMetadata: traceMetadataForResponse(input.result.traceMetadata, {
      mode: 'on_demand',
      decision: input.result.decision,
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

export function sendFleetGraphChangeSummaryResponse(res: Response, result: FleetGraphResult): void {
  if (fleetGraphResultIsNotFound(result) || result.visibleOutput?.noSafeOutput) {
    res.status(404).json({ error: 'FleetGraph finding not found' });
    return;
  }
  if (result.decision === 'error') {
    res.status(500).json({ error: 'FleetGraph run failed' });
    return;
  }
  if (!result.changeSummary) {
    res.status(500).json({ error: 'FleetGraph change summary missing' });
    return;
  }

  res.json({
    ...result.changeSummary,
    traceMetadata: traceMetadataForResponse(result.traceMetadata, {
      mode: 'on_demand',
      decision: 'summarize_changes',
    }),
  });
}

export function fleetGraphManualRunResultResponse(
  result: FleetGraphResult
): FleetGraphManualRunResultWire {
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
