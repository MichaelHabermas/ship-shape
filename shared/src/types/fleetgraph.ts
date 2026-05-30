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
