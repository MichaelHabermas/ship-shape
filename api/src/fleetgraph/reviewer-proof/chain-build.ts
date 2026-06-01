// Builds reviewer chain presentations from durable ledger rows.
import type {
  FleetGraphReviewerChain,
  FleetGraphReviewerChainsResponse,
  FleetGraphReviewerStep,
  FleetGraphReviewerStepStatus,
  FleetGraphReviewerTraceScore,
  FleetGraphUsage,
} from '@ship/shared';
import {
  enrichReviewerChainPresentation,
  FLEETGRAPH_REVIEWER_REQUIRED_STEP_KEYS,
  preferredReviewerProofChain,
} from '@ship/shared';
import type { Principal } from '../../security/principal.js';
import {
  fleetGraphNotificationResponse,
  serializeFleetGraphVisibleOutput,
} from '../api-contract.js';
import { visibleOutputForFinding } from '../evidence.js';
import type {
  FleetGraphFinding,
  FleetGraphNotificationFinding,
  JsonRecord,
} from '../persistence.js';
import { traceMetadataForResponse } from '../trace.js';
import {
  CAUSAL_TIMESTAMP_SKEW_MS,
  LATENCY_GOAL_MS,
  LEGACY_REVIEWER_ISSUE_TITLE,
  LIVE_WORKER_FRESH_MS,
  REQUIRED_STEP_KEYS,
  REVIEWER_ISSUE_TITLE,
  TRACE_FRESH_MS,
} from './constants.js';
import type { ChainRow, QueryRunner } from './types.js';

export function normalizeCausalDiffMs(value: number): number {
  if (value < 0 && Math.abs(value) <= CAUSAL_TIMESTAMP_SKEW_MS) return 0;
  return value;
}

export function publicReviewerChainProof(chain: FleetGraphReviewerChain) {
  return {
    chainId: chain.chainId,
    scenario: chain.scenario,
    status: chain.status,
    missing: chain.missing,
    generatedAt: chain.generatedAt,
    freshness: chain.freshness,
    latencyMs: chain.latencyMs,
    steps: chain.steps.map((stepItem) => ({
      key: stepItem.key,
      label: stepItem.label,
      status: stepItem.status,
      at: stepItem.at,
      durationMs: stepItem.durationMs,
      evidence: stepItem.status === 'pass' ? 'Reviewer-safe evidence present.' : stepItem.evidence,
    })),
    humanGate: chain.humanGate,
    traceQuality: {
      ...chain.traceQuality,
      scores: chain.traceQuality.scores.map((item) => ({
        name: item.name,
        passed: item.passed,
        value: typeof item.value === 'boolean' || typeof item.value === 'number' ? item.value : null,
        comment: item.comment,
      })),
    },
    sourceMutationCheck: {
      passed: chain.sourceMutationCheck.passed,
      before: {},
      after: {},
      changedFields: chain.sourceMutationCheck.changedFields,
    },
    usageSummary: chain.usageSummary,
  };
}

export function placeholderScenarioChain(input: {
  sourceIssueId: string;
  sourceSprintId: string;
  attentionEventId?: string;
}): FleetGraphReviewerChain {
  const generatedAt = new Date().toISOString();
  return enrichReviewerChainPresentation({
    chainId: input.attentionEventId ?? input.sourceIssueId,
    scenario: 'week-blocker',
    status: 'in_progress',
    missing: ['graph_run', 'finding', 'notification_projection'],
    missingLabels: [],
    productPath: 'partial',
    generatedAt,
    freshness: {
      generatedAt,
      newestRunAt: null,
      newestWorkerTickAt: null,
      proofAgeMs: null,
      workerAgeMs: null,
    },
    latencyMs: {},
    links: {
      sourceIssueId: input.sourceIssueId,
      sourceSprintId: input.sourceSprintId,
      ...(input.attentionEventId ? { attentionEventId: input.attentionEventId } : {}),
    },
    steps: [
      step('source', 'Ship source', 'pass', null, 'Reviewer issue exists.'),
      step('attention_event', 'Attention event', input.attentionEventId ? 'pass' : 'pending', null, 'Scenario event queued.'),
      step('graph_run', 'Graph run', 'pending', null, 'Waiting for worker output.'),
    ],
    humanGate: { required: false, state: 'missing', allowedActions: [] },
    traceQuality: {
      passed: false,
      requiredDecisions: [],
      observedDecisions: [],
      scores: [score('traceUrl', false, null, 'Waiting for trace URL.')],
    },
    sourceMutationCheck: {
      passed: false,
      before: {},
      after: {},
      changedFields: ['not_measured'],
    },
    usageSummary: { modelCalls: 0, costCurrency: 'USD' },
  });
}

