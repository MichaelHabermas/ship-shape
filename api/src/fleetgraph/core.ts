// FleetGraph core runs the shared proactive/on-demand LangGraph decision runtime.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { pool } from '../db/client.js';
import type { FleetGraphDetectorQuietExit } from './detector.js';
import {
  evidenceFromDetectorCandidate,
  filterEvidenceForActor,
  getFindingForGraph,
  recommendedActionForVisibleOutput,
  proposedRecipientForVisibleOutput,
  recipientRationaleForRole,
  visibleOutputForFinding,
} from './evidence.js';
import { generateProactiveCreateText } from './model.js';
import {
  dismissFleetGraphFinding,
  listFleetGraphAnchorRuns,
  recordFleetGraphRun,
  refineFleetGraphDraft,
  resolveFleetGraphFinding,
  saveBlockedImportantIssueFinding,
  suppressFleetGraphFinding,
  type FleetGraphFinding,
  type FleetGraphRun,
  type JsonRecord,
  type RecordFleetGraphRunInput,
  type SaveBlockedImportantIssueFindingInput,
} from './persistence.js';
import { fleetGraphTraceMetadata, traceMetadataJson } from './trace.js';
import type {
  FleetGraphChangeSummary,
  FleetGraphCostMetadata,
  FleetGraphDecisionPacket,
  FleetGraphEvidenceItem,
  FleetGraphInput,
  FleetGraphResult,
  FleetGraphTokenMetadata,
  FleetGraphTraceMetadata,
  FleetGraphVisibleOutput,
} from './types.js';

type QueryRunner = Pick<typeof pool, 'query'>;

export type FleetGraphPersistencePort = {
  saveFinding(input: SaveBlockedImportantIssueFindingInput): Promise<FleetGraphFinding>;
  recordRun(input: RecordFleetGraphRunInput): Promise<FleetGraphRun>;
  getFinding(workspaceId: string, findingId: string): Promise<FleetGraphFinding | null>;
  listAnchorRuns(input: { workspaceId: string; findingId: string; limit?: number }): Promise<FleetGraphRun[]>;
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
};

const FleetGraphState = Annotation.Root({
  triggerType: Annotation<FleetGraphInput['trigger']['type']>(),
  triggerReason: Annotation<string>(),
  decision: Annotation<FleetGraphResult['decision'] | null>(),
});

type FleetGraphStateValue = typeof FleetGraphState.State;
type FleetGraphRuntimeContext = {
  input: FleetGraphInput;
  options: FleetGraphCoreOptions;
  persistence: FleetGraphPersistencePort;
  triggerReason: string;
  result: FleetGraphResult | null;
};
type FleetGraphNodeName =
  | 'detectorDecision'
  | 'quietExit'
  | 'explainFinding'
  | 'refineDraft'
  | 'summarizeChanges'
  | 'resolveFinding'
  | 'dismissFinding'
  | 'errorRun';

function defaultPersistence(db: QueryRunner = pool): FleetGraphPersistencePort {
  return {
    saveFinding: (input) => saveBlockedImportantIssueFinding(input, db),
    recordRun: (input) => recordFleetGraphRun(input, db),
    getFinding: (workspaceId, findingId) => getFindingForGraph({ workspaceId, findingId, db }),
    listAnchorRuns: (input) => listFleetGraphAnchorRuns(input, db),
    refineDraft: (input) => refineFleetGraphDraft(input, db),
    dismissFinding: (input) => dismissFleetGraphFinding(input, db),
    resolveFinding: (input) => resolveFleetGraphFinding(input, db),
    suppressFinding: (input) => suppressFleetGraphFinding(input, db),
  };
}

export async function runFleetGraph(
  input: FleetGraphInput,
  options: FleetGraphCoreOptions = {}
): Promise<FleetGraphResult> {
  const persistence = options.persistence ?? defaultPersistence(options.db);
  const triggerReason = input.triggerReason ?? input.trigger.type;

  try {
    const context: FleetGraphRuntimeContext = {
      input,
      options,
      persistence,
      triggerReason,
      result: null,
    };
    const graph = fleetGraphRuntime(context);
    await graph.invoke({
      triggerType: input.trigger.type,
      triggerReason,
      decision: null,
    });
    if (context.result) return context.result;
    return runError(input, persistence, triggerReason, 'FleetGraph graph completed without a result');
  } catch (_error) {
    return runError(input, persistence, triggerReason, 'FleetGraph internal error');
  }
}

