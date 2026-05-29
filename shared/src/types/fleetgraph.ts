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

export type FleetGraphChatContext = {
  kind: FleetGraphChatContextKind;
  documentId?: string;
  findingId?: string;
  sourcePath?: string;
  attachedContexts?: Array<{
    kind: FleetGraphChatContextKind;
    documentId?: string;
    findingId?: string;
    sourcePath?: string;
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
};

export type FleetGraphManualRunResult = {
  decision: string;
  findingId?: string;
  visibleOutput?: FleetGraphVisibleOutput;
  traceMetadata: FleetGraphTrace;
};

export type FleetGraphManualRunResponse = {
  mode: 'proactive';
  detectorDecisions: number;
  results: FleetGraphManualRunResult[];
};
