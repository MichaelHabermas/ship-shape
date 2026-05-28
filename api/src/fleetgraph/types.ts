// FleetGraph core types define the shared graph boundary for proactive and on-demand runs.
import type { Principal } from '../security/principal.js';
import type { BlockedImportantIssueDedupeDecision, FleetGraphDetectorQuietExit } from './detector.js';
import type {
  FleetGraphFinding,
  FleetGraphRun,
  FleetGraphRunDecision,
  FleetGraphRunMode,
  FleetGraphSeverity,
  JsonRecord,
  RecordFleetGraphRunInput,
  SaveBlockedImportantIssueFindingInput,
} from './persistence.js';

export type FleetGraphEvidenceVisibility = 'internal' | 'actor_visible' | 'restricted';

export type FleetGraphEvidenceItem = {
  kind: 'source_issue' | 'source_sprint' | 'blocker' | 'dedupe' | 'finding' | 'restricted';
  sourceDocumentId?: string;
  sourceType?: 'issue' | 'sprint';
  claim: string;
  excerpt?: string;
  visibility: FleetGraphEvidenceVisibility;
  visibleFields: readonly string[];
  redactionReason?: string;
};

export type FleetGraphVisibleOutput = {
  title: string;
  summary: string;
  severity?: FleetGraphSeverity;
  confidence?: number;
  recommendedAction?: JsonRecord;
  proposedRecipient?: JsonRecord;
  recipientRationale?: string;
  uncertaintyNotes?: string[];
  evidence: FleetGraphEvidenceItem[];
  humanGate: JsonRecord;
  draftContent?: JsonRecord;
  noSafeOutput?: boolean;
};

export type FleetGraphChangeSummaryRow = {
  label: 'Now' | 'Changed' | 'Cleared' | 'Next' | 'Unknown' | 'Not done';
  text: string;
};

export type FleetGraphChangeSummary = {
  headline: string;
  rows: FleetGraphChangeSummaryRow[];
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

export type FleetGraphTraceMetadata = {
  traceId?: string;
  traceUrl?: string;
  mode: FleetGraphRunMode;
  decision: FleetGraphRunDecision;
  nodePath: string[];
  failureCategory?: string;
};

export type FleetGraphTokenMetadata = {
  modelCalls: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type FleetGraphCostMetadata = {
  estimatedCostUsd?: number;
};

export type FleetGraphDecisionPacket = {
  severity: FleetGraphSeverity;
  confidence: number;
  title: string;
  summary: string;
  recommendedAction: JsonRecord;
  draftContent: JsonRecord;
  proposedRecipient: JsonRecord;
  humanGate: JsonRecord;
  uncertaintyNotes: string[];
};

export type FleetGraphTrigger =
  | {
      type: 'detector_decision';
      detectorDecision: BlockedImportantIssueDedupeDecision;
    }
  | {
      type: 'quiet_exit';
      quietExits: FleetGraphDetectorQuietExit[];
    }
  | {
      type: 'explain_finding';
      findingId: string;
    }
  | {
      type: 'refine_draft';
      findingId: string;
      instruction: string;
    }
  | {
      type: 'summarize_changes';
      findingId: string;
    }
  | {
      type: 'context_chat';
      prompt: string;
      context: FleetGraphChatContext;
    }
  | {
      type: 'resolve_finding';
      findingId: string;
    }
  | {
      type: 'dismiss_finding';
      findingId: string;
      dismissedBy: string;
    }
  | {
      type: 'error';
      message: string;
    };

export type FleetGraphInput = {
  workspaceId: string;
  mode: FleetGraphRunMode;
  principal?: Principal;
  trigger: FleetGraphTrigger;
  triggerReason?: string;
};

export type FleetGraphResult = {
  decision: FleetGraphRunDecision;
  finding?: FleetGraphFinding | null;
  run: FleetGraphRun;
  findingInput?: SaveBlockedImportantIssueFindingInput;
  runInput: RecordFleetGraphRunInput;
  visibleOutput?: FleetGraphVisibleOutput;
  changeSummary?: FleetGraphChangeSummary;
  evidence: FleetGraphEvidenceItem[];
  traceMetadata: FleetGraphTraceMetadata;
  tokenMetadata: FleetGraphTokenMetadata;
  costMetadata: FleetGraphCostMetadata;
  errorMetadata: JsonRecord;
};
