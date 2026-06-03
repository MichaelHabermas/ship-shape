import { generateContextChatText } from '../model.js';
import {
  chatModelAnswerFromContext,
  contextTextForModel,
  resolveContextChatBundle,
} from '../runtime/context-chat.js';
import { chatModelUnavailableAnswer, contextChatActionRequiresApproval } from '../runtime/chat-fallback.js';
import { unsupportedChatAnswer } from '../runtime/chat.js';
import { fleetGraphTraceMetadata } from '../trace.js';
import { noModelCostMetadata, noModelTokenMetadata } from '../usage-metadata.js';
import { resultFor, runInputFor } from '../runtime/run-recording.js';
import type { FleetGraphInput, FleetGraphResult, FleetGraphVisibleOutput } from '../types.js';
import { observabilityErrorMetadata } from './decision-helpers.js';
import type { FleetGraphCoreOptions, FleetGraphPersistencePort } from './types.js';

export async function runContextChat(
  input: FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'context_chat' }> },
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  options: FleetGraphCoreOptions
): Promise<FleetGraphResult> {
  const bundle = await resolveContextChatBundle(input, persistence, options);
  if (bundle.documents.length === 0 && bundle.signals.length === 0 && bundle.pages.length === 0) {
    return runContextChatQuietExit(
      input,
      persistence,
      triggerReason,
      'Open an issue, week, project, program, document, or notification before asking.',
      options
    );
  }

  const primarySignal = bundle.signals[0];
  const modelResult = await generateContextChatText({
    prompt: input.trigger.prompt,
    context: contextTextForModel(bundle),
    history: input.trigger.history ?? [],
  });
  let answer = modelResult
    ? chatModelAnswerFromContext(modelResult.answer, bundle)
    : chatModelUnavailableAnswer(input.trigger.prompt, bundle);
  if (modelResult && contextChatActionRequiresApproval(input.trigger.prompt)) {
    const gate = primarySignal?.output.humanGate;
    answer = {
      ...answer,
      humanGate: gate?.required === true || gate?.approvalRequired === true
        ? { ...gate, required: true }
        : { required: true, reason: 'human_must_approve_before_ship_or_external_action' },
    };
  }
  const decision = answer.humanGate.required === true ? 'needs_confirmation' : 'explain';
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision,
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentContext', 'contextChat', 'produceOutput'],
    ...options.externalTrace,
  });
  const runInput = runInputFor({
    input,
    triggerReason,
    decision,
    findingId: primarySignal?.finding.id,
    sourceIssueId: primarySignal?.finding.source_issue_id ?? (bundle.documents[0]?.document_type === 'issue' ? bundle.documents[0].id : undefined),
    sourceSprintId: primarySignal?.finding.source_sprint_id,
    dedupeKey: primarySignal?.finding.dedupe_key,
    evidence: bundle.evidence,
    output: { answer, contextDocuments: bundle.documents.map((document) => ({ id: document.id, title: document.title, type: document.document_type })) },
    traceMetadata,
    tokenMetadata: modelResult?.tokenMetadata ?? noModelTokenMetadata(),
    costMetadata: modelResult?.costMetadata ?? noModelCostMetadata(),
    errorMetadata: observabilityErrorMetadata(options),
  });
  const run = await persistence.recordRun(runInput);

  return resultFor({
    decision,
    finding: primarySignal?.finding ?? null,
    run,
    runInput,
    visibleOutput: bundle.visibleOutput,
    evidence: bundle.evidence,
    traceMetadata,
    tokenMetadata: modelResult?.tokenMetadata ?? noModelTokenMetadata(),
    costMetadata: modelResult?.costMetadata ?? noModelCostMetadata(),
    errorMetadata: observabilityErrorMetadata(options),
  });
}

export async function runContextChatQuietExit(
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
    errorMetadata: observabilityErrorMetadata(options),
  });
}