function fleetGraphRuntime(context: FleetGraphRuntimeContext) {
  return new StateGraph(FleetGraphState)
    .addNode('normalizeTrigger', (state) => normalizeTriggerNode(state, context))
    .addNode('detectorDecision', () => detectorDecisionNode(context))
    .addNode('quietExit', () => quietExitNode(context))
    .addNode('explainFinding', () => explainFindingNode(context))
    .addNode('refineDraft', () => refineDraftNode(context))
    .addNode('summarizeChanges', () => summarizeChangesNode(context))
    .addNode('resolveFinding', () => resolveFindingNode(context))
    .addNode('dismissFinding', () => dismissFindingNode(context))
    .addNode('errorRun', () => errorRunNode(context))
    .addEdge(START, 'normalizeTrigger')
    .addConditionalEdges('normalizeTrigger', routeFleetGraphTrigger)
    .addEdge('detectorDecision', END)
    .addEdge('quietExit', END)
    .addEdge('explainFinding', END)
    .addEdge('refineDraft', END)
    .addEdge('summarizeChanges', END)
    .addEdge('resolveFinding', END)
    .addEdge('dismissFinding', END)
    .addEdge('errorRun', END)
    .compile({ name: 'fleetgraph.shared_runtime' });
}

function normalizeTriggerNode(state: FleetGraphStateValue, context: FleetGraphRuntimeContext): Partial<FleetGraphStateValue> {
  return { triggerReason: state.triggerReason ?? context.triggerReason };
}

function routeFleetGraphTrigger(state: FleetGraphStateValue): FleetGraphNodeName {
  switch (state.triggerType) {
    case 'detector_decision':
      return 'detectorDecision';
    case 'quiet_exit':
      return 'quietExit';
    case 'explain_finding':
      return 'explainFinding';
    case 'refine_draft':
      return 'refineDraft';
    case 'summarize_changes':
      return 'summarizeChanges';
    case 'resolve_finding':
      return 'resolveFinding';
    case 'dismiss_finding':
      return 'dismissFinding';
    case 'error':
      return 'errorRun';
  }
}

async function detectorDecisionNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  context.result = await runDetectorDecision(
    context.input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'detector_decision' }> },
    context.persistence,
    context.triggerReason,
    context.options
  );
  return { decision: context.result.decision };
}

async function quietExitNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  const trigger = context.input.trigger as Extract<FleetGraphInput['trigger'], { type: 'quiet_exit' }>;
  context.result = await runQuietExit(context.input, context.persistence, context.triggerReason, trigger.quietExits, context.options);
  return { decision: context.result.decision };
}

async function explainFindingNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  context.result = await runExplainFinding(
    context.input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'explain_finding' }> },
    context.persistence,
    context.triggerReason,
    context.options
  );
  return { decision: context.result.decision };
}

async function refineDraftNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  context.result = await runRefineDraft(
    context.input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'refine_draft' }> },
    context.persistence,
    context.triggerReason,
    context.options
  );
  return { decision: context.result.decision };
}

async function summarizeChangesNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  context.result = await runSummarizeChanges(
    context.input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'summarize_changes' }> },
    context.persistence,
    context.triggerReason,
    context.options
  );
  return { decision: context.result.decision };
}

async function resolveFindingNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  context.result = await runResolveFinding(
    context.input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'resolve_finding' }> },
    context.persistence,
    context.triggerReason,
    context.options
  );
  return { decision: context.result.decision };
}

async function dismissFindingNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  context.result = await runDismissFinding(
    context.input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'dismiss_finding' }> },
    context.persistence,
    context.triggerReason,
    context.options
  );
  return { decision: context.result.decision };
}