export function reviewerSummary(chains: FleetGraphReviewerChain[]): FleetGraphReviewerChainsResponse['summary'] {
  const preferredChain = preferredReviewerProofChain(chains);
  const requiredGates: FleetGraphReviewerTraceScore[] = [
    score('canonicalChainComplete', preferredChain?.status === 'complete', preferredChain?.chainId ?? null, 'The selected canonical reviewer chain must complete.'),
    score('freshWorker', (preferredChain?.freshness.workerAgeMs ?? Infinity) <= LIVE_WORKER_FRESH_MS, true, 'Canonical worker tick must be recent for live pass.'),
    score('freshTrace', (preferredChain?.freshness.proofAgeMs ?? Infinity) <= TRACE_FRESH_MS, true, 'Canonical trace/run evidence must be fresh.'),
    score('latencyUnderFiveMinutes', (preferredChain?.latencyMs.total ?? Infinity) <= LATENCY_GOAL_MS, true, 'Canonical live scenario must surface under five minutes.'),
  ];
  const costSummary = chains.reduce<FleetGraphUsage>((total, chain) => ({
    modelCalls: total.modelCalls + chain.usageSummary.modelCalls,
    inputTokens: (total.inputTokens ?? 0) + (chain.usageSummary.inputTokens ?? 0),
    cachedInputTokens: (total.cachedInputTokens ?? 0) + (chain.usageSummary.cachedInputTokens ?? 0),
    billableInputTokens: (total.billableInputTokens ?? 0) + (chain.usageSummary.billableInputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (chain.usageSummary.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (chain.usageSummary.totalTokens ?? 0),
    estimatedCostUsd: (total.estimatedCostUsd ?? 0) + (chain.usageSummary.estimatedCostUsd ?? 0),
    costCurrency: 'USD',
    usageSource: 'none',
    costSource: 'none',
  }), { modelCalls: 0, costCurrency: 'USD' });

  return {
    generatedAt: new Date().toISOString(),
    status: requiredGates.every((gate) => gate.passed) ? 'complete' : 'broken',
    preferredChainId: preferredChain?.chainId ?? null,
    chainCount: chains.length,
    completeCount: chains.filter((chain) => chain.status === 'complete').length,
    brokenCount: chains.filter((chain) => chain.status === 'broken' || chain.status === 'failed').length,
    requiredGates,
    costSummary,
  };
}

export async function chainFromRow(input: {
  row: ChainRow;
  principal: Principal;
  notificationFindings: FleetGraphNotificationFinding[];
  db: QueryRunner;
}): Promise<FleetGraphReviewerChain> {
  const { row } = input;
  const finding = row.finding_id ? await queryFinding(input.db, row.finding_id) : null;
  const visible = finding ? await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: finding.workspace_id,
    finding,
    db: input.db,
  }) : null;
  const visibleOutput = visible && !visible.output.noSafeOutput ? visible.output : undefined;
  const traceMetadata = traceMetadataForResponse(row.run_trace_metadata, {
    mode: row.run_mode,
    decision: row.decision,
  });
  const notificationFinding = input.notificationFindings.find((candidate) => candidate.id === row.finding_id);
  const notificationProjection = notificationFinding && visibleOutput
    ? fleetGraphNotificationResponse({ finding: notificationFinding, visibleOutput })
    : undefined;
  const steps = stepsForRow(row, Boolean(visibleOutput), Boolean(notificationProjection), traceMetadata);
  const traceQuality = traceQualityForRow(row, traceMetadata);
  const latencyMs = latencyForRow(row);
  const sourceMutationCheck = sourceMutationCheckForRow(row);
  const blocking = blockingProblemsForChain(steps, traceQuality, latencyMs, sourceMutationCheck);
  const pending = pendingForChain(steps);
  const missing = [...new Set([...blocking, ...pending])];
  const status = statusForChain(blocking, pending, row);

  return enrichReviewerChainPresentation({
    chainId: row.run_id,
    scenario: isReviewerIssueTitle(row.issue_title) ? 'week-blocker' : 'existing',
    status,
    missing,
    missingLabels: [],
    productPath: 'partial',
    generatedAt: new Date().toISOString(),
    freshness: freshnessForRow(row),
    latencyMs,
    links: {
      ...(row.source_issue_id ? { sourceIssueId: row.source_issue_id } : {}),
      ...(row.source_sprint_id ? { sourceSprintId: row.source_sprint_id } : {}),
      ...(row.attention_event_id ? { attentionEventId: row.attention_event_id } : {}),
      ...(row.worker_tick_id ? { workerTickId: row.worker_tick_id } : {}),
      runId: row.run_id,
      ...(traceMetadata.traceId ? { traceId: traceMetadata.traceId } : {}),
      ...(traceMetadata.traceUrl ? { traceUrl: traceMetadata.traceUrl } : {}),
      ...(row.finding_id ? { findingId: row.finding_id } : {}),
      ...(notificationProjection ? { notificationProjectionId: notificationProjection.id } : {}),
      ...(row.run_mode === 'on_demand' ? { chatRunId: row.run_id } : {}),
    },
    steps,
    visibleOutput: visibleOutput ? serializeFleetGraphVisibleOutput(visibleOutput) : undefined,
    notificationProjection,
    humanGate: humanGateForVisibleOutput(visibleOutput),
    traceQuality,
    sourceMutationCheck,
    usageSummary: usageForRow(row),
  });
}

