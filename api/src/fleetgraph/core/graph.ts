// FleetGraph core runs the shared proactive/on-demand LangGraph decision runtime.
import { END, START, StateGraph } from '@langchain/langgraph';
import {
  fleetGraphTracingEnabled,
  withFleetGraphTrace,
  type FleetGraphTraceEnablement,
} from '../observability-trace.js';
import { fleetGraphStableHash } from '../trace-hash.js';
import type { FleetGraphInput, FleetGraphResult } from '../types.js';
import { runError } from './decision-helpers.js';
import { runDetectorDecision, runQuietExit } from './trigger-nodes-detector.js';
import {
  runContextChat,
} from './trigger-nodes-chat.js';
import {
  runDismissFinding,
  runExplainFinding,
  runRefineDraft,
  runResolveFinding,
  runSummarizeChanges,
  runSuppressFinding,
} from './trigger-nodes-finding.js';
import {
  defaultPersistence,
  FleetGraphState,
  type FleetGraphCoreOptions,
  type FleetGraphNodeName,
  type FleetGraphRuntimeContext,
  type FleetGraphStateValue,
} from './types.js';

export async function runFleetGraph(
  input: FleetGraphInput,
  options: FleetGraphCoreOptions = {}
): Promise<FleetGraphResult> {
  if (shouldAutoCaptureTrace(input, options)) {
    try {
      const capture = await withFleetGraphTrace({
        name: `FleetGraph ${input.mode} ${input.trigger.type}`,
        inputs: traceSafeRunInputs(input),
        enablement: traceEnablementForOptions(options),
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
    workspaceHash: fleetGraphStableHash(input.workspaceId),
    mode: input.mode,
    triggerType: input.trigger.type,
    triggerReason: input.triggerReason ?? input.trigger.type,
  };
}

export function shouldAutoCaptureTrace(input: FleetGraphInput, options: FleetGraphCoreOptions): boolean {
  const enablement = traceEnablementForOptions(options);
  if (options.externalTrace || process.env.NODE_ENV === 'test') return false;
  if (!fleetGraphTracingEnabled(enablement)) return false;
  if (options.forceReviewerTrace) return true;
  return !isLowSignalAutoTrace(input, options);
}

function traceEnablementForOptions(options: FleetGraphCoreOptions): FleetGraphTraceEnablement {
  return { reviewer: options.forceReviewerTrace === true };
}

function isLowSignalAutoTrace(input: FleetGraphInput, options: FleetGraphCoreOptions): boolean {
  if (options.persistence && !options.db) return true;
  return input.mode === 'proactive'
    && input.trigger.type === 'quiet_exit'
    && (input.triggerReason ?? input.trigger.type) === 'scheduled-worker';
}

function fleetGraphRuntime(context: FleetGraphRuntimeContext) {
  return new StateGraph(FleetGraphState)
    .addNode('normalizeTrigger', (state: FleetGraphStateValue) => tracedFleetGraphNode('normalizeTrigger', context, () =>
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
  logFleetGraphNodeTouch(name, context);

  if (!context.options.traceRecorder) return run();

  return context.options.traceRecorder.traceNode(name, {
    mode: context.input.mode,
    triggerType: context.input.trigger.type,
    triggerReason: context.triggerReason,
  }, run);
}

function logFleetGraphNodeTouch(name: string, context: FleetGraphRuntimeContext): void {
  if (process.env.FLEETGRAPH_CONSOLE_TRACE !== '1') return;

  console.log('[FleetGraph]', {
    node: name,
    mode: context.input.mode,
    triggerType: context.input.trigger.type,
    triggerReason: context.triggerReason,
  });
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
  throw new Error(`Unhandled FleetGraph trigger type: ${String(state.triggerType)}`);
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