async function errorRunNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  const trigger = context.input.trigger as Extract<FleetGraphInput['trigger'], { type: 'error' }>;
  context.result = await runError(context.input, context.persistence, context.triggerReason, trigger.message);
  return { decision: context.result.decision };
}

async function runDetectorDecision(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'detector_decision' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  const detectorDecision = input.trigger.detectorDecision;
  const candidate = detectorDecision.candidate;
  const baseEvidence = evidenceFromDetectorCandidate(candidate);
  const evidenceBundle = await filterEvidenceForActor({
    principal: input.principal,
    workspaceId: input.workspaceId,
    sourceIssueId: candidate.issue_id,
    sourceSprintId: candidate.sprint_id,
    evidence: baseEvidence,
    db: options.db,
  });

  if (evidenceBundle.noSafeOutput) {
    return runQuietExit(input, persistence, triggerReason, [{
      reason: 'insufficient_visible_evidence',
      count: 1,
    }], options);
  }

  const model = options.generateProactiveText ?? generateProactiveCreateText;
  const modelResult = detectorDecision.decision === 'create_finding'
    ? await model({ candidate })
    : {
        summary: deterministicUpdateSummary(candidateTitle(candidate.issue_title)),
        draftMessage: `Refresh the unblock plan for ${candidate.issue_title}.`,
        tokenMetadata: { modelCalls: 0 },
      };
  const decision = detectorDecision.decision;
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision,
    nodePath: [
      'normalizeTrigger',
      'resolveScope',
      'fetchCurrentObject',
      'filterVisibleEvidence',
      detectorDecision.decision === 'create_finding' ? 'reasonProactiveCreate' : 'refreshExistingFinding',
      'persistFleetGraphState',
      'produceOutput',
    ],
    ...options.externalTrace,
  });
  const packet = decisionPacketFromCandidate(candidate, modelResult.summary, modelResult.draftMessage);
  const findingInput: SaveBlockedImportantIssueFindingInput = {
    workspaceId: input.workspaceId,
    sourceIssueId: candidate.issue_id,
    sourceSprintId: candidate.sprint_id,
    status: 'needs_confirmation',
    severity: packet.severity,
    confidence: packet.confidence,
    title: packet.title,
    summary: packet.summary,
    evidenceSnapshot: evidenceBundle.evidence,
    recommendedAction: recommendedActionForVisibleOutput(packet.recommendedAction),
    draftContent: packet.draftContent,
    proposedRecipient: packet.proposedRecipient,
    humanGate: packet.humanGate,
    traceMetadata: traceMetadataJson(traceMetadata),
    runMetadata: { detectorDecision: detectorDecision.decision, uncertaintyNotes: packet.uncertaintyNotes },
  };
  const finding = await persistence.saveFinding(findingInput);
  const visibleOutput = visibleOutputFromPacket(packet, evidenceBundle.evidence);
  const runInput = runInputFor({
    input,
    triggerReason,
    decision,
    findingId: finding.id,
    sourceIssueId: candidate.issue_id,
    sourceSprintId: candidate.sprint_id,
    dedupeKey: candidate.dedupeKey,
    evidence: evidenceBundle.evidence,
    output: visibleOutput,
    traceMetadata,
    tokenMetadata: modelResult.tokenMetadata,
    costMetadata: {},
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision,
    finding,
    run,
    findingInput,
    runInput,
    visibleOutput,
    evidence: evidenceBundle.evidence,
    traceMetadata,
    tokenMetadata: modelResult.tokenMetadata,
    costMetadata: {},
  });
}

