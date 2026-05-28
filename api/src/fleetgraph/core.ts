// FleetGraph core runs the shared proactive/on-demand LangGraph decision runtime.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { pool } from '../db/client.js';
import type { FleetGraphDetectorQuietExit } from './detection/detector.js';
import {
  evidenceFromDetectorCandidate,
  filterEvidenceForActor,
  getFindingForGraph,
  recommendedActionForVisibleOutput,
  visibleOutputForFinding,
} from './evidence.js';
import { generateProactiveCreateText } from './model.js';
import { audienceForCandidate, nextActionForCandidate } from './runtime/audience.js';
import {
  chatAnswerFromChangeSummary,
  chatAnswerForIntent,
  classifyFleetGraphChatPrompt,
  unsupportedChatAnswer,
} from './runtime/chat.js';
import { deterministicRefinedDraft } from './runtime/drafts.js';
import { isJsonRecord } from './runtime/json.js';
import { changeSummaryFromOutputs, visibleOutputFromPacket, visibleOutputFromRun } from './runtime/outputs.js';
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
  type FleetGraphRun,
  type JsonRecord,
  type RecordFleetGraphRunInput,
  type SaveBlockedImportantIssueFindingInput,
} from './persistence.js';
import {
  fleetGraphLangSmithEnabled,
  withFleetGraphLangSmithTrace,
  type FleetGraphLangSmithNodeRecorder,
} from './langsmith-trace.js';
import { fleetGraphTraceMetadata, traceMetadataJson } from './trace.js';
import { resultFor, runInputFor } from './runtime/run-recording.js';
import type { FleetGraphEvidenceItem, FleetGraphSignalType } from '@ship/shared';
import type {
  FleetGraphDecisionPacket,
  FleetGraphInput,
  FleetGraphResult,
  FleetGraphTraceMetadata,
  FleetGraphVisibleOutput,
} from './types.js';

type QueryRunner = Pick<typeof pool, 'query'>;

