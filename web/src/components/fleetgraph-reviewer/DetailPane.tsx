// FleetGraph reviewer detail pane shows chain metadata, blast radius, and proof freshness.
import type { FleetGraphBlastRadiusResponse, FleetGraphReviewerChain } from '@ship/shared';
import { sourceMutationLabel } from '@/fleetgraph/reviewer/chain-helpers';
import { formatMs } from '@/fleetgraph/reviewer/formatters';
import { BlastRadiusPanel } from './BlastRadiusPanel';
import { KeyValue, Panel } from './primitives';

export function DetailPane({
  chain,
  blastRadius,
  blastRadiusError,
}: {
  chain: FleetGraphReviewerChain;
  blastRadius: FleetGraphBlastRadiusResponse | null;
  blastRadiusError: string | null;
}) {
  return (
    <div className="space-y-4">
      <Panel title="Chain detail" help="Raw IDs and trace links for the selected proof chain. These are for reviewers/admins, not public static proof.">
        <KeyValue label="Chain" value={chain.chainId} copyUuid />
        <KeyValue label="Run" value={chain.links.runId} copyUuid />
        <KeyValue label="Finding" value={chain.links.findingId} copyUuid />
        <KeyValue label="Trace" value={chain.links.traceUrl} link />
      </Panel>
      <BlastRadiusPanel blastRadius={blastRadius} error={blastRadiusError} chain={chain} />
      <Panel title="Freshness" help="How old the graph run and worker tick are. Live proof should be fresh, not a stale snapshot.">
        <KeyValue label="Run age" value={formatMs(chain.freshness.proofAgeMs)} />
        <KeyValue label="Worker age" value={formatMs(chain.freshness.workerAgeMs)} />
      </Panel>
      <Panel title="Source mutation" help="Uses persisted before/after source fields around reviewer chat to prove the chat did not mutate the issue.">
        <div className={chain.sourceMutationCheck.passed ? 'text-sm text-emerald-200' : 'text-sm text-amber-200'}>
          {sourceMutationLabel(chain)}
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Changed fields: {chain.sourceMutationCheck.changedFields.join(', ') || 'none'}
        </div>
      </Panel>
      <Panel title="Human gate" help="Shows whether FleetGraph requires a human before any consequential action such as editing source data or contacting someone.">
        <div className="text-sm text-slate-300">{chain.humanGate.state}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {chain.humanGate.allowedActions.map((action) => (
            <span key={action} className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-slate-400">
              {action}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
