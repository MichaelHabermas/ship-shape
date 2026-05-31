// FleetGraph reviewer operation catalog: titles, step styling, and operation failure parsing.
import type { OperationKind, OperationStatus } from './types';

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
