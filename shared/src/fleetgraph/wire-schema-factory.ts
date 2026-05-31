// FleetGraph Zod wire factories: single schema source for shared types and API OpenAPI registration.
import { z } from 'zod';
import { FLEETGRAPH_CHAT_HISTORY_LIMIT, FLEETGRAPH_EVIDENCE_KIND_VALUES } from '../types/fleetgraph.js';

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

  const FleetGraphReviewerWorkerTickResponseSchema = z.object({
    triggered: z.literal(true),
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
    FleetGraphReviewerWorkerTickResponseSchema,
  };
}

export function buildFleetGraphRouteWireSchemas(zod: Zod, core: FleetGraphCoreWireSchemas) {
  const z = zod;

  const FleetGraphFindingsListResponseSchema = z.object({
    findings: z.array(core.FleetGraphFindingResponseSchema),
  });

  const FleetGraphBlastRadiusNodeSchema = z.object({
    id: z.string(),
    kind: z.enum(['finding', 'issue', 'sprint', 'project', 'program', 'person']),
    title: z.string(),
    subtitle: z.string().optional(),
    status: z.string().optional(),
    severity: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  });

  const FleetGraphBlastRadiusEdgeSchema = z.object({
    from: z.string(),
    to: z.string(),
    kind: z.enum(['source_issue', 'source_sprint', 'project', 'program', 'assignee', 'owner', 'related_finding']),
    label: z.string(),
  });

  const FleetGraphBlastRadiusResponseSchema = z.object({
    finding: core.FleetGraphFindingResponseSchema,
    summary: z.string(),
    nodes: z.array(FleetGraphBlastRadiusNodeSchema),
    edges: z.array(FleetGraphBlastRadiusEdgeSchema),
  });

  const FleetGraphNotificationsListResponseSchema = z.object({
    notifications: z.array(core.FleetGraphNotificationResponseSchema),
  });

  const FleetGraphRunResponseSchema = z.object({
    decision: z.string(),
    finding: core.FleetGraphFindingResponseSchema.optional(),
    visibleOutput: core.FleetGraphVisibleOutputSchema.optional(),
    traceMetadata: core.FleetGraphTraceSchema,
    usageMetadata: core.FleetGraphUsageSchema.optional(),
  });

  const FleetGraphChangeSummaryRowSchema = z.object({
    label: z.enum(['Now', 'Changed', 'Cleared', 'Next', 'Unknown', 'Not done']),
    text: z.string(),
  });

  const FleetGraphChangeSummaryBodySchema = z.object({
    headline: z.string(),
    rows: z.array(FleetGraphChangeSummaryRowSchema),
  });

  const FleetGraphChangeSummaryResponseSchema = FleetGraphChangeSummaryBodySchema.extend({
    traceMetadata: core.FleetGraphTraceSchema,
  });

  const FleetGraphManualRunResultSchema = z.object({
    decision: z.string(),
    findingId: uuidSchema(z).optional(),
    visibleOutput: core.FleetGraphVisibleOutputSchema.optional(),
    traceMetadata: core.FleetGraphTraceSchema,
    usageMetadata: core.FleetGraphUsageSchema.optional(),
  });

  const FleetGraphManualRunResponseSchema = z.object({
    mode: z.literal('proactive'),
    detectorDecisions: z.number().int().nonnegative(),
    results: z.array(FleetGraphManualRunResultSchema),
  });

  const fleetGraphChatContextKind = z.enum([
    'issue', 'sprint', 'project', 'program', 'document', 'workspace', 'notification', 'finding',
  ]);

  const FleetGraphPageContextItemSchema = z.object({
    kind: fleetGraphChatContextKind,
    id: uuidSchema(z).optional(),
    title: z.string().trim().min(1).max(160),
    state: z.string().trim().max(80).optional(),
    priority: z.string().trim().max(80).optional(),
    owner: z.string().trim().max(120).optional(),
    summary: z.string().trim().max(280).optional(),
  });

  const FleetGraphPageContextSchema = z.object({
    route: z.string().trim().min(1).max(512),
    surface: z.enum(['issues_list', 'scoped_issues_list', 'my_week', 'document_issue_tab', 'dashboard', 'workspace']),
    title: z.string().trim().min(1).max(160),
    filters: z.record(z.union([z.string().max(128), z.number(), z.boolean(), z.null()])).optional(),
    sort: z.string().trim().max(80).optional(),
    viewMode: z.string().trim().max(80).optional(),
    counts: z.record(z.number().int().nonnegative()).optional(),
    visibleItems: z.array(FleetGraphPageContextItemSchema).max(25),
    selectedItemIds: z.array(uuidSchema(z)).max(8).optional(),
  });

  const FleetGraphChatContextFieldsSchema = z.object({
    kind: fleetGraphChatContextKind,
    documentId: uuidSchema(z).optional(),
    findingId: uuidSchema(z).optional(),
    sourcePath: z.string().max(512).optional(),
    pageContext: FleetGraphPageContextSchema.optional(),
  });

  function fleetGraphChatContextRefine(context: z.infer<typeof FleetGraphChatContextFieldsSchema>): boolean {
    return Boolean(context.findingId || context.documentId || context.kind === 'workspace' || context.pageContext);
  }

  const FleetGraphAttachedChatContextSchema = FleetGraphChatContextFieldsSchema.refine(
    fleetGraphChatContextRefine,
    { message: 'attached context requires findingId, documentId, or workspace kind' },
  );

  const FleetGraphChatContextSchema = FleetGraphChatContextFieldsSchema.extend({
    attachedContexts: z.array(FleetGraphAttachedChatContextSchema).max(8).optional(),
  }).refine(
    fleetGraphChatContextRefine,
    { message: 'context requires findingId, documentId, or workspace kind' },
  );

  const FleetGraphChatHistoryEntrySchema = z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4_000),
  });

  const FleetGraphChatRequestSchema = z.object({
    prompt: z.string().trim().min(1).max(2_000),
    context: FleetGraphChatContextSchema,
    history: z.array(FleetGraphChatHistoryEntrySchema).max(FLEETGRAPH_CHAT_HISTORY_LIMIT).optional(),
    clientMessageId: z.string().max(128).optional(),
  });

  const FleetGraphChatAnswerSchema = z.object({
    title: z.string(),
    body: z.string(),
    nextStep: z.string().optional(),
    sources: z.array(z.object({
      label: z.string(),
      kind: z.string(),
    })),
    humanGate: z.record(z.unknown()),
  });

  const FleetGraphChatResponseSchema = z.object({
    decision: z.string(),
    answer: FleetGraphChatAnswerSchema,
    context: FleetGraphChatContextSchema,
    visibleOutput: core.FleetGraphVisibleOutputSchema.optional(),
    changeSummary: FleetGraphChangeSummaryBodySchema.optional(),
    traceMetadata: core.FleetGraphTraceSchema,
    usageMetadata: core.FleetGraphUsageSchema.optional(),
  });

  return {
    FleetGraphFindingsListResponseSchema,
    FleetGraphBlastRadiusNodeSchema,
    FleetGraphBlastRadiusEdgeSchema,
    FleetGraphBlastRadiusResponseSchema,
    FleetGraphNotificationsListResponseSchema,
    FleetGraphRunResponseSchema,
    FleetGraphChangeSummaryRowSchema,
    FleetGraphChangeSummaryBodySchema,
    FleetGraphChangeSummaryResponseSchema,
    FleetGraphManualRunResultSchema,
    FleetGraphManualRunResponseSchema,
    FleetGraphPageContextItemSchema,
    FleetGraphPageContextSchema,
    FleetGraphChatContextSchema,
    FleetGraphChatHistoryEntrySchema,
    FleetGraphChatRequestSchema,
    FleetGraphChatAnswerSchema,
    FleetGraphChatResponseSchema,
  };
}

