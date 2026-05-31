// FleetGraph wire types shared between API responses and web clients.

export const FLEETGRAPH_CHAT_HISTORY_LIMIT: number = 6;

export type FleetGraphSeverity = 'low' | 'medium' | 'high' | 'urgent';

export type FleetGraphRunMode = 'proactive' | 'on_demand';

export type FleetGraphSignalType = 'blocked' | 'stale' | 'at_risk';

export type FleetGraphEvidenceVisibility = 'internal' | 'actor_visible' | 'restricted';

export const FLEETGRAPH_EVIDENCE_KIND_VALUES = [
  'source_issue',
  'source_sprint',
  'blocker',
  'stale',
  'at_risk',
  'dedupe',
  'finding',
  'restricted',
] as const;

export type FleetGraphEvidenceKind = (typeof FLEETGRAPH_EVIDENCE_KIND_VALUES)[number];

export type FleetGraphEvidenceFields = {
  kind: FleetGraphEvidenceKind;
  sourceDocumentId?: string;
  sourceType?: 'issue' | 'sprint';
  claim: string;
  excerpt?: string;
  visibility: FleetGraphEvidenceVisibility;
  redactionReason?: string;
};

export type FleetGraphEvidenceItem = FleetGraphEvidenceFields & {
  visibleFields: readonly string[];
};

export type FleetGraphEvidence = FleetGraphEvidenceFields & {
  visibleFields: string[];
};

export type FleetGraphRecommendedAction = {
  label?: string;
  text?: string;
  summary?: string;
};

export type FleetGraphProposedRecipient = {
  role?: string;
  userId?: string | null;
  displayName?: string;
  rationale?: string;
};

export type FleetGraphVisibleOutput = {
  title: string;
  summary: string;
  severity?: FleetGraphSeverity;
  confidence?: number;
  recommendedAction?: FleetGraphRecommendedAction;
  proposedRecipient?: FleetGraphProposedRecipient;
  recipientRationale?: string;
  uncertaintyNotes?: string[];
  evidence: FleetGraphEvidence[];
  humanGate: Record<string, unknown>;
  draftContent?: Record<string, unknown>;
  noSafeOutput?: boolean;
};

export type FleetGraphTrace = {
  mode: FleetGraphRunMode;
  decision: string;
  nodePath: string[];
  traceId?: string;
  traceUrl?: string;
  failureCategory?: string;
};

export type FleetGraphUsage = {
  modelCalls: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  billableInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  costCurrency?: 'USD';
  usageSource?: 'none' | 'model_response' | 'partial_model_response' | 'synthetic_calibration';
  costSource?: 'none' | 'model_response' | 'catalog_estimate' | 'env_estimate' | 'synthetic_calibration';
};

export type FleetGraphChangeSummaryRowLabel =
  | 'Now'
  | 'Changed'
  | 'Cleared'
  | 'Next'
  | 'Unknown'
  | 'Not done';

export type FleetGraphChangeSummaryRow = {
  label: FleetGraphChangeSummaryRowLabel;
  text: string;
};

export type FleetGraphChangeSummary = {
  headline: string;
  rows: FleetGraphChangeSummaryRow[];
};

export type FleetGraphChangeSummaryResponse = FleetGraphChangeSummary & {
  traceMetadata: FleetGraphTrace;
};

export type FleetGraphChatContextKind =
  | 'issue'
  | 'sprint'
  | 'project'
  | 'program'
  | 'document'
  | 'workspace'
  | 'notification'
  | 'finding';

export type FleetGraphPageContextSurface =
  | 'issues_list'
  | 'scoped_issues_list'
  | 'my_week'
  | 'document_issue_tab'
  | 'dashboard'
  | 'workspace';

export type FleetGraphPageContextItem = {
  kind: FleetGraphChatContextKind;
  id?: string;
  title: string;
  state?: string;
  priority?: string;
  owner?: string;
  summary?: string;
};

export type FleetGraphPageContext = {
  route: string;
  surface: FleetGraphPageContextSurface;
  title: string;
  filters?: Record<string, string | number | boolean | null>;
  sort?: string;
  viewMode?: string;
  counts?: Record<string, number>;
  visibleItems: FleetGraphPageContextItem[];
  selectedItemIds?: string[];
};