async function queryFinding(db: QueryRunner, findingId: string): Promise<FleetGraphFinding | null> {
  const result = await db.query<FleetGraphFinding>(
    `SELECT * FROM fleetgraph_findings WHERE id = $1 LIMIT 1`,
    [findingId]
  );
  return result.rows[0] ? { ...result.rows[0], confidence: Number(result.rows[0].confidence) } : null;
}

function stepsForRow(
  row: ChainRow,
  hasVisibleOutput: boolean,
  hasNotificationProjection: boolean,
  traceMetadata: ReturnType<typeof traceMetadataForResponse>
): FleetGraphReviewerStep[] {
  return [
    step('source', 'Ship source', row.source_issue_id ? 'pass' : 'broken', row.issue_updated_at, `Issue: ${row.issue_title ?? 'missing source'}`),
    step('attention_event', 'Attention event', row.attention_event_id && row.attention_event_status === 'completed' ? 'pass' : 'pending', row.attention_event_created_at, row.attention_event_status ?? 'No completed event row found'),
    step('worker_tick', 'Worker tick', row.worker_tick_id && row.worker_tick_status === 'completed' ? 'pass' : 'pending', row.worker_tick_started_at, row.worker_tick_status ?? 'No completed worker tick matched this run'),
    step('graph_run', 'Graph run', 'pass', row.run_created_at, `${row.decision} via ${row.trigger_reason}`),
    step('trace', 'Trace', traceMetadata.traceUrl ? 'pass' : 'broken', row.run_created_at, traceMetadata.traceUrl ? 'Safe trace URL captured' : 'Trace URL missing or unsafe'),
    step('finding', 'Finding', row.finding_id ? 'pass' : 'pending', row.finding_first_detected_at, row.finding_status ?? 'No finding persisted for this run'),
    step('notification_projection', 'Notification projection', hasNotificationProjection ? 'pass' : 'pending', row.finding_first_detected_at, hasNotificationProjection ? 'Derived from visible finding' : 'No visible notification projection'),
    step('chat_human_gate', 'Chat and human gate', hasVisibleOutput ? 'pass' : 'pending', row.run_completed_at, hasVisibleOutput ? 'Visible output contains human gate metadata' : 'No visible output for this actor'),
  ];
}