async function runQuietExit(
  input: FleetGraphInput,
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  quietExits: FleetGraphDetectorQuietExit[],
  options: FleetGraphCoreOptions = {}
): Promise<FleetGraphResult> {
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'quiet_exit',
    nodePath: ['normalizeTrigger', 'detector', 'quietExit', 'persistFleetGraphState'],
    ...options.externalTrace,
  });
  const output = {
    quietExits,
    summary: 'FleetGraph exited quietly before model reasoning.',
  };
  const runInput = runInputFor({
    input,
    triggerReason,
    decision: 'quiet_exit',
    output,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision: 'quiet_exit',
    finding: null,
    run,
    runInput,
    visibleOutput: {
      title: 'FleetGraph quiet exit',
      summary: output.summary,
      evidence: [],
      humanGate: { required: false },
    },
    evidence: [],
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
}

async function runExplainFinding(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'explain_finding' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  const finding = await persistence.getFinding(input.workspaceId, input.trigger.findingId);
  if (!finding) return runError(input, persistence, triggerReason, 'FleetGraph finding not found');

  const { evidence, output } = await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: input.workspaceId,
    finding,
    db: options.db,
  });
  const decision = output.noSafeOutput ? 'quiet_exit' : 'explain';
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision,
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'produceOutput'],
    ...options.externalTrace,
  });
  const runInput = runInputFor({
    input,
    triggerReason,
    decision,
    findingId: finding.id,
    sourceIssueId: finding.source_issue_id,
    sourceSprintId: finding.source_sprint_id,
    dedupeKey: finding.dedupe_key,
    evidence,
    output,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision,
    finding,
    run,
    runInput,
    visibleOutput: output,
    evidence,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
}

async function runSummarizeChanges(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'summarize_changes' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  const finding = await persistence.getFinding(input.workspaceId, input.trigger.findingId);
  if (!finding) return runError(input, persistence, triggerReason, 'FleetGraph finding not found');

  const { evidence, output } = await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: input.workspaceId,
    finding,
    db: options.db,
  });
  if (output.noSafeOutput) {
    return runRestrictedFindingQuietExit(input, persistence, triggerReason, finding, evidence, output, options);
  }

  const anchors = await persistence.listAnchorRuns({ workspaceId: input.workspaceId, findingId: finding.id, limit: 2 });
  const previousOutput = visibleOutputFromRun(anchors[1]);
  const changeSummary = changeSummaryFromOutputs(output, previousOutput);
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'summarize_changes',
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'compareAnchor', 'produceOutput'],
    ...options.externalTrace,
  });
  const runInput = runInputFor({
    input,
    triggerReason,
    decision: 'summarize_changes',
    findingId: finding.id,
    sourceIssueId: finding.source_issue_id,
    sourceSprintId: finding.source_sprint_id,
    dedupeKey: finding.dedupe_key,
    evidence,
    output: changeSummary,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision: 'summarize_changes',
    finding,
    run,
    runInput,
    visibleOutput: output,
    changeSummary,
    evidence,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
}

async function runRefineDraft(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'refine_draft' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  const finding = await persistence.getFinding(input.workspaceId, input.trigger.findingId);
  if (!finding) return runError(input, persistence, triggerReason, 'FleetGraph finding not found');

  const { evidence, output } = await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: input.workspaceId,
    finding,
    db: options.db,
  });
  if (output.noSafeOutput) {
    return runRestrictedFindingQuietExit(input, persistence, triggerReason, finding, evidence, output, options);
  }

  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'refine_draft',
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'refineDraft', 'persistFleetGraphState', 'produceOutput'],
    ...options.externalTrace,
  });
  const draftContent = {
    ...(isJsonRecord(finding.draft_content) ? finding.draft_content : {}),
    refinementInstruction: input.trigger.instruction,
    message: deterministicRefinedDraft(finding, input.trigger.instruction),
  };
  const refinedFinding = await persistence.refineDraft({
    workspaceId: input.workspaceId,
    findingId: finding.id,
    draftContent,
    humanGate: { required: true, reason: 'human_must_approve_before_ship_or_external_action' },
    traceMetadata: traceMetadataJson(traceMetadata),
  });
  const visibleOutput = {
    ...output,
    draftContent,
  };
  const runInput = runInputFor({
    input,
    triggerReason,
    decision: 'refine_draft',
    findingId: finding.id,
    sourceIssueId: finding.source_issue_id,
    sourceSprintId: finding.source_sprint_id,
    dedupeKey: finding.dedupe_key,
    evidence,
    output: visibleOutput,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision: 'refine_draft',
    finding: refinedFinding,
    run,
    runInput,
    visibleOutput,
    evidence,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
}

async function runRestrictedFindingQuietExit(
  input: FleetGraphInput,
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  finding: FleetGraphFinding,
  evidence: FleetGraphEvidenceItem[],
  output: FleetGraphVisibleOutput,
  options: FleetGraphCoreOptions = {}
): Promise<FleetGraphResult> {
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'quiet_exit',
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'quietExit', 'persistFleetGraphState'],
    ...options.externalTrace,
  });
  const runInput = runInputFor({
    input,
    triggerReason,
    decision: 'quiet_exit',
    findingId: finding.id,
    sourceIssueId: finding.source_issue_id,
    sourceSprintId: finding.source_sprint_id,
    dedupeKey: finding.dedupe_key,
    evidence,
    output,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision: 'quiet_exit',
    finding,
    run,
    runInput,
    visibleOutput: output,
    evidence,
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
}

async function runResolveFinding(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'resolve_finding' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  return runStatusOnly(
    input,
    persistence,
    triggerReason,
    'resolve',
    () => persistence.resolveFinding({ workspaceId: input.workspaceId, findingId: input.trigger.findingId }),
    options
  );
}

async function runDismissFinding(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'dismiss_finding' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  const finding = await persistence.getFinding(input.workspaceId, input.trigger.findingId);
  if (!finding) return runError(input, persistence, triggerReason, 'FleetGraph finding not found');

  const { evidence, output } = await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: input.workspaceId,
    finding,
    db: options.db,
  });
  if (output.noSafeOutput) {
    return runRestrictedFindingQuietExit(input, persistence, triggerReason, finding, evidence, output, options);
  }

  return runStatusOnly(input, persistence, triggerReason, 'dismiss', () =>
    persistence.dismissFinding({
      workspaceId: input.workspaceId,
      findingId: input.trigger.findingId,
      dismissedBy: input.trigger.dismissedBy,
    }),
    options
  );
}

