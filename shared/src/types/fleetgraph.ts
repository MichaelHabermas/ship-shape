// FleetGraph wire types shared between API responses and web clients.

export type FleetGraphSeverity = 'low' | 'medium' | 'high' | 'urgent';

export type FleetGraphRunMode = 'proactive' | 'on_demand';

export type FleetGraphEvidenceVisibility = 'internal' | 'actor_visible' | 'restricted';

export type FleetGraphEvidence = {
  kind: string;
  sourceDocumentId?: string;
  sourceType?: 'issue' | 'sprint';
  claim: string;
  excerpt?: string;
  visibility: FleetGraphEvidenceVisibility;
  visibleFields: string[];
  redactionReason?: string;
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

export type FleetGraphChatRequest = {
  prompt: string;
  context: FleetGraphChatContext;
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

export type FleetGraphFindingResponse = {
  id: string;
  kind: 'blocker';
  status: string;
  sourceIssueId: string;
  sourceSprintId: string;
  visibleOutput: FleetGraphVisibleOutput;
  traceMetadata: FleetGraphTrace;
};

export type FleetGraphFindingsListResponse = {
  findings: FleetGraphFindingResponse[];
};

export type FleetGraphNotificationResponse = {
  id: string;
  findingId: string;
  title: string;
  issueTitle: string;
  context: string;
  owner: string | null;
  blockerText: string;
  sourceIssueId: string;
  sourceSprintId: string;
  sourcePath: string;
  detectedAt: string;
  visibleOutput: FleetGraphVisibleOutput;
  traceMetadata: FleetGraphTrace;
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
