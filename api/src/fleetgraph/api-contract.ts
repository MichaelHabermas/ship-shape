// FleetGraph API contract owns schemas and safe response serialization.
import type { Response } from 'express';
import { FLEETGRAPH_CHAT_HISTORY_LIMIT } from '@ship/shared';
import { z } from '../openapi/registry.js';
import { UuidSchema, ErrorResponseSchema, ApiErrorResponseSchema } from '../openapi/schemas/common.js';
import { traceMetadataForResponse } from './trace.js';
import { FLEETGRAPH_EVIDENCE_KIND_VALUES, type FleetGraphSignalType } from '@ship/shared';
import type { FleetGraphResult, FleetGraphVisibleOutput } from './types.js';
import type { FleetGraphFinding, FleetGraphNotificationFinding } from './persistence.js';
import { signalLabelForType, signalTypeFromDedupeKey } from './persistence.js';
import { chatAnswerFromChangeSummary, chatAnswerFromVisibleOutput, unsupportedChatAnswer } from './runtime/chat.js';
import { usageMetadataFromResult } from './usage-metadata.js';

export const FleetGraphEvidenceSchema = z.object({
  kind: z.enum(FLEETGRAPH_EVIDENCE_KIND_VALUES),
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

export const FleetGraphUsageSchema = z.object({
  modelCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  billableInputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  costCurrency: z.literal('USD').optional(),
  usageSource: z.enum(['none', 'model_response', 'partial_model_response', 'synthetic_calibration']).optional(),
  costSource: z.enum(['none', 'model_response', 'catalog_estimate', 'env_estimate', 'synthetic_calibration']).optional(),
}).openapi('FleetGraphUsage');

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
  isRead: z.boolean(),
  readAt: z.string().nullable(),
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
  usageMetadata: FleetGraphUsageSchema.optional(),
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
  usageMetadata: FleetGraphUsageSchema.optional(),
}).openapi('FleetGraphManualRunResult');

export const FleetGraphManualRunResponseSchema = z.object({
  mode: z.literal('proactive'),
  detectorDecisions: z.number().int().nonnegative(),
  results: z.array(FleetGraphManualRunResultSchema),
}).openapi('FleetGraphManualRunResponse');

const fleetGraphChatContextKind = z.enum([
  'issue', 'sprint', 'project', 'program', 'document', 'workspace', 'notification', 'finding',
]);

const FleetGraphPageContextItemSchema = z.object({
  kind: fleetGraphChatContextKind,
  id: UuidSchema.optional(),
  title: z.string().trim().min(1).max(160),
  state: z.string().trim().max(80).optional(),
  priority: z.string().trim().max(80).optional(),
  owner: z.string().trim().max(120).optional(),
  summary: z.string().trim().max(280).optional(),
}).openapi('FleetGraphPageContextItem');

const FleetGraphPageContextSchema = z.object({
  route: z.string().trim().min(1).max(512),
  surface: z.enum(['issues_list', 'scoped_issues_list', 'my_week', 'document_issue_tab', 'dashboard', 'workspace']),
  title: z.string().trim().min(1).max(160),
  filters: z.record(z.union([z.string().max(128), z.number(), z.boolean(), z.null()])).optional(),
  sort: z.string().trim().max(80).optional(),
  viewMode: z.string().trim().max(80).optional(),
  counts: z.record(z.number().int().nonnegative()).optional(),
  visibleItems: z.array(FleetGraphPageContextItemSchema).max(25),
  selectedItemIds: z.array(UuidSchema).max(8).optional(),
}).openapi('FleetGraphPageContext');

const FleetGraphChatContextFieldsSchema = z.object({
  kind: fleetGraphChatContextKind,
  documentId: UuidSchema.optional(),
  findingId: UuidSchema.optional(),
  sourcePath: z.string().max(512).optional(),
  pageContext: FleetGraphPageContextSchema.optional(),
});

function fleetGraphChatContextRefine(context: z.infer<typeof FleetGraphChatContextFieldsSchema>): boolean {
  return Boolean(context.findingId || context.documentId || context.kind === 'workspace' || context.pageContext);
}

const FleetGraphAttachedChatContextSchema = FleetGraphChatContextFieldsSchema.refine(
  fleetGraphChatContextRefine,
  { message: 'attached context requires findingId, documentId, or workspace kind' }
);

export const FleetGraphChatContextSchema = FleetGraphChatContextFieldsSchema.extend({
  attachedContexts: z.array(FleetGraphAttachedChatContextSchema).max(8).optional(),
}).refine(
  fleetGraphChatContextRefine,
  { message: 'context requires findingId, documentId, or workspace kind' }
).openapi('FleetGraphChatContext');

export const FleetGraphChatHistoryEntrySchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4_000),
}).openapi('FleetGraphChatHistoryEntry');

export const FleetGraphChatRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  context: FleetGraphChatContextSchema,
  history: z.array(FleetGraphChatHistoryEntrySchema).max(FLEETGRAPH_CHAT_HISTORY_LIMIT).optional(),
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
  usageMetadata: FleetGraphUsageSchema.optional(),
}).openapi('FleetGraphChatResponse');

const FleetGraphReviewerStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['pass', 'pending', 'broken', 'failed']),
  at: z.string().nullable(),
  durationMs: z.number().nonnegative().optional(),
  evidence: z.string(),
}).openapi('FleetGraphReviewerStep');

const FleetGraphReviewerTraceScoreSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  value: z.union([z.string(), z.number(), z.boolean(), z.literal(null)]).openapi({
    anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
    nullable: true,
  } as never),
  comment: z.string(),
}).openapi('FleetGraphReviewerTraceScore');

const FleetGraphReviewerChainSchema = z.object({
  chainId: z.string(),
  scenario: z.string(),
  status: z.enum(['complete', 'in_progress', 'broken', 'failed']),
  missing: z.array(z.string()),
  generatedAt: z.string(),
  freshness: z.object({
    generatedAt: z.string(),
    newestRunAt: z.string().nullable(),
    newestWorkerTickAt: z.string().nullable(),
    proofAgeMs: z.number().nullable(),
    workerAgeMs: z.number().nullable(),
  }),
  latencyMs: z.object({
    shipToAttention: z.number().optional(),
    attentionToWorker: z.number().optional(),
    workerToRun: z.number().optional(),
    runToFinding: z.number().optional(),
    findingToNotification: z.number().optional(),
    total: z.number().optional(),
  }),
  links: z.record(z.string()),
  steps: z.array(FleetGraphReviewerStepSchema),
  visibleOutput: FleetGraphVisibleOutputSchema.optional(),
  notificationProjection: FleetGraphNotificationResponseSchema.optional(),
  humanGate: z.object({
    required: z.boolean(),
    state: z.string(),
    allowedActions: z.array(z.string()),
  }),
  traceQuality: z.object({
    passed: z.boolean(),
    requiredDecisions: z.array(z.string()),
    observedDecisions: z.array(z.string()),
    scores: z.array(FleetGraphReviewerTraceScoreSchema),
  }),
  sourceMutationCheck: z.object({
    passed: z.boolean(),
    before: z.record(z.unknown()),
    after: z.record(z.unknown()),
    changedFields: z.array(z.string()),
  }),
  usageSummary: FleetGraphUsageSchema,
}).openapi('FleetGraphReviewerChain');

export const FleetGraphReviewerChainsResponseSchema = z.object({
  summary: z.object({
    generatedAt: z.string(),
    status: z.enum(['complete', 'in_progress', 'broken', 'failed']),
    chainCount: z.number().int().nonnegative(),
    completeCount: z.number().int().nonnegative(),
    brokenCount: z.number().int().nonnegative(),
    requiredGates: z.array(FleetGraphReviewerTraceScoreSchema),
    costSummary: FleetGraphUsageSchema,
  }),
  chains: z.array(FleetGraphReviewerChainSchema),
}).openapi('FleetGraphReviewerChainsResponse');

export const FleetGraphReviewerChainResponseSchema = z.object({
  chain: FleetGraphReviewerChainSchema,
}).openapi('FleetGraphReviewerChainResponse');

export const FleetGraphReviewerScenarioResponseSchema = z.object({
  chainId: z.string(),
  sourceIssueId: UuidSchema,
  sourceSprintId: UuidSchema,
  attentionEventId: UuidSchema.optional(),
  workerTickTriggered: z.boolean(),
  chain: FleetGraphReviewerChainSchema,
}).openapi('FleetGraphReviewerScenarioResponse');

export const FleetGraphReviewerRepairResponseSchema = z.object({
  chainId: z.string(),
  repaired: z.array(z.string()),
  unsupported: z.array(z.string()),
  chain: FleetGraphReviewerChainSchema,
}).openapi('FleetGraphReviewerRepairResponse');

export const FleetGraphReviewerProofRequestSchema = z.object({
  chainId: UuidSchema.optional(),
}).default({}).openapi('FleetGraphReviewerProofRequest');

export const FleetGraphReviewerProofResponseSchema = z.object({
  verdict: z.enum(['pass', 'blocked', 'fail', 'risk']),
  generatedAt: z.string(),
  chainId: z.string(),
  artifactPaths: z.record(z.string()),
}).openapi('FleetGraphReviewerProofResponse');

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
type FleetGraphUsageWire = z.infer<typeof FleetGraphUsageSchema>;

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

function usageMetadataFieldForResult(
  result: FleetGraphResult
): { usageMetadata?: FleetGraphUsageWire } {
  const usage = usageMetadataFromResult({
    tokenMetadata: result.tokenMetadata,
    costMetadata: result.costMetadata,
  });
  return usage ? { usageMetadata: FleetGraphUsageSchema.parse(usage) } : {};
}

function chatAnswerForResponse(result: FleetGraphResult): FleetGraphChatAnswerWire {
  const recordedAnswer = FleetGraphChatAnswerSchema.safeParse(result.runInput?.outputSnapshot?.answer);
  if (recordedAnswer.success) {
    return recordedAnswer.data;
  }

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
    isRead: input.finding.read_at !== null,
    readAt: input.finding.read_at?.toISOString() ?? null,
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
    ...usageMetadataFieldForResult(result),
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
    ...usageMetadataFieldForResult(input.result),
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
    ...usageMetadataFieldForResult(result),
  };
}