async function runStatusOnly(
  input: FleetGraphInput,
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  decision: 'dismiss' | 'resolve',
  mutate: () => Promise<FleetGraphFinding | null>,
  options: FleetGraphCoreOptions = {}
): Promise<FleetGraphResult> {
  const finding = await mutate();
  if (!finding) return runError(input, persistence, triggerReason, 'FleetGraph finding not found');

  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision,
    nodePath: ['normalizeTrigger', 'resolveScope', 'persistFleetGraphState', 'produceOutput'],
    ...options.externalTrace,
  });
  const runInput = runInputFor({
    input,
    triggerReason,
    decision,
    findingId: finding.id,
    sourceIssueId: finding.source_issue_id,
    sourceSprintId: finding.source_sprint_id,
    dedupeKey: finding.dedupe_key,
    output: { status: finding.status },
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision,
    finding,
    run,
    runInput,
    visibleOutput: {
      title: `FleetGraph ${decision}`,
      summary: `FleetGraph finding ${decision} recorded without Ship mutation.`,
      evidence: [],
      humanGate: { required: false },
    },
    evidence: [],
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
  });
}

async function runError(
  input: FleetGraphInput,
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  message: string
): Promise<FleetGraphResult> {
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'error',
    nodePath: ['normalizeTrigger', 'error', 'persistFleetGraphState'],
    failureCategory: 'reasoning',
  });
  const errorMetadata = {
    category: message === 'FleetGraph finding not found' ? 'not_found' : 'internal',
  };
  const runInput = runInputFor({
    input,
    triggerReason,
    decision: 'error',
    output: {},
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
    errorMetadata,
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision: 'error',
    finding: null,
    run,
    runInput,
    visibleOutput: {
      title: 'FleetGraph error',
      summary: 'FleetGraph could not complete this run.',
      evidence: [],
      humanGate: { required: false },
    },
    evidence: [],
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
    errorMetadata,
  });
}

