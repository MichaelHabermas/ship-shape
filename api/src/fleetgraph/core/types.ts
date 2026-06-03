// FleetGraph core types define runtime ports, graph input, and execution results.
import { pool } from '../../db/client.js';
import type { generateProactiveCreateText } from '../model.js';
import type { FleetGraphNodeRecorder } from '../observability-trace.js';
import { getFindingForGraph } from '../evidence.js';
import {
  dismissFleetGraphFinding,
  listFleetGraphAnchorRuns,
  listFleetGraphFindingsForSource,
  recordFleetGraphRun,
  refineFleetGraphDraft,
  resolveFleetGraphFinding,
  saveBlockedImportantIssueFinding,
  suppressFleetGraphFinding,
  type FleetGraphFinding,
  type FleetGraphRunRow,
  type JsonRecord,
  type RecordFleetGraphRunInput,
  type SaveBlockedImportantIssueFindingInput,
} from '../persistence.js';
import type { ShipClient } from '@ship/sdk';
import { Annotation } from '@langchain/langgraph';
import type {
  FleetGraphInput,
  FleetGraphResult,
  FleetGraphTraceMetadata,
} from '../types.js';

type QueryRunner = Pick<typeof pool, 'query'>;

export type FleetGraphPersistencePort = {
  saveFinding(input: SaveBlockedImportantIssueFindingInput): Promise<FleetGraphFinding>;
  recordRun(input: RecordFleetGraphRunInput): Promise<FleetGraphRunRow>;
  getFinding(workspaceId: string, findingId: string): Promise<FleetGraphFinding | null>;
  listFindingsForSource(input: { workspaceId: string; sourceIssueId?: string; sourceSprintId?: string }): Promise<FleetGraphFinding[]>;
  listAnchorRuns(input: { workspaceId: string; findingId: string; limit?: number }): Promise<FleetGraphRunRow[]>;
  refineDraft(input: {
    workspaceId: string;
    findingId: string;
    draftContent: JsonRecord;
    humanGate?: JsonRecord;
    traceMetadata?: JsonRecord;
  }): Promise<FleetGraphFinding | null>;
  dismissFinding(input: { workspaceId: string; findingId: string; dismissedBy: string }): Promise<FleetGraphFinding | null>;
  resolveFinding(input: { workspaceId: string; findingId: string }): Promise<FleetGraphFinding | null>;
  suppressFinding(input: { workspaceId: string; findingId: string }): Promise<FleetGraphFinding | null>;
};

export type FleetGraphCoreOptions = {
  db?: QueryRunner;
  persistence?: FleetGraphPersistencePort;
  generateProactiveText?: typeof generateProactiveCreateText;
  externalTrace?: Pick<FleetGraphTraceMetadata, 'traceId' | 'traceUrl'>;
  traceRecorder?: FleetGraphNodeRecorder;
  observabilityError?: string;
  forceReviewerTrace?: boolean;
  publicSourceClient?: ShipClient;
};

export const FleetGraphState = Annotation.Root({
  triggerType: Annotation<FleetGraphInput['trigger']['type']>(),
  triggerReason: Annotation<string>(),
  decision: Annotation<FleetGraphResult['decision'] | null>(),
});

export type FleetGraphStateValue = typeof FleetGraphState.State;

export type FleetGraphRuntimeContext = {
  input: FleetGraphInput;
  options: FleetGraphCoreOptions;
  persistence: FleetGraphPersistencePort;
  triggerReason: string;
  result: FleetGraphResult | null;
};

export type FleetGraphNodeName =
  | 'detectorDecision'
  | 'quietExit'
  | 'explainFinding'
  | 'refineDraft'
  | 'summarizeChanges'
  | 'contextChat'
  | 'resolveFinding'
  | 'suppressFinding'
  | 'dismissFinding'
  | 'errorRun';

export function defaultPersistence(db: QueryRunner = pool): FleetGraphPersistencePort {
  return {
    saveFinding: (input) => saveBlockedImportantIssueFinding(input, db),
    recordRun: (input) => recordFleetGraphRun(input, db),
    getFinding: (workspaceId, findingId) => getFindingForGraph({ workspaceId, findingId, db }),
    listFindingsForSource: (input) => listFleetGraphFindingsForSource(input, db),
    listAnchorRuns: (input) => listFleetGraphAnchorRuns(input, db),
    refineDraft: (input) => refineFleetGraphDraft(input, db),
    dismissFinding: (input) => dismissFleetGraphFinding(input, db),
    resolveFinding: (input) => resolveFleetGraphFinding(input, db),
    suppressFinding: (input) => suppressFleetGraphFinding(input, db),
  };
}