function step(
  key: string,
  label: string,
  status: FleetGraphReviewerStepStatus,
  at: Date | null,
  evidence: string
): FleetGraphReviewerStep {
  return {
    key,
    label,
    status,
    at: at?.toISOString() ?? null,
    evidence,
  };
}

function traceQualityForRow(
  row: ChainRow,
  traceMetadata: ReturnType<typeof traceMetadataForResponse>
): FleetGraphReviewerChain['traceQuality'] {
  const scores: FleetGraphReviewerTraceScore[] = [
    score('traceId', Boolean(traceMetadata.traceId), traceMetadata.traceId ?? null, 'Trace ID must be present.'),
    score('traceUrl', Boolean(traceMetadata.traceUrl), traceMetadata.traceUrl ?? null, 'Trace URL must be reviewer-safe.'),
    score('nodePath', traceMetadata.nodePath.length > 0, traceMetadata.nodePath.join(' -> '), 'Graph node path must not be empty.'),
    score('decision', Boolean(row.decision), row.decision, 'Run decision must be explicit.'),
    score('usageMetadata', row.token_metadata !== null && row.cost_metadata !== null, true, 'Usage and cost metadata must be persisted.'),
    score('createTraceNotQuiet', row.decision !== 'quiet_exit' || row.trigger_reason !== 'reviewer-week-blocker-scenario', row.decision, 'Scenario create proof cannot be satisfied by quiet exit.'),
  ];
  return {
    passed: scores.every((item) => item.passed),
    requiredDecisions: [row.decision],
    observedDecisions: [row.decision],
    scores,
  };
}

function score(
  name: string,
  passed: boolean,
  value: string | number | boolean | null,
  comment: string
): FleetGraphReviewerTraceScore {
  return { name, passed, value, comment };
}

function latencyForRow(row: ChainRow): FleetGraphReviewerChain['latencyMs'] {
  const ship = row.issue_updated_at;
  const attention = row.attention_event_created_at;
  const worker = row.worker_tick_started_at;
  const run = row.run_created_at;
  const finding = row.finding_first_detected_at;
  const notification = row.finding_first_detected_at;
  return {
    ...(ship && attention ? { shipToAttention: diffMs(ship, attention) } : {}),
    ...(attention && worker ? { attentionToWorker: diffMs(attention, worker) } : {}),
    ...(worker && run ? { workerToRun: diffMs(worker, run) } : {}),
    ...(run && finding ? { runToFinding: diffMs(run, finding) } : {}),
    ...(finding && notification ? { findingToNotification: diffMs(finding, notification) } : {}),
    ...(ship && notification ? { total: diffMs(ship, notification) } : {}),
  };
}

function diffMs(start: Date, end: Date): number {
  return normalizeCausalDiffMs(end.getTime() - start.getTime());
}

function blockingProblemsForChain(
  steps: FleetGraphReviewerStep[],
  traceQuality: FleetGraphReviewerChain['traceQuality'],
  latencyMs: FleetGraphReviewerChain['latencyMs'],
  sourceMutationCheck: FleetGraphReviewerChain['sourceMutationCheck']
): string[] {
  const missing = steps
    .filter((stepItem) => stepItem.status === 'broken' || stepItem.status === 'failed')
    .map((stepItem) => stepItem.key);
  if (!traceQuality.passed) missing.push('trace_quality');
  if (latencyMs.total === undefined || latencyMs.total > LATENCY_GOAL_MS) missing.push('latency_under_5_minutes');
  if (Object.values(latencyMs).some((value) => typeof value === 'number' && value < 0)) missing.push('causal_ordering');
  if (!sourceMutationCheck.passed) missing.push('source_mutation_check');
  return [...new Set(missing)];
}

