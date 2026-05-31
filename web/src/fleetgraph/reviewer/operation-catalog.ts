// FleetGraph reviewer operation catalog defines live drawer steps and failure parsing.
import type { OperationKind, OperationStatus, OperationStep } from './types';
import { proofGapLabel } from './chain-helpers';

export function operationTitle(kind: OperationKind): string {
  if (kind === 'scenario') return 'Running reviewer scenario';
  if (kind === 'worker') return 'Triggering worker tick';
  if (kind === 'repair') return 'Repairing proof';
  return 'Generating proof packet';
}

export function operationFailure(err: unknown, fallback: string): {
  message: string;
  detail?: string;
  outputTail?: string[];
} {
  const details = err instanceof Error && 'details' in err
    ? Reflect.get(err, 'details')
    : undefined;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    const error = typeof record.error === 'string' ? record.error : fallback;
    const detail = typeof record.detail === 'string' ? record.detail : undefined;
    const outputTail = Array.isArray(record.outputTail)
      ? record.outputTail.filter((line): line is string => typeof line === 'string')
      : undefined;
    return { message: error, detail, outputTail };
  }
  return { message: err instanceof Error ? err.message : fallback };
}

export function operationSteps(kind: OperationKind): OperationStep[] {
  if (kind === 'scenario') {
    return [
      { key: 'source', label: 'Source checked', detail: 'Find or create the reviewer issue and week association.' },
      { key: 'event', label: 'Event enqueued', detail: 'Queue the attention event that starts the causal path.' },
      { key: 'worker', label: 'Worker tick', detail: 'Let the worker claim events and run FleetGraph.' },
      { key: 'trace', label: 'Trace captured', detail: 'Persist reviewer-safe trace and usage metadata.' },
      { key: 'finding', label: 'Finding projected', detail: 'Refresh finding and notification projection evidence.' },
      { key: 'mutation', label: 'Source unchanged', detail: 'Run reviewer chat and record before/after source fields.' },
      { key: 'refresh', label: 'Chain refreshed', detail: 'Reload the selected chain and recompute proof gates.' },
    ];
  }
  if (kind === 'worker') {
    return [
      { key: 'request', label: 'Tick requested', detail: 'Call the gated reviewer worker endpoint.' },
      { key: 'claim', label: 'Events claimed', detail: 'Worker claims queued FleetGraph attention events.' },
      { key: 'graph', label: 'Graph run', detail: 'Eligible events flow through the shared graph.' },
      { key: 'finding', label: 'Findings updated', detail: 'Persist new or updated FleetGraph findings.' },
      { key: 'projection', label: 'Projection refreshed', detail: 'Notification projection is derived from visible findings.' },
      { key: 'refresh', label: 'Chains reloaded', detail: 'Reload proof chains from durable rows.' },
    ];
  }
  if (kind === 'repair') {
    return [
      { key: 'load', label: 'Chain inspected', detail: 'Read missing proof gates from durable verifier state.' },
      { key: 'plan', label: 'Safe repairs chosen', detail: 'Only non-destructive reviewer proof gaps are eligible.' },
      { key: 'chat', label: 'Chat proof run', detail: 'Run bounded on-demand FleetGraph chat against the finding.' },
      { key: 'mutation', label: 'Source unchanged', detail: 'Record before/after source fields for the reviewer chain.' },
      { key: 'reload', label: 'Chain reloaded', detail: 'Reload proof chains and recompute final gates.' },
    ];
  }
  return [
    { key: 'load', label: 'Latest chain loaded', detail: 'Read the live verifier output from durable evidence.' },
    { key: 'gates', label: 'Gates checked', detail: 'Verify freshness, traces, latency, mutation, and human gate.' },
    { key: 'render', label: 'Packet rendered', detail: 'Create the static proof snapshot from live evidence.' },
    { key: 'artifacts', label: 'Artifacts written', detail: 'Write JSON, Markdown, and HTML proof artifacts.' },
    { key: 'verdict', label: 'Verdict returned', detail: 'Report pass or proof incomplete honestly.' },
    { key: 'refresh', label: 'Dashboard refreshed', detail: 'Update this page with the latest live state.' },
  ];
}

export function operationStepState(
  status: OperationStatus,
  index: number,
  activeIndex: number,
): 'waiting' | 'running' | 'passed' | 'failed' | 'expected' {
  if (status === 'failed') return index === activeIndex ? 'failed' : 'waiting';
  if (status === 'passed') return 'passed';
  if (index < activeIndex) return 'expected';
  if (index === activeIndex) return 'running';
  return 'waiting';
}

export function operationStepClass(state: ReturnType<typeof operationStepState>): string {
  if (state === 'passed') return 'border-emerald-300/25 bg-emerald-400/[0.07] text-emerald-200';
  if (state === 'expected') return 'border-sky-300/20 bg-sky-400/[0.04] text-sky-200';
  if (state === 'running') return 'border-sky-300/35 bg-sky-400/[0.08] text-sky-200';
  if (state === 'failed') return 'border-rose-300/35 bg-rose-400/[0.08] text-rose-200';
  return 'border-white/10 bg-white/[0.03] text-slate-500';
}

export function operationStepLabel(state: ReturnType<typeof operationStepState>): string {
  if (state === 'passed') return 'done';
  if (state === 'expected') return 'expected';
  if (state === 'running') return 'running';
  if (state === 'failed') return 'failed';
  return 'waiting';
}

export { proofGapLabel };