const coreWire = buildFleetGraphCoreWireSchemas(z);
const reviewerWire = buildReviewerWireSchemas(z, coreWire);
const routeWire = buildFleetGraphRouteWireSchemas(z, coreWire);

export const fleetGraphCoreWireSchemas = coreWire;
export const fleetGraphReviewerWireSchemas = reviewerWire;
export const fleetGraphRouteWireSchemas = routeWire;

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
export type FleetGraphReviewerWorkerTickResponse = z.infer<typeof reviewerWire.FleetGraphReviewerWorkerTickResponseSchema>;
export type FleetGraphFindingsListResponse = z.infer<typeof routeWire.FleetGraphFindingsListResponseSchema>;
export type FleetGraphBlastRadiusNode = z.infer<typeof routeWire.FleetGraphBlastRadiusNodeSchema>;
export type FleetGraphBlastRadiusEdge = z.infer<typeof routeWire.FleetGraphBlastRadiusEdgeSchema>;
export type FleetGraphBlastRadiusResponse = z.infer<typeof routeWire.FleetGraphBlastRadiusResponseSchema>;
export type FleetGraphNotificationsListResponse = z.infer<typeof routeWire.FleetGraphNotificationsListResponseSchema>;
export type FleetGraphRunResponse = z.infer<typeof routeWire.FleetGraphRunResponseSchema>;
export type FleetGraphChangeSummaryRow = z.infer<typeof routeWire.FleetGraphChangeSummaryRowSchema>;
export type FleetGraphChangeSummary = z.infer<typeof routeWire.FleetGraphChangeSummaryBodySchema>;
export type FleetGraphChangeSummaryResponse = z.infer<typeof routeWire.FleetGraphChangeSummaryResponseSchema>;
export type FleetGraphManualRunResult = z.infer<typeof routeWire.FleetGraphManualRunResultSchema>;
export type FleetGraphManualRunResponse = z.infer<typeof routeWire.FleetGraphManualRunResponseSchema>;
export type FleetGraphPageContextItem = z.infer<typeof routeWire.FleetGraphPageContextItemSchema>;
export type FleetGraphPageContext = z.infer<typeof routeWire.FleetGraphPageContextSchema>;
export type FleetGraphChatContext = z.infer<typeof routeWire.FleetGraphChatContextSchema>;
export type FleetGraphChatHistoryEntry = z.infer<typeof routeWire.FleetGraphChatHistoryEntrySchema>;
export type FleetGraphChatRequest = z.infer<typeof routeWire.FleetGraphChatRequestSchema>;
export type FleetGraphChatAnswer = z.infer<typeof routeWire.FleetGraphChatAnswerSchema>;
export type FleetGraphChatResponse = z.infer<typeof routeWire.FleetGraphChatResponseSchema>;