function pendingForChain(steps: FleetGraphReviewerStep[]): string[] {
  return steps
    .filter((stepItem) => REQUIRED_STEP_KEYS.has(stepItem.key as typeof FLEETGRAPH_REVIEWER_REQUIRED_STEP_KEYS[number]) && stepItem.status === 'pending')
    .map((stepItem) => stepItem.key);
}

function statusForChain(
  blocking: string[],
  pending: string[],
  row: ChainRow
): FleetGraphReviewerChain['status'] {
  if (row.decision === 'error') return 'failed';
  if (blocking.length > 0) return 'broken';
  if (pending.length > 0) return 'in_progress';
  if (!row.finding_id && row.run_mode === 'proactive') return 'in_progress';
  return 'complete';
}

function freshnessForRow(row: ChainRow): FleetGraphReviewerChain['freshness'] {
  const now = Date.now();
  const newestRunAt = row.run_created_at;
  const newestWorkerTickAt = row.worker_tick_started_at;
  return {
    generatedAt: new Date().toISOString(),
    newestRunAt: newestRunAt?.toISOString() ?? null,
    newestWorkerTickAt: newestWorkerTickAt?.toISOString() ?? null,
    proofAgeMs: newestRunAt ? now - newestRunAt.getTime() : null,
    workerAgeMs: newestWorkerTickAt ? now - newestWorkerTickAt.getTime() : null,
  };
}

function humanGateForVisibleOutput(
  output: Awaited<ReturnType<typeof visibleOutputForFinding>>['output'] | undefined
): FleetGraphReviewerChain['humanGate'] {
  if (!output) {
    return { required: false, state: 'missing', allowedActions: [] };
  }
  const approvalRequired = output.humanGate?.approvalRequired === true || output.humanGate?.required === true;
  return {
    required: approvalRequired,
    state: Object.keys(output.humanGate ?? {}).length > 0 ? 'present' : 'missing',
    allowedActions: approvalRequired
      ? ['approve after review', 'edit source manually', 'dismiss', 'snooze']
      : ['inspect evidence'],
  };
}

function sourceMutationCheckForRow(row: ChainRow): FleetGraphReviewerChain['sourceMutationCheck'] {
  if (row.mutation_before_state && row.mutation_after_state && row.mutation_changed_fields) {
    return {
      passed: row.mutation_changed_fields.length === 0,
      before: sourceMutationState(row.mutation_before_state),
      after: sourceMutationState(row.mutation_after_state),
      changedFields: row.mutation_changed_fields,
    };
  }
  return {
    passed: false,
    before: {},
    after: {},
    changedFields: ['not_measured'],
  };
}

function sourceMutationState(value: JsonRecord | null): Record<string, string | number | boolean | null> {
  const state: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value ?? {})) {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      state[key] = item;
    }
  }
  return state;
}

function usageForRow(row: ChainRow): FleetGraphUsage {
  const token = row.token_metadata ?? {};
  const cost = row.cost_metadata ?? {};
  return {
    modelCalls: numberValue(token.modelCalls),
    inputTokens: optionalNumber(token.inputTokens),
    cachedInputTokens: optionalNumber(token.cachedInputTokens),
    billableInputTokens: optionalNumber(token.billableInputTokens),
    outputTokens: optionalNumber(token.outputTokens),
    totalTokens: optionalNumber(token.totalTokens),
    estimatedCostUsd: optionalNumber(cost.estimatedCostUsd),
    costCurrency: 'USD',
    usageSource: typeof token.usageSource === 'string' ? token.usageSource as FleetGraphUsage['usageSource'] : 'none',
    costSource: typeof cost.costSource === 'string' ? cost.costSource as FleetGraphUsage['costSource'] : 'none',
  };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isReviewerIssueTitle(title: string | null): boolean {
  return Boolean(title?.startsWith(REVIEWER_ISSUE_TITLE) || title?.startsWith(LEGACY_REVIEWER_ISSUE_TITLE));
}
