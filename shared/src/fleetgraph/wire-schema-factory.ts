// FleetGraph Zod wire factories: single schema source for shared types and API OpenAPI registration.
import { z } from 'zod';
import { FLEETGRAPH_EVIDENCE_KIND_VALUES } from '../types/fleetgraph.js';

type Zod = typeof z;

const uuidSchema = (factory: Zod) => factory.string().uuid();

export function buildFleetGraphCoreWireSchemas(zod: Zod) {
  const z = zod;
  const FleetGraphEvidenceSchema = z.object({
    kind: z.enum(FLEETGRAPH_EVIDENCE_KIND_VALUES),
    sourceDocumentId: uuidSchema(z).optional(),
    sourceType: z.enum(['issue', 'sprint']).optional(),
    claim: z.string(),
    excerpt: z.string().optional(),
    visibility: z.enum(['internal', 'actor_visible', 'restricted']),
    visibleFields: z.array(z.string()),
    redactionReason: z.string().optional(),
  });

  const FleetGraphRecommendedActionSchema = z.object({
    label: z.string().optional(),
    text: z.string().optional(),
    summary: z.string().optional(),
  });

  const FleetGraphProposedRecipientSchema = z.object({
    role: z.string().optional(),
    userId: uuidSchema(z).nullable().optional(),
    displayName: z.string().optional(),
    rationale: z.string().optional(),
  });

  const FleetGraphVisibleOutputSchema = z.object({
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
  });

  const FleetGraphTraceSchema = z.object({
    mode: z.enum(['proactive', 'on_demand']),
    decision: z.string(),
    nodePath: z.array(z.string()),
    traceId: z.string().optional(),
    traceUrl: z.string().optional(),
    failureCategory: z.string().optional(),
  });

  const FleetGraphUsageSchema = z.object({
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
  });

  const FleetGraphAttentionSignalFieldsSchema = z.object({
    signalType: z.enum(['blocked', 'stale', 'at_risk']),
    signalLabel: z.string(),
    reason: z.string(),
  });

  const FleetGraphSourceReferenceFieldsSchema = z.object({
    sourceIssueId: uuidSchema(z),
    sourceSprintId: uuidSchema(z),
  });

  const FleetGraphFindingResponseSchema = FleetGraphAttentionSignalFieldsSchema
    .merge(FleetGraphSourceReferenceFieldsSchema)
    .extend({
      id: uuidSchema(z),
      kind: z.literal('blocker'),
      status: z.string(),
      visibleOutput: FleetGraphVisibleOutputSchema,
      traceMetadata: FleetGraphTraceSchema,
    });

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

  const FleetGraphVisibleResponseFieldsSchema = z.object({
    visibleOutput: FleetGraphVisibleOutputSchema,
    traceMetadata: FleetGraphTraceSchema,
  });

  const FleetGraphNotificationResponseSchema = FleetGraphAttentionSignalFieldsSchema
    .merge(FleetGraphSourceReferenceFieldsSchema)
    .merge(FleetGraphVisibleResponseFieldsSchema)
    .merge(FleetGraphNotificationDisplayFieldsSchema)
    .extend({
      id: uuidSchema(z),
      findingId: uuidSchema(z),
    });

  return {
    FleetGraphEvidenceSchema,
    FleetGraphRecommendedActionSchema,
    FleetGraphProposedRecipientSchema,
    FleetGraphVisibleOutputSchema,
    FleetGraphTraceSchema,
    FleetGraphUsageSchema,
    FleetGraphFindingResponseSchema,
    FleetGraphNotificationResponseSchema,
  };
}

export type FleetGraphCoreWireSchemas = ReturnType<typeof buildFleetGraphCoreWireSchemas>;

