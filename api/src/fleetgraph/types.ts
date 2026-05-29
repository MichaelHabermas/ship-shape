// FleetGraph core types define the shared graph boundary for proactive and on-demand runs.
import type {
  FleetGraphChangeSummary,
  FleetGraphChatContext,
  FleetGraphEvidenceItem,
  FleetGraphRunMode,
  FleetGraphSeverity,
  FleetGraphTrace,
} from '@ship/shared';
import type { Principal } from '../security/principal.js';
import type { FleetGraphAttentionDedupeDecision, FleetGraphDetectorQuietExit } from './detection/detector.js';
import type {
  FleetGraphFinding,
  FleetGraphRun,
  FleetGraphRunDecision,
  JsonRecord,
  RecordFleetGraphRunInput,
  SaveBlockedImportantIssueFindingInput,
} from './persistence.js';

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

export type FleetGraphTraceMetadata = Omit<FleetGraphTrace, 'decision'> & {
  decision: FleetGraphRunDecision;
  observability?: JsonRecord;
};

export type FleetGraphTokenMetadata = {
  modelCalls: number;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  usageSource?: 'none' | 'model_response' | 'partial_model_response' | 'synthetic_calibration';
  noUsageReason?: string;
};

export type FleetGraphCostMetadata = {
  estimatedCostUsd?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
  currency?: 'USD';
  costSource?: 'none' | 'model_response' | 'catalog_estimate' | 'env_estimate' | 'synthetic_calibration';
  noCostReason?: string;
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
      detectorDecision: FleetGraphAttentionDedupeDecision;
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
      type: 'suppress_finding';
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