export type FleetGraphPersistencePort = {
  saveFinding(input: SaveBlockedImportantIssueFindingInput): Promise<FleetGraphFinding>;
  recordRun(input: RecordFleetGraphRunInput): Promise<FleetGraphRun>;
  getFinding(workspaceId: string, findingId: string): Promise<FleetGraphFinding | null>;
  listFindingsForSource(input: { workspaceId: string; sourceIssueId?: string; sourceSprintId?: string }): Promise<FleetGraphFinding[]>;
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
  traceRecorder?: FleetGraphLangSmithNodeRecorder;
  observabilityError?: string;
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
  | 'contextChat'
  | 'resolveFinding'
  | 'suppressFinding'
  | 'dismissFinding'
  | 'errorRun';

function defaultPersistence(db: QueryRunner = pool): FleetGraphPersistencePort {
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

export async function runFleetGraph(
  input: FleetGraphInput,
  options: FleetGraphCoreOptions = {}
): Promise<FleetGraphResult> {
  if (shouldAutoCaptureTrace(options)) {
    try {
      const capture = await withFleetGraphLangSmithTrace({
        name: `FleetGraph ${input.mode} ${input.trigger.type}`,
        inputs: traceSafeRunInputs(input),
      }, (externalTrace, traceRecorder) => runFleetGraph(input, { ...options, externalTrace, traceRecorder }));
      return capture.result;
    } catch (error) {
      // FleetGraph must still surface findings if external trace capture is temporarily unavailable.
      return runFleetGraph(input, {
        ...options,
        observabilityError: error instanceof Error ? error.message : String(error),
      });
    }
  }

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

function traceSafeRunInputs(input: FleetGraphInput): Record<string, unknown> {
  return {
    workspaceId: input.workspaceId,
    mode: input.mode,
    triggerType: input.trigger.type,
    triggerReason: input.triggerReason ?? input.trigger.type,
  };
}

function shouldAutoCaptureTrace(options: FleetGraphCoreOptions): boolean {
  return !options.externalTrace
    && process.env.NODE_ENV !== 'test'
    && fleetGraphLangSmithEnabled();
}

function observabilityErrorMetadata(options: FleetGraphCoreOptions): JsonRecord {
  return options.observabilityError
    ? {
        observability: {
          langsmithCapture: 'failed',
          message: options.observabilityError.slice(0, 500),
        },
      }
    : {};
}

function fleetGraphRuntime(context: FleetGraphRuntimeContext) {
  return new StateGraph(FleetGraphState)
    .addNode('normalizeTrigger', (state) => tracedFleetGraphNode('normalizeTrigger', context, () =>
      Promise.resolve(normalizeTriggerNode(state, context))
    ))
    .addNode('detectorDecision', () => tracedFleetGraphNode('detectorDecision', context, () => detectorDecisionNode(context)))
    .addNode('quietExit', () => tracedFleetGraphNode('quietExit', context, () => quietExitNode(context)))
    .addNode('explainFinding', () => tracedFleetGraphNode('explainFinding', context, () => explainFindingNode(context)))
    .addNode('refineDraft', () => tracedFleetGraphNode('refineDraft', context, () => refineDraftNode(context)))
    .addNode('summarizeChanges', () => tracedFleetGraphNode('summarizeChanges', context, () => summarizeChangesNode(context)))
    .addNode('contextChat', () => tracedFleetGraphNode('contextChat', context, () => contextChatNode(context)))
    .addNode('resolveFinding', () => tracedFleetGraphNode('resolveFinding', context, () => resolveFindingNode(context)))
    .addNode('suppressFinding', () => tracedFleetGraphNode('suppressFinding', context, () => suppressFindingNode(context)))
    .addNode('dismissFinding', () => tracedFleetGraphNode('dismissFinding', context, () => dismissFindingNode(context)))
    .addNode('errorRun', () => tracedFleetGraphNode('errorRun', context, () => errorRunNode(context)))
    .addEdge(START, 'normalizeTrigger')
    .addConditionalEdges('normalizeTrigger', routeFleetGraphTrigger)
    .addEdge('detectorDecision', END)
    .addEdge('quietExit', END)
    .addEdge('explainFinding', END)
    .addEdge('refineDraft', END)
    .addEdge('summarizeChanges', END)
    .addEdge('contextChat', END)
    .addEdge('resolveFinding', END)
    .addEdge('suppressFinding', END)
    .addEdge('dismissFinding', END)
    .addEdge('errorRun', END)
    .compile({ name: 'fleetgraph.shared_runtime' });
}

async function tracedFleetGraphNode(
  name: string,
  context: FleetGraphRuntimeContext,
  run: () => Promise<Partial<FleetGraphStateValue>>
): Promise<Partial<FleetGraphStateValue>> {
  if (!context.options.traceRecorder) return run();

  return context.options.traceRecorder.traceNode(name, {
    mode: context.input.mode,
    triggerType: context.input.trigger.type,
    triggerReason: context.triggerReason,
  }, run);
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
    case 'context_chat':
      return 'contextChat';
    case 'resolve_finding':
      return 'resolveFinding';
    case 'suppress_finding':
      return 'suppressFinding';
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

async function contextChatNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  context.result = await runContextChat(
    context.input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'context_chat' }> },
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

async function suppressFindingNode(context: FleetGraphRuntimeContext): Promise<Partial<FleetGraphStateValue>> {
  context.result = await runSuppressFinding(
    context.input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'suppress_finding' }> },
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
  const signalType = candidate.signalType ?? 'blocked';
  const signalLabel = candidate.signalLabel ?? 'Blocked';
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
  const modelResult = detectorDecision.decision === 'create_finding' && signalType === 'blocked'
    ? await model({ candidate })
    : {
        summary: deterministicAttentionSummary(candidate),
        draftMessage: `Review ${candidate.issue_title}: ${candidate.attentionReason ?? 'Issue needs attention.'}`,
        tokenMetadata: { modelCalls: 0 },
        costMetadata: {},
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
      attentionReasonTraceNode(signalType, detectorDecision.decision),
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
    runMetadata: {
      detectorDecision: detectorDecision.decision,
      signalType,
      signalLabel,
      reason: candidate.attentionReason,
      uncertaintyNotes: packet.uncertaintyNotes,
    },
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
    costMetadata: modelResult.costMetadata,
    errorMetadata: observabilityErrorMetadata(options),
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
    costMetadata: modelResult.costMetadata,
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
  });
}

async function runContextChat(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'context_chat' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  const finding = await resolveContextChatFinding(input, persistence);
  if (!finding) {
    return runContextChatQuietExit(
      input,
      persistence,
      triggerReason,
      'Open a FleetGraph notification or a blocked issue with an active finding before asking.',
      options
    );
  }

  const { evidence, output } = await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: input.workspaceId,
    finding,
    db: options.db,
  });
  if (output.noSafeOutput) {
    return runRestrictedFindingQuietExit(input, persistence, triggerReason, finding, evidence, output, options);
  }

  const intent = classifyFleetGraphChatPrompt(input.trigger.prompt);
  if (intent === 'summarize_changes') {
    return runContextChatChangeSummary(input, persistence, triggerReason, finding, evidence, output, options);
  }
  if (intent === 'unsupported') {
    return runContextChatQuietExit(
      input,
      persistence,
      triggerReason,
      'I can answer from the attached issue, notification, or week context. Workspace-wide questions need a narrower source first.',
      options
    );
  }

  const decision = intent === 'next_step' || intent === 'unblocker' ? 'needs_confirmation' : 'explain';
  const answer = chatAnswerForIntent(intent, output);
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision,
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'contextChat', 'produceOutput'],
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
    output: { answer, visibleOutput: output },
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
  });
}

