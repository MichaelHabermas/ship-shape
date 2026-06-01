// FleetGraph reviewer live operation drawer tracks progress from refreshed proof-chain steps.
import {
  activeChainStepIndex,
  chainStepsForOperation,
} from '@/fleetgraph/reviewer/operation-chain-steps';
import {
  operationStepClass,
  operationStepLabel,
  operationStepState,
} from '@/fleetgraph/reviewer/operation-catalog';
import { formatMs } from '@/fleetgraph/reviewer/formatters';
import type { LiveOperation } from '@/fleetgraph/reviewer/types';
import type { FleetGraphReviewerChain } from '@ship/shared';
import { CopyableUuid } from './primitives';

export function LiveOperationDrawer({
  operation,
  selected,
  onClose,
}: {
  operation: LiveOperation;
  selected: FleetGraphReviewerChain | null;
  onClose: () => void;
}) {
  const liveSteps = chainStepsForOperation(operation.kind, selected);
  const steps = operation.status === 'running'
    ? liveSteps
    : (operation.chainSteps?.length ? operation.chainSteps : liveSteps);
  const elapsedMs = (operation.completedAt ?? Date.now()) - operation.startedAt;
  const activeIndex = activeChainStepIndex(steps, operation.status);
  const showCompact = operation.status !== 'running' && !operation.outputTail?.length && steps.length === 0;

  if (showCompact) {
    return (
      <section className="fixed bottom-4 left-4 right-24 z-40 rounded-md border border-white/10 bg-[#07111f]/95 px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.34)] backdrop-blur md:left-auto md:w-[420px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${operation.status === 'passed' ? 'bg-emerald-300' : 'bg-rose-300'}`} />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">Live operation</p>
            </div>
            <h2 className="mt-1 truncate text-sm font-semibold text-white">{operation.title}</h2>
            <p className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-slate-400">{operation.result ?? operation.error}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/30 hover:text-white"
          >
            Hide
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="fixed bottom-4 left-4 right-24 z-40 max-h-[44vh] overflow-y-auto rounded-md border border-sky-300/15 bg-[#07111f]/95 px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.34)] backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${operation.status === 'running' ? 'animate-pulse bg-sky-300' : operation.status === 'passed' ? 'bg-emerald-300' : 'bg-rose-300'}`} />
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-200/70">Live operation</p>
          </div>
          <h2 className="mt-1 text-sm font-semibold text-white">{operation.title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {operation.status === 'running'
              ? 'Progress follows the selected proof chain after each refresh.'
              : operation.result ?? operation.error}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/30 hover:text-white"
        >
          Hide
        </button>
      </div>

      {operation.status === 'failed' && (
        <div className="mb-3 rounded-md border border-rose-300/25 bg-rose-950/25 p-3">
          <div className="text-sm font-semibold text-rose-100">{operation.error}</div>
          {operation.detail && (
            <div className="mt-1 text-xs leading-5 text-rose-100/80">{operation.detail}</div>
          )}
          {operation.outputTail && operation.outputTail.length > 0 && (
            <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded border border-white/10 bg-black/30 p-3 text-xs leading-5 text-slate-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {operation.outputTail.join('\n')}
            </pre>
          )}
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {steps.map((step, index) => {
          const state = operationStepState(operation.status, index, activeIndex);
          return (
            <div
              key={step.key}
              className={`relative min-h-[92px] rounded-md border px-3 py-2 ${operationStepClass(state)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-[11px] font-medium">{operationStepLabel(state)}</span>
              </div>
              <div className="mt-2 text-sm font-medium text-white">{step.label}</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">{step.evidence || step.key}</div>
              {state === 'running' && (
                <div className="absolute inset-x-3 bottom-2 h-px overflow-hidden bg-white/10">
                  <div className="h-full w-full animate-pulse bg-sky-300" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>Elapsed {formatMs(elapsedMs)}</span>
        {selected?.chainId && <span>Selected chain <CopyableUuid value={selected.chainId} /></span>}
        {operation.status === 'failed' && <span className="text-rose-200">Stopped at the active step. Read the error banner before retrying.</span>}
      </div>
    </section>
  );
}