function decisionPacketFromCandidate(
  candidate: Extract<FleetGraphInput['trigger'], { type: 'detector_decision' }>['detectorDecision']['candidate'],
  summary: string,
  draftMessage: string
): FleetGraphDecisionPacket {
  return {
    severity: candidate.issue_priority,
    confidence: 0.86,
    title: `Blocked active-week work: ${candidate.issue_title}`,
    summary,
    recommendedAction: {
      type: 'confirm_unblock_path',
      label: 'Confirm the unblock path',
      requiresHumanApproval: true,
    },
    draftContent: {
      kind: 'unblock_message',
      message: draftMessage,
      source: 'fleetgraph',
    },
    proposedRecipient: {
      role: candidate.issue_assignee_id ? 'issue_assignee' : 'sprint_owner',
      userId: candidate.issue_assignee_id ?? candidate.sprint_owner_id ?? null,
      rationale: 'Recipient is the issue assignee, falling back to the sprint owner.',
    },
    humanGate: {
      required: true,
      reason: 'FleetGraph cannot contact anyone or mutate Ship without human approval.',
    },
    uncertaintyNotes: [
      'FleetGraph sees a blocker signal, but a human must confirm the current unblock path.',
    ],
  };
}

function visibleOutputFromPacket(
  packet: FleetGraphDecisionPacket,
  evidence: FleetGraphEvidenceItem[]
): FleetGraphVisibleOutput {
  return {
    title: packet.title,
    summary: packet.summary,
    severity: packet.severity,
    confidence: packet.confidence,
    recommendedAction: packet.recommendedAction,
    proposedRecipient: proposedRecipientForVisibleOutput(packet.proposedRecipient),
    recipientRationale: recipientRationaleForRole(packet.proposedRecipient.role),
    uncertaintyNotes: packet.uncertaintyNotes,
    evidence,
    humanGate: packet.humanGate,
    draftContent: packet.draftContent,
  };
}

function visibleOutputFromRun(run: FleetGraphRun | undefined): FleetGraphVisibleOutput | null {
  if (!run || !isJsonRecord(run.output_snapshot)) return null;
  const output = run.output_snapshot;
  if (typeof output.title !== 'string' || typeof output.summary !== 'string') return null;
  return {
    title: output.title,
    summary: output.summary,
    severity: fleetGraphSeverity(output.severity),
    recommendedAction: isJsonRecord(output.recommendedAction) ? output.recommendedAction : undefined,
    proposedRecipient: isJsonRecord(output.proposedRecipient) ? output.proposedRecipient : undefined,
    uncertaintyNotes: Array.isArray(output.uncertaintyNotes)
      ? output.uncertaintyNotes.filter((note): note is string => typeof note === 'string' && note.trim().length > 0)
      : undefined,
    evidence: [],
    humanGate: isJsonRecord(output.humanGate) ? output.humanGate : {},
    draftContent: isJsonRecord(output.draftContent) ? output.draftContent : undefined,
  };
}

function changeSummaryFromOutputs(current: FleetGraphVisibleOutput, previous: FleetGraphVisibleOutput | null): FleetGraphChangeSummary {
  if (!previous) {
    return {
      headline: 'No prior run',
      rows: [
        { label: 'Now', text: blockerLine(current.summary) },
        { label: 'Not done', text: 'No issue changed. No message sent.' },
      ],
    };
  }

  const rows: FleetGraphChangeSummary['rows'] = [];
  const previousBlocker = blockerLine(previous.summary);
  const currentBlocker = blockerLine(current.summary);
  if (previousBlocker !== currentBlocker) rows.push({ label: 'Now', text: currentBlocker });
  if (previous.severity !== current.severity && current.severity) {
    rows.push({ label: 'Changed', text: `Priority ${sentenceLabel(previous.severity)} -> ${sentenceLabel(current.severity)}.` });
  }

  const previousAction = actionLabel(previous);
  const currentAction = actionLabel(current);
  if (currentAction && currentAction !== previousAction) rows.push({ label: 'Next', text: currentAction });

  if (rows.length === 0) {
    return {
      headline: 'No meaningful change',
      rows: [{ label: 'Not done', text: 'No issue changed. No message sent.' }],
    };
  }

  rows.push({ label: 'Not done', text: 'No issue changed. No message sent.' });
  return {
    headline: rows[0]?.text ?? 'Changed',
    rows,
  };
}

