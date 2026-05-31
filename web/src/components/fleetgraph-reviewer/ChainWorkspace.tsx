// FleetGraph reviewer chain workspace renders the causal proof path for the selected chain.
import type { FleetGraphReviewerChain } from '@ship/shared';
import { formatCompactDate, formatDateText, formatMs } from '@/fleetgraph/reviewer/formatters';
import { chainMissingLabels, scenarioLabel } from '@/fleetgraph/reviewer/chain-helpers';
import { Panel, StatusPill, Tooltip } from './primitives';

export function ChainWorkspace({ chain }: { chain: FleetGraphReviewerChain }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill status={chain.status} />
            <span className="text-xs text-slate-500">{formatCompactDate(chain.generatedAt)}</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-white">{formatDateText(chain.visibleOutput?.title ?? scenarioLabel(chain))}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{formatDateText(chain.visibleOutput?.summary ?? 'Waiting for visible FleetGraph output.')}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-right">
          <Tooltip text="Elapsed time from the source issue update to the reviewer-visible notification projection. The live proof target is under five minutes.">
            <div className="text-xs text-slate-500">Total latency</div>
          </Tooltip>
          <div className="text-lg font-semibold text-white">{formatMs(chain.latencyMs.total)}</div>
        </div>
      </div>

      {chain.missing.length > 0 && (
        <Tooltip text="These are the proof gates preventing this chain from being complete. Missing does not always mean the product failed; it means final-review evidence is incomplete.">
          <div className="rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            Missing: {chainMissingLabels(chain).join(', ')}
          </div>
        </Tooltip>
      )}

      <section className="rounded-md border border-white/10 bg-[#0b0f18]">
        <Tooltip text="The durable evidence sequence FleetGraph must prove: source, event, worker, graph run, trace, finding, notification projection, and chat/human gate.">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">Causal chain</div>
        </Tooltip>
        <div className="divide-y divide-white/10">
          {chain.steps.map((step, index) => (
            <div key={step.key} className="grid gap-3 px-4 py-3 md:grid-cols-[40px_180px_minmax(0,1fr)_120px]">
              <div className="text-xs text-slate-600">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <div className="text-sm font-medium text-white">{step.label}</div>
                <div className="text-xs text-slate-500">{step.status}</div>
              </div>
              <div className="text-sm text-slate-300">{formatDateText(step.evidence)}</div>
              <div className="text-xs text-slate-500">{step.at ? formatCompactDate(step.at) : 'pending'}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Trace quality" help="Checks whether the run has reviewer-safe tracing metadata: trace ID, safe URL, graph node path, decision, and usage/cost metadata.">
          <div className="space-y-2">
            {chain.traceQuality.scores.map((score) => (
              <div key={score.name} className="flex items-start justify-between gap-3 rounded-md bg-white/[0.03] px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-white">{score.name}</div>
                  <div className="text-xs text-slate-500">{score.comment}</div>
                </div>
                <span className={score.passed ? 'text-emerald-300' : 'text-amber-300'}>
                  {score.passed ? 'pass' : 'broken'}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Evidence table" help="Only actor-visible evidence should appear here. Hidden/private evidence must not leak into reviewer output.">
          <div className="space-y-2">
            {(chain.visibleOutput?.evidence ?? []).map((item, index) => (
              <div key={`${item.kind}-${index}`} className="rounded-md bg-white/[0.03] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{item.kind}</span>
                  <span className="text-xs text-slate-500">{item.visibility}</span>
                </div>
                <div className="mt-1 text-sm text-slate-400">{formatDateText(item.excerpt ?? item.claim)}</div>
              </div>
            ))}
            {!chain.visibleOutput?.evidence?.length && <div className="text-sm text-slate-500">No safe evidence output yet.</div>}
          </div>
        </Panel>
      </section>
    </div>
  );
}