export function buildReviewerWireSchemas(zod: Zod, core: FleetGraphCoreWireSchemas) {
  const z = zod;
  const FleetGraphReviewerStepSchema = z.object({
    key: z.string(),
    label: z.string(),
    status: z.enum(['pass', 'pending', 'broken', 'failed']),
    at: z.string().nullable(),
    durationMs: z.number().nonnegative().optional(),
    evidence: z.string(),
  });

  const FleetGraphReviewerTraceScoreSchema = z.object({
    name: z.string(),
    passed: z.boolean(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    comment: z.string(),
  });

  const FleetGraphReviewerChainSchema = z.object({
    chainId: z.string(),
    scenario: z.enum(['week-blocker', 'existing']),
    status: z.enum(['complete', 'in_progress', 'broken', 'failed']),
    missing: z.array(z.string()),
    missingLabels: z.array(z.string()),
    productPath: z.enum(['working', 'partial']),
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
      notificationToChat: z.number().optional(),
      total: z.number().optional(),
    }),
    links: z.object({
      sourceIssueId: uuidSchema(z).optional(),
      sourceSprintId: uuidSchema(z).optional(),
      attentionEventId: uuidSchema(z).optional(),
      workerTickId: uuidSchema(z).optional(),
      runId: uuidSchema(z).optional(),
      traceId: z.string().optional(),
      traceUrl: z.string().optional(),
      findingId: uuidSchema(z).optional(),
      notificationProjectionId: uuidSchema(z).optional(),
      chatRunId: uuidSchema(z).optional(),
    }),
    steps: z.array(FleetGraphReviewerStepSchema),
    visibleOutput: core.FleetGraphVisibleOutputSchema.optional(),
    notificationProjection: core.FleetGraphNotificationResponseSchema.optional(),
    humanGate: z.object({
      required: z.boolean(),
      state: z.enum(['present', 'missing', 'not_applicable']),
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
      before: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
      after: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
      changedFields: z.array(z.string()),
    }),
    usageSummary: core.FleetGraphUsageSchema,
  });

  const FleetGraphReviewerSummarySchema = z.object({
    generatedAt: z.string(),
    status: z.enum(['complete', 'in_progress', 'broken', 'failed']),
    preferredChainId: z.string().nullable(),
    chainCount: z.number().int().nonnegative(),
    completeCount: z.number().int().nonnegative(),
    brokenCount: z.number().int().nonnegative(),
    requiredGates: z.array(FleetGraphReviewerTraceScoreSchema),
    costSummary: core.FleetGraphUsageSchema,
  });

  const FleetGraphReviewerChainsResponseSchema = z.object({
    summary: FleetGraphReviewerSummarySchema,
    chains: z.array(FleetGraphReviewerChainSchema),
  });

  const FleetGraphReviewerChainResponseSchema = z.object({
    chain: FleetGraphReviewerChainSchema,
  });

  const FleetGraphReviewerScenarioResponseSchema = z.object({
    chainId: z.string(),
    sourceIssueId: uuidSchema(z),
    sourceSprintId: uuidSchema(z),
    attentionEventId: uuidSchema(z).optional(),
    workerTickTriggered: z.boolean(),
    chain: FleetGraphReviewerChainSchema,
  });

  const FleetGraphReviewerRepairResponseSchema = z.object({
    chainId: z.string(),
    repaired: z.array(z.string()),
    unsupported: z.array(z.string()),
    chain: FleetGraphReviewerChainSchema,
  });

  const FleetGraphReviewerProofRequestSchema = z.object({
    chainId: uuidSchema(z).optional(),
  }).default({});

  const FleetGraphReviewerProofResponseSchema = z.object({
    verdict: z.enum(['pass', 'blocked', 'fail', 'risk']),
    generatedAt: z.string(),
    chainId: z.string(),
    artifactPaths: z.object({
      json: z.string(),
      markdown: z.string(),
      html: z.string(),
      publicJson: z.string().optional(),
      publicMarkdown: z.string().optional(),
      publicHtml: z.string().optional(),
    }),
  });

  return {
    FleetGraphReviewerStepSchema,
    FleetGraphReviewerTraceScoreSchema,
    FleetGraphReviewerChainSchema,
    FleetGraphReviewerSummarySchema,
    FleetGraphReviewerChainsResponseSchema,
    FleetGraphReviewerChainResponseSchema,
    FleetGraphReviewerScenarioResponseSchema,
    FleetGraphReviewerRepairResponseSchema,
    FleetGraphReviewerProofRequestSchema,
    FleetGraphReviewerProofResponseSchema,
  };
}

const coreWire = buildFleetGraphCoreWireSchemas(z);
const reviewerWire = buildReviewerWireSchemas(z, coreWire);

export const fleetGraphCoreWireSchemas = coreWire;
export const fleetGraphReviewerWireSchemas = reviewerWire;

export type FleetGraphReviewerChainStatus = z.infer<typeof reviewerWire.FleetGraphReviewerChainSchema>['status'];
export type FleetGraphReviewerProductPath = z.infer<typeof reviewerWire.FleetGraphReviewerChainSchema>['productPath'];
export type FleetGraphReviewerStepStatus = z.infer<typeof reviewerWire.FleetGraphReviewerStepSchema>['status'];
export type FleetGraphReviewerStep = z.infer<typeof reviewerWire.FleetGraphReviewerStepSchema>;
export type FleetGraphReviewerLatency = z.infer<typeof reviewerWire.FleetGraphReviewerChainSchema>['latencyMs'];
export type FleetGraphReviewerLinks = z.infer<typeof reviewerWire.FleetGraphReviewerChainSchema>['links'];
export type FleetGraphReviewerTraceScore = z.infer<typeof reviewerWire.FleetGraphReviewerTraceScoreSchema>;
export type FleetGraphReviewerTraceQuality = z.infer<typeof reviewerWire.FleetGraphReviewerChainSchema>['traceQuality'];
export type FleetGraphReviewerHumanGate = z.infer<typeof reviewerWire.FleetGraphReviewerChainSchema>['humanGate'];
export type FleetGraphReviewerSourceMutationCheck = z.infer<typeof reviewerWire.FleetGraphReviewerChainSchema>['sourceMutationCheck'];
export type FleetGraphReviewerChain = z.infer<typeof reviewerWire.FleetGraphReviewerChainSchema>;
export type FleetGraphReviewerSummary = z.infer<typeof reviewerWire.FleetGraphReviewerSummarySchema>;
export type FleetGraphReviewerChainsResponse = z.infer<typeof reviewerWire.FleetGraphReviewerChainsResponseSchema>;
export type FleetGraphReviewerChainResponse = z.infer<typeof reviewerWire.FleetGraphReviewerChainResponseSchema>;
export type FleetGraphReviewerScenarioResponse = z.infer<typeof reviewerWire.FleetGraphReviewerScenarioResponseSchema>;
export type FleetGraphReviewerRepairResponse = z.infer<typeof reviewerWire.FleetGraphReviewerRepairResponseSchema>;
export type FleetGraphReviewerProofRequest = z.infer<typeof reviewerWire.FleetGraphReviewerProofRequestSchema>;
export type FleetGraphReviewerProofVerdict = z.infer<typeof reviewerWire.FleetGraphReviewerProofResponseSchema>['verdict'];
export type FleetGraphReviewerProofResponse = z.infer<typeof reviewerWire.FleetGraphReviewerProofResponseSchema>;
export type FleetGraphReviewerNotificationProjection = z.infer<typeof coreWire.FleetGraphNotificationResponseSchema>;