export type FleetGraphChatContext = {
  kind: FleetGraphChatContextKind;
  documentId?: string;
  findingId?: string;
  sourcePath?: string;
  pageContext?: FleetGraphPageContext;
  attachedContexts?: Array<{
    kind: FleetGraphChatContextKind;
    documentId?: string;
    findingId?: string;
    sourcePath?: string;
    pageContext?: FleetGraphPageContext;
  }>;
};

export type FleetGraphChatAnswerSource = {
  label: string;
  kind: string;
};

export type FleetGraphChatAnswer = {
  title: string;
  body: string;
  nextStep?: string;
  sources: FleetGraphChatAnswerSource[];
  humanGate: Record<string, unknown>;
};

export type FleetGraphChatHistoryEntry = {
  role: 'user' | 'assistant';
  content: string;
};

export type FleetGraphChatRequest = {
  prompt: string;
  context: FleetGraphChatContext;
  history?: FleetGraphChatHistoryEntry[];
  clientMessageId?: string;
};

export type FleetGraphChatResponse = {
  decision: string;
  answer: FleetGraphChatAnswer;
  context: FleetGraphChatContext;
  visibleOutput?: FleetGraphVisibleOutput;
  changeSummary?: FleetGraphChangeSummary;
  traceMetadata: FleetGraphTrace;
  usageMetadata?: FleetGraphUsage;
};

export type FleetGraphAttentionSignalFields = {
  signalType: FleetGraphSignalType;
  signalLabel: string;
  reason: string;
};

export type FleetGraphSourceReferenceFields = {
  sourceIssueId: string;
  sourceSprintId: string;
};

export type FleetGraphVisibleResponseFields = {
  visibleOutput: FleetGraphVisibleOutput;
  traceMetadata: FleetGraphTrace;
};

export type FleetGraphFindingResponse = FleetGraphAttentionSignalFields
  & FleetGraphSourceReferenceFields
  & FleetGraphVisibleResponseFields
  & {
    id: string;
    kind: 'blocker';
    status: string;
  };

export type FleetGraphFindingsListResponse = {
  findings: FleetGraphFindingResponse[];
};

export type FleetGraphBlastRadiusNodeKind =
  | 'finding'
  | 'issue'
  | 'sprint'
  | 'project'
  | 'program'
  | 'person';

export type FleetGraphBlastRadiusEdgeKind =
  | 'source_issue'
  | 'source_sprint'
  | 'project'
  | 'program'
  | 'assignee'
  | 'owner'
  | 'related_finding';

export type FleetGraphBlastRadiusNode = {
  id: string;
  kind: FleetGraphBlastRadiusNodeKind;
  title: string;
  subtitle?: string;
  status?: string;
  severity?: FleetGraphSeverity;
};

export type FleetGraphBlastRadiusEdge = {
  from: string;
  to: string;
  kind: FleetGraphBlastRadiusEdgeKind;
  label: string;
};

export type FleetGraphBlastRadiusResponse = {
  finding: FleetGraphFindingResponse;
  summary: string;
  nodes: FleetGraphBlastRadiusNode[];
  edges: FleetGraphBlastRadiusEdge[];
};

export type FleetGraphNotificationDisplayFields = {
  title: string;
  issueTitle: string;
  context: string;
  owner: string | null;
  notificationText: string;
  blockerText: string;
  sourcePath: string;
  detectedAt: string;
  isRead: boolean;
  readAt: string | null;
};

export type FleetGraphNotificationResponse = FleetGraphAttentionSignalFields
  & FleetGraphSourceReferenceFields
  & FleetGraphVisibleResponseFields
  & FleetGraphNotificationDisplayFields
  & {
    id: string;
    findingId: string;
  };

export type FleetGraphNotificationsListResponse = {
  notifications: FleetGraphNotificationResponse[];
};

export type FleetGraphReviewerChainStatus = 'complete' | 'in_progress' | 'broken' | 'failed';

export type FleetGraphReviewerStepStatus = 'pass' | 'pending' | 'broken' | 'failed';

export type FleetGraphReviewerStep = {
  key: string;
  label: string;
  status: FleetGraphReviewerStepStatus;
  at: string | null;
  durationMs?: number;
  evidence: string;
};

export type FleetGraphReviewerLatency = {
  shipToAttention?: number;
  attentionToWorker?: number;
  workerToRun?: number;
  runToFinding?: number;
  findingToNotification?: number;
  notificationToChat?: number;
  total?: number;
};