function blockerLine(summary: string): string {
  const recordedBlocker = summary.match(/recorded blocker:\s*(.+)$/i)?.[1];
  return (recordedBlocker ?? summary).replace(/\.$/, '').trim();
}

function actionLabel(output: FleetGraphVisibleOutput): string | null {
  return stringFromJsonRecord(output.recommendedAction, ['label', 'text', 'summary']);
}

function sentenceLabel(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Unknown';
  const text = value.replace(/_/g, ' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function fleetGraphSeverity(value: unknown): FleetGraphVisibleOutput['severity'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'urgent' ? value : undefined;
}

function runInputFor(input: {
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

function resultFor(input: {
  decision: FleetGraphResult['decision'];
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

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deterministicRefinedDraft(finding: FleetGraphFinding, instruction: string): string {
  const normalizedInstruction = instruction.toLowerCase();
  const existingDraft = stringFromJsonRecord(finding.draft_content, ['message', 'text', 'draft', 'body']) ?? finding.summary;
  const evidenceClaims = Array.isArray(finding.evidence_snapshot)
    ? finding.evidence_snapshot
        .map((item) => stringFromJsonRecord(item, ['claim']))
        .filter((claim): claim is string => Boolean(claim))
        .slice(0, 3)
    : [];
  const blockerExcerpt = evidenceClaims[0] ?? finding.summary;
  const wantsMoreDetail = /\b(detail|detailed|context|explain|longer|specific|far more|a lot more)\b/.test(normalizedInstruction);
  const wantsFirmer = /\b(firm|firmer|direct|harsher|harder|urgent|pressure|forceful)\b/.test(normalizedInstruction);
  const wantsSofter = /\b(soft|softer|gentle|polite|warmer)\b/.test(normalizedInstruction);
  const wantsShorter = /\b(short|shorter|concise|brief|tight)\b/.test(normalizedInstruction);

  if (wantsShorter && !wantsMoreDetail) {
    return `${finding.title}: please confirm the unblock path today. ${finding.summary}`;
  }

  if (wantsMoreDetail) {
    const opener = wantsFirmer
      ? `This needs a clear unblock decision now: ${finding.title}.`
      : wantsSofter
        ? `Can you help clarify the unblock path for ${finding.title}?`
        : `Can you confirm the unblock path for ${finding.title}?`;
    const consequence = wantsFirmer
      ? 'Without a concrete owner, decision, or dependency update, this active-week work remains blocked and FleetGraph will continue treating it as PM-review work.'
      : 'FleetGraph is keeping this in PM review until the current unblock path is confirmed.';
    const evidenceText = evidenceClaims.length > 0
      ? evidenceClaims.map((claim) => `- ${claim}`).join('\n')
      : `- ${blockerExcerpt}`;

    return `${opener}\n\nCurrent signal:\n${evidenceText}\n\nRequested next step: confirm who owns the unblock, what decision or approval is needed, and whether this can move today. ${consequence}`;
  }

  if (wantsFirmer) {
    return `${finding.title} is still blocked and needs a direct unblock decision. ${finding.summary}\n\nPlease confirm the owner, dependency, and next step today so this does not stay stuck in active-week work.`;
  }

  if (wantsSofter) {
    return `Can you help confirm the current unblock path for ${finding.title}? ${finding.summary}\n\nA quick owner or dependency update would help FleetGraph keep the active-week plan accurate.`;
  }

  return `${existingDraft}\n\nRevision request applied: ${instruction}`;
}

function stringFromJsonRecord(value: unknown, keys: string[]): string | null {
  if (!isJsonRecord(value)) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

function candidateTitle(title: string): string {
  return title.trim() || 'Blocked active-week work';
}

function deterministicUpdateSummary(title: string): string {
  return `${title} still has an active blocker signal; FleetGraph refreshed the existing finding instead of creating a duplicate.`;
}
