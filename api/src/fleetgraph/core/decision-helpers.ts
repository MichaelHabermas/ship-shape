import type { FleetGraphSignalType, FleetGraphSeverity, IssuePriority } from '@ship/shared';
import { audienceForCandidate, nextActionForCandidate } from '../runtime/audience.js';
import { fleetGraphTraceMetadata } from '../trace.js';
import { noModelCostMetadata, noModelTokenMetadata } from '../usage-metadata.js';
import { resultFor, runInputFor } from '../runtime/run-recording.js';
import type { FleetGraphDecisionPacket, FleetGraphInput, FleetGraphResult } from '../types.js';
import type { JsonRecord } from '../persistence.js';
import type { FleetGraphCoreOptions, FleetGraphPersistencePort } from './types.js';

export function observabilityErrorMetadata(options: FleetGraphCoreOptions): JsonRecord {
  return options.observabilityError
    ? {
        observability: {
          traceCapture: 'failed',
          message: options.observabilityError.slice(0, 500),
        },
      }
    : {};
}

export async function runError(
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
    errorMetadata,
  });
}

export function decisionPacketFromCandidate(
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
    severity: severityFromIssuePriority(candidate.issue_priority),
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

export function candidateTitle(title: string): string {
  return title.trim() || 'Issue';
}

export function deterministicUpdateSummary(title: string): string {
  return `${title} still needs an unblock decision.`;
}

export function deterministicAttentionSummary(
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

export function severityFromIssuePriority(priority: IssuePriority): FleetGraphSeverity {
  return priority === 'none' ? 'low' : priority;
}

export function attentionReasonTraceNode(
  signalType: FleetGraphSignalType,
  detectorDecision: 'create_finding' | 'update_finding'
): string {
  if (signalType === 'blocked') {
    return detectorDecision === 'create_finding' ? 'reasonProactiveCreate' : 'refreshExistingFinding';
  }
  if (signalType === 'stale') return 'reasonStale';
  return 'reasonAtRisk';
}