export type FleetGraphReviewerLinks = {
  sourceIssueId?: string;
  sourceSprintId?: string;
  attentionEventId?: string;
  workerTickId?: string;
  runId?: string;
  traceId?: string;
  traceUrl?: string;
  findingId?: string;
  notificationProjectionId?: string;
  chatRunId?: string;
};

export type FleetGraphReviewerTraceScore = {
  name: string;
  passed: boolean;
  value: string | number | boolean | null;
  comment: string;
};

export type FleetGraphReviewerTraceQuality = {
  passed: boolean;
  requiredDecisions: string[];
  observedDecisions: string[];
  scores: FleetGraphReviewerTraceScore[];
};

export type FleetGraphReviewerHumanGate = {
  required: boolean;
  state: 'present' | 'missing' | 'not_applicable';
  allowedActions: string[];
};

export type FleetGraphReviewerSourceMutationCheck = {
  passed: boolean;
  before: Record<string, string | number | boolean | null>;
  after: Record<string, string | number | boolean | null>;
  changedFields: string[];
};

export type FleetGraphReviewerNotificationProjection = FleetGraphNotificationResponse;

export type FleetGraphReviewerChain = {
  chainId: string;
  scenario: 'week-blocker' | 'existing';
  status: FleetGraphReviewerChainStatus;
  missing: string[];
  generatedAt: string;
  freshness: {
    generatedAt: string;
    newestRunAt: string | null;
    newestWorkerTickAt: string | null;
    proofAgeMs: number | null;
    workerAgeMs: number | null;
  };
  latencyMs: FleetGraphReviewerLatency;
  links: FleetGraphReviewerLinks;
  steps: FleetGraphReviewerStep[];
  visibleOutput?: FleetGraphVisibleOutput;
  notificationProjection?: FleetGraphReviewerNotificationProjection;
  humanGate: FleetGraphReviewerHumanGate;
  traceQuality: FleetGraphReviewerTraceQuality;
  sourceMutationCheck: FleetGraphReviewerSourceMutationCheck;
  usageSummary: FleetGraphUsage;
};

export type FleetGraphReviewerSummary = {
  generatedAt: string;
  status: FleetGraphReviewerChainStatus;
  chainCount: number;
  completeCount: number;
  brokenCount: number;
  requiredGates: FleetGraphReviewerTraceScore[];
  costSummary: FleetGraphUsage;
};

export type FleetGraphReviewerChainsResponse = {
  summary: FleetGraphReviewerSummary;
  chains: FleetGraphReviewerChain[];
};

export type FleetGraphReviewerChainResponse = {
  chain: FleetGraphReviewerChain;
};

export type FleetGraphReviewerScenarioResponse = {
  chainId: string;
  sourceIssueId: string;
  sourceSprintId: string;
  attentionEventId?: string;
  workerTickTriggered: boolean;
  chain: FleetGraphReviewerChain;
};

export type FleetGraphReviewerRepairResponse = {
  chainId: string;
  repaired: string[];
  unsupported: string[];
  chain: FleetGraphReviewerChain;
};

export type FleetGraphReviewerProofRequest = {
  chainId?: string;
};

export type FleetGraphReviewerProofVerdict = 'pass' | 'blocked' | 'fail' | 'risk';

export type FleetGraphReviewerProofResponse = {
  verdict: FleetGraphReviewerProofVerdict;
  generatedAt: string;
  chainId: string;
  artifactPaths: {
    json: string;
    markdown: string;
    html: string;
    publicJson?: string;
    publicMarkdown?: string;
    publicHtml?: string;
  };
};

export type FleetGraphRunResponse = {
  decision: string;
  finding?: FleetGraphFindingResponse;
  visibleOutput?: FleetGraphVisibleOutput;
  traceMetadata: FleetGraphTrace;
  usageMetadata?: FleetGraphUsage;
};

export type FleetGraphManualRunResult = {
  decision: string;
  findingId?: string;
  visibleOutput?: FleetGraphVisibleOutput;
  traceMetadata: FleetGraphTrace;
  usageMetadata?: FleetGraphUsage;
};

export type FleetGraphManualRunResponse = {
  mode: 'proactive';
  detectorDecisions: number;
  results: FleetGraphManualRunResult[];
};
