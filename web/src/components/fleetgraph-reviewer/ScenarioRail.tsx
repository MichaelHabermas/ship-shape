// FleetGraph reviewer scenario rail lists recent proof chains and canonical scenario context.
import type { FleetGraphReviewerChain } from '@ship/shared';
import { chainTooltip, scenarioLabel } from '@/fleetgraph/reviewer/chain-helpers';
import { CopyableUuid, RailCard, StatusPill, Tooltip } from './primitives';

export function ScenarioRail({
  chains,
  loading,
  selectedChainId,
  onChooseChain,
}: {
  chains: FleetGraphReviewerChain[];
  loading: boolean;
  selectedChainId?: string;
  onChooseChain: (chain: FleetGraphReviewerChain) => void;
}) {
  return (
    <>
      <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Scenario rail</div>
      <div className="space-y-3">
        <RailCard label="Canonical scenario" value="Current-week blocked issue" help="The preferred final-submission story: a week-native issue becomes blocked and FleetGraph proves the causal path." />
        <RailCard label="Required gates" value="Freshness, trace, latency, mutation" help="All of these must pass before a chain can become final reviewer proof." />
        <RailCard label="Mutations" value="Admin + env gated" help="Actions that create proof data require workspace admin access and FLEETGRAPH_REVIEWER_PROOF_ENABLED=1 on the API." />
        <RailCard label="Notification" value="Derived projection, not a source row" help="Notifications here are computed from findings plus visibility/read state; they are not a separate source-of-truth table." />
      </div>
      <div className="mt-6">
        <Tooltip text="The latest durable FleetGraph runs. Historical runs may be useful evidence but often show as broken because reviewer proof requires stricter gates than normal product operation.">
          <div className="mb-2 inline-flex text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Recent history</div>
        </Tooltip>
        <div className="space-y-2">
          {chains.map((chain, index) => (
            <Tooltip
              key={`${chain.chainId}:${chain.generatedAt}:${chain.links.workerTickId ?? chain.links.runId ?? index}`}
              text={chainTooltip(chain)}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => onChooseChain(chain)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onChooseChain(chain);
                  }
                }}
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  selectedChainId === chain.chainId
                    ? 'border-sky-300/50 bg-sky-400/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-white">{scenarioLabel(chain)}</span>
                  <StatusPill status={chain.status} />
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  <CopyableUuid value={chain.links.findingId ?? chain.links.runId} />
                </div>
              </div>
            </Tooltip>
          ))}
          {!loading && chains.length === 0 && (
            <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
              No live proof chains yet.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
