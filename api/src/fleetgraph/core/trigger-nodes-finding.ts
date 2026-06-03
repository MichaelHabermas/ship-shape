import type { FleetGraphEvidenceItem } from '@ship/shared';
import {
  visibleOutputForFinding,
} from '../evidence.js';
import { isJsonRecord } from '../runtime/json.js';
import { changeSummaryFromOutputs, visibleOutputFromRun } from '../runtime/outputs.js';
import { deterministicRefinedDraft } from '../runtime/drafts.js';
import { fleetGraphTraceMetadata, traceMetadataJson } from '../trace.js';
import { noModelCostMetadata, noModelTokenMetadata } from '../usage-metadata.js';
import { resultFor, runInputFor } from '../runtime/run-recording.js';
import type { FleetGraphFinding } from '../persistence.js';
import type { FleetGraphInput, FleetGraphResult, FleetGraphVisibleOutput } from '../types.js';
import { observabilityErrorMetadata, runError } from './decision-helpers.js';
import type { FleetGraphCoreOptions, FleetGraphPersistencePort } from './types.js';

export async function runExplainFinding(
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
    errorMetadata: observabilityErrorMetadata(options),
  });
}

export async function runSummarizeChanges(
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
    errorMetadata: observabilityErrorMetadata(options),
  });
}

export async function runRefineDraft(
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
    errorMetadata: observabilityErrorMetadata(options),
  });
}

export async function runRestrictedFindingQuietExit(
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
    errorMetadata: observabilityErrorMetadata(options),
  });
}

export async function runResolveFinding(
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

export async function runSuppressFinding(
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

export async function runDismissFinding(
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
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
    tokenMetadata: noModelTokenMetadata(),
    costMetadata: noModelCostMetadata(),
  });
}
