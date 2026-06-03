// Converts FleetGraph runtime decisions into persisted run inputs and public results.
import type {
  FleetGraphFinding,
  FleetGraphRunRow,
  JsonRecord,
  RecordFleetGraphRunInput,
  SaveBlockedImportantIssueFindingInput,
} from '../persistence.js';
import type { FleetGraphChangeSummary, FleetGraphEvidenceItem } from '@ship/shared';
import type {
  FleetGraphCostMetadata,
  FleetGraphInput,
  FleetGraphResult,
  FleetGraphTokenMetadata,
  FleetGraphTraceMetadata,
  FleetGraphVisibleOutput,
} from '../types.js';
import { traceMetadataJson } from '../trace.js';
import { isJsonRecord } from './json.js';

export function runInputFor(input: {
  input: FleetGraphInput;
  triggerReason: string;
  decision: RecordFleetGraphRunInput['decision'];
  findingId?: string | null;
  sourceIssueId?: string | null;
  sourceSprintId?: string | null;
  dedupeKey?: string | null;
  evidence?: unknown[];
  output: unknown;
  traceMetadata: FleetGraphTraceMetadata;
  tokenMetadata: FleetGraphTokenMetadata;
  costMetadata: FleetGraphCostMetadata;
  errorMetadata?: JsonRecord;
}): RecordFleetGraphRunInput {
  return {
    workspaceId: input.input.workspaceId,
    findingId: input.findingId ?? null,
    sourceIssueId: input.sourceIssueId ?? null,
    sourceSprintId: input.sourceSprintId ?? null,
    mode: input.input.mode,
    triggerReason: input.triggerReason,
    decision: input.decision,
    dedupeKey: input.dedupeKey ?? null,
    inputSnapshot: { triggerType: input.input.trigger.type },
    evidenceSnapshot: input.evidence ?? [],
    outputSnapshot: isJsonRecord(input.output) ? input.output : { value: input.output },
    traceMetadata: traceMetadataJson(input.traceMetadata),
    tokenMetadata: input.tokenMetadata,
    costMetadata: input.costMetadata,
    errorMetadata: input.errorMetadata ?? {},
  };
}

export function resultFor(input: {
  decision: FleetGraphResult['decision'];
  finding?: FleetGraphFinding | null;
  run: FleetGraphRunRow;
  findingInput?: SaveBlockedImportantIssueFindingInput;
  runInput: RecordFleetGraphRunInput;
  visibleOutput?: FleetGraphVisibleOutput;
  changeSummary?: FleetGraphChangeSummary;
  evidence: FleetGraphEvidenceItem[];
  traceMetadata: FleetGraphTraceMetadata;
  tokenMetadata: FleetGraphTokenMetadata;
  costMetadata: FleetGraphCostMetadata;
  errorMetadata?: JsonRecord;
}): FleetGraphResult {
  return {
    decision: input.decision,
    finding: input.finding,
    run: input.run,
    ...(input.findingInput ? { findingInput: input.findingInput } : {}),
    runInput: input.runInput,
    ...(input.visibleOutput ? { visibleOutput: input.visibleOutput } : {}),
    ...(input.changeSummary ? { changeSummary: input.changeSummary } : {}),
    evidence: input.evidence,
    traceMetadata: input.traceMetadata,
    tokenMetadata: input.tokenMetadata,
    costMetadata: input.costMetadata,
    errorMetadata: input.errorMetadata ?? {},
  };
}