async function resolveContextChatFinding(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'context_chat' }> },
  persistence: FleetGraphPersistencePort
): Promise<FleetGraphFinding | null> {
  const { context } = input.trigger;
  if (context.findingId) return persistence.getFinding(input.workspaceId, context.findingId);

  if (!context.documentId) return null;
  if (context.kind === 'sprint') {
    const findings = await persistence.listFindingsForSource({ workspaceId: input.workspaceId, sourceSprintId: context.documentId });
    return findings[0] ?? null;
  }
  if (context.kind === 'issue' || context.kind === 'document') {
    const findings = await persistence.listFindingsForSource({ workspaceId: input.workspaceId, sourceIssueId: context.documentId });
    return findings[0] ?? null;
  }

  return null;
}

async function runContextChatChangeSummary(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'context_chat' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  finding: FleetGraphFinding,
  evidence: FleetGraphEvidenceItem[],
  output: FleetGraphVisibleOutput,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  const anchors = await persistence.listAnchorRuns({ workspaceId: input.workspaceId, findingId: finding.id, limit: 2 });
  const previousOutput = visibleOutputFromRun(anchors[1]);
  const changeSummary = changeSummaryFromOutputs(output, previousOutput);
  const answer = chatAnswerFromChangeSummary(changeSummary);
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'summarize_changes',
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'contextChatChanges', 'produceOutput'],
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
    output: { answer, changeSummary },
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
  });
}

async function runContextChatQuietExit(
  input: FleetGraphInput,
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  reason: string,
  options: FleetGraphCoreOptions = {}
): Promise<FleetGraphResult> {
  const answer = unsupportedChatAnswer(reason);
  const visibleOutput: FleetGraphVisibleOutput = {
    title: answer.title,
    summary: answer.body,
    evidence: [],
    humanGate: answer.humanGate,
  };
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'quiet_exit',
    nodePath: ['normalizeTrigger', 'resolveScope', 'contextChatUnsupported', 'persistFleetGraphState'],
    ...options.externalTrace,
  });
  const runInput = runInputFor({
    input,
    triggerReason,
    decision: 'quiet_exit',
    output: { answer },
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
    errorMetadata: observabilityErrorMetadata(options),
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision: 'quiet_exit',
    finding: null,
    run,
    runInput,
    visibleOutput,
    evidence: [],
    traceMetadata,
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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
    errorMetadata: observabilityErrorMetadata(options),
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

async function runSuppressFinding(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'suppress_finding' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  return runStatusOnly(
    input,
    persistence,
    triggerReason,
    'suppress',
    () => persistence.suppressFinding({ workspaceId: input.workspaceId, findingId: input.trigger.findingId }),
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
  decision: 'dismiss' | 'resolve' | 'suppress',
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
    errorMetadata: observabilityErrorMetadata(options),
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
  const issueTitle = candidateTitle(candidate.issue_title);
  const signalType = candidate.signalType ?? 'blocked';
  const signalLabel = candidate.signalLabel ?? 'Blocked';
  const audience = audienceForCandidate(candidate);
  const nextAction = nextActionForCandidate(candidate, audience);
  return {
    severity: candidate.issue_priority,
    confidence: 0.86,
    title: `${signalLabel}: ${issueTitle}`,
    summary,
    recommendedAction: {
      type: 'confirm_unblock_path',
      label: nextAction,
      text: nextAction,
      requiresHumanApproval: true,
    },
    draftContent: {
      kind: 'unblock_message',
      message: draftMessage,
      source: 'fleetgraph',
      signalType,
    },
    proposedRecipient: {
      role: audience.role,
      userId: audience.userId,
      displayName: audience.displayName,
      rationale: audience.rationale,
    },
    humanGate: {
      required: true,
      reason: 'FleetGraph cannot contact anyone or mutate Ship without human approval.',
    },
    uncertaintyNotes: [],
  };
}

function candidateTitle(title: string): string {
  return title.trim() || 'Issue';
}

function deterministicUpdateSummary(title: string): string {
  return `${title} still needs an unblock decision.`;
}

function deterministicAttentionSummary(
  candidate: Extract<FleetGraphInput['trigger'], { type: 'detector_decision' }>['detectorDecision']['candidate']
): string {
  const signalType = candidate.signalType ?? 'blocked';
  const reason = candidate.attentionReason ?? 'Issue needs attention.';
  if (signalType === 'stale') {
    return `${candidate.issue_title} looks stale. ${reason}`;
  }
  if (signalType === 'at_risk') {
    return `${candidate.issue_title} is at risk. ${reason}`;
  }
  return deterministicUpdateSummary(candidateTitle(candidate.issue_title));
}

function attentionReasonTraceNode(
  signalType: FleetGraphSignalType,
  detectorDecision: 'create_finding' | 'update_finding'
): string {
  if (signalType === 'blocked') {
    return detectorDecision === 'create_finding' ? 'reasonProactiveCreate' : 'refreshExistingFinding';
  }
  if (signalType === 'stale') return 'reasonStale';
  return 'reasonAtRisk';
}
