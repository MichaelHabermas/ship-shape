import {
  evidenceFromDetectorCandidate,
  filterEvidenceForActor,
  recommendedActionForVisibleOutput,
} from '../evidence.js';
import { generateProactiveCreateText } from '../model.js';
import { fleetGraphTraceMetadata, traceMetadataJson } from '../trace.js';
import { noModelCostMetadata, noModelTokenMetadata } from '../usage-metadata.js';
import { resultFor, runInputFor } from '../runtime/run-recording.js';
import { visibleOutputFromPacket } from '../runtime/outputs.js';
import type { SaveBlockedImportantIssueFindingInput } from '../persistence.js';
import type { FleetGraphInput, FleetGraphResult } from '../types.js';
import {
  attentionReasonTraceNode,
  decisionPacketFromCandidate,
  deterministicAttentionSummary,
  observabilityErrorMetadata,
} from './decision-helpers.js';
import type { FleetGraphDetectorQuietExit } from '../detection/detector.js';
import type { FleetGraphCoreOptions, FleetGraphPersistencePort } from './types.js';

export async function runDetectorDecision(
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
        tokenMetadata: noModelTokenMetadata(),
        costMetadata: noModelCostMetadata(),
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

export async function runQuietExit(
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
    visibleOutput: {
      title: 'FleetGraph quiet exit',
      summary: output.summary,
      evidence: [],
      humanGate: { required: false },
    },
    evidence: [],
    traceMetadata,
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
    errorMetadata: observabilityErrorMetadata(options),
  });
}
