// FleetGraph core orchestrates shared proactive and on-demand graph decisions.
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
};

function defaultPersistence(db: QueryRunner = pool): FleetGraphPersistencePort {
  return {
    saveFinding: (input) => saveBlockedImportantIssueFinding(input, db),
    recordRun: (input) => recordFleetGraphRun(input, db),
    getFinding: (workspaceId, findingId) => getFindingForGraph({ workspaceId, findingId, db }),
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
    switch (input.trigger.type) {
      case 'detector_decision':
        return runDetectorDecision(input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'detector_decision' }> }, persistence, triggerReason, options);
      case 'quiet_exit':
        return runQuietExit(input, persistence, triggerReason, input.trigger.quietExits);
      case 'explain_finding':
        return runExplainFinding(input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'explain_finding' }> }, persistence, triggerReason, options);
      case 'refine_draft':
        return runRefineDraft(input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'refine_draft' }> }, persistence, triggerReason, options);
      case 'resolve_finding':
        return runResolveFinding(input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'resolve_finding' }> }, persistence, triggerReason);
      case 'dismiss_finding':
        return runDismissFinding(input as FleetGraphInput & { trigger: Extract<FleetGraphInput['trigger'], { type: 'dismiss_finding' }> }, persistence, triggerReason, options);
      case 'error':
        return runError(input, persistence, triggerReason, input.trigger.message);
    }
  } catch (_error) {
    return runError(input, persistence, triggerReason, 'FleetGraph internal error');
  }
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
    }]);
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
  quietExits: FleetGraphDetectorQuietExit[]
): Promise<FleetGraphResult> {
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'quiet_exit',
    nodePath: ['normalizeTrigger', 'detector', 'quietExit', 'persistFleetGraphState'],
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
    return runRestrictedFindingQuietExit(input, persistence, triggerReason, finding, evidence, output);
  }

  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'refine_draft',
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'refineDraft', 'persistFleetGraphState', 'produceOutput'],
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
  output: FleetGraphVisibleOutput
): Promise<FleetGraphResult> {
  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision: 'quiet_exit',
    nodePath: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'quietExit', 'persistFleetGraphState'],
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
  triggerReason: string
): Promise<FleetGraphResult> {
  return runStatusOnly(input, persistence, triggerReason, 'resolve', () =>
    persistence.resolveFinding({ workspaceId: input.workspaceId, findingId: input.trigger.findingId })
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
    return runRestrictedFindingQuietExit(input, persistence, triggerReason, finding, evidence, output);
  }

  return runStatusOnly(input, persistence, triggerReason, 'dismiss', () =>
    persistence.dismissFinding({
      workspaceId: input.workspaceId,
      findingId: input.trigger.findingId,
      dismissedBy: input.trigger.dismissedBy,
    })
  );
}

async function runStatusOnly(
  input: FleetGraphInput,
  persistence: FleetGraphPersistencePort,
  triggerReason: string,
  decision: 'dismiss' | 'resolve',
  mutate: () => Promise<FleetGraphFinding | null>
): Promise<FleetGraphResult> {
  const finding = await mutate();
  if (!finding) return runError(input, persistence, triggerReason, 'FleetGraph finding not found');

  const traceMetadata = fleetGraphTraceMetadata({
    mode: input.mode,
    decision,
    nodePath: ['normalizeTrigger', 'resolveScope', 'persistFleetGraphState', 'produceOutput'],
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
