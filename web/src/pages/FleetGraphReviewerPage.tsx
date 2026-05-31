// FleetGraph reviewer control room renders live proof chains, gated controls, and reviewer chat evidence.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  FleetGraphReviewerProofResponse,
  FleetGraphReviewerRepairResponse,
  FleetGraphReviewerScenarioResponse,
} from '@ship/shared';
import { apiPostJson } from '@/lib/api';
import { chooseReviewerChain, repairResultText } from '@/fleetgraph/reviewer/chain-helpers';
import { useReviewerControlRoom } from '@/hooks/useReviewerControlRoom';
import { ChainWorkspace } from '@/components/fleetgraph-reviewer/ChainWorkspace';
import { DetailPane } from '@/components/fleetgraph-reviewer/DetailPane';
import { LiveOperationDrawer } from '@/components/fleetgraph-reviewer/LiveOperationDrawer';
import { ReviewerChatPanel } from '@/components/fleetgraph-reviewer/ReviewerChatPanel';
import { HistoricalAudit, ProofExplanation, StatusStrip } from '@/components/fleetgraph-reviewer/ReviewerSummaryBands';
import { ScenarioRail } from '@/components/fleetgraph-reviewer/ScenarioRail';
import { EmptyState, ProofButton } from '@/components/fleetgraph-reviewer/primitives';

export function FleetGraphReviewerPage() {
  const [, setSearchParams] = useSearchParams();
  const [proof, setProof] = useState<FleetGraphReviewerProofResponse | null>(null);
  const {
    chains,
    selected,
    loading,
    error,
    setError,
    setSelectedId,
    refresh,
    data,
    blastRadius,
    blastRadiusError,
    busyAction,
    operation,
    setOperation,
    runAction,
  } = useReviewerControlRoom();

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#080b12] text-slate-100">
      <div className="shrink-0 border-b border-white/10 bg-[#0b0f18] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">FleetGraph live proof</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Reviewer Control Room</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <ProofButton
              label="Run scenario"
              help="Creates a fresh canonical current-week blocked-issue scenario, then triggers the worker unless disabled."
              busy={busyAction === 'scenario'}
              disabled={Boolean(busyAction)}
              onClick={() => runAction('scenario', () => apiPostJson<FleetGraphReviewerScenarioResponse>(
                '/api/fleetgraph/reviewer/scenarios/week-blocker',
                { triggerWorker: true, freshRun: true },
                'Failed to run reviewer scenario',
              ), (result) => {
                setSelectedId(result.chainId);
                setSearchParams({ findingId: result.chainId });
              }, (result) => `Scenario created. Chain ${result.chainId} is selected.`)}
            />
            <ProofButton
              label="Worker tick"
              help="Runs one FleetGraph worker pass so queued attention events can become graph runs and findings."
              busy={busyAction === 'worker'}
              disabled={Boolean(busyAction)}
              onClick={() => runAction('worker', () => apiPostJson<{ triggered: true }>(
                '/api/fleetgraph/reviewer/worker-tick',
                {},
                'Failed to trigger worker',
              ), undefined, () => 'Worker tick requested. Latest chains have been refreshed.')}
            />
            <ProofButton
              label="Repair proof"
              help="Runs only safe missing proof steps for the selected chain, starting with source-mutation proof. Packet generation stays read-only."
              busy={busyAction === 'repair'}
              disabled={Boolean(busyAction) || !selected}
              onClick={() => selected && runAction('repair', () => apiPostJson<FleetGraphReviewerRepairResponse>(
                '/api/fleetgraph/reviewer/repair',
                { chainId: selected.chainId },
                'Failed to repair reviewer proof',
              ), (result) => {
                setSelectedId(result.chainId);
                if (result.chainId) setSearchParams({ findingId: result.chainId });
              }, repairResultText)}
            />
            <ProofButton
              label="Generate packet"
              help="Builds the static proof packet from the latest live verifier output. It should fail if the selected proof chain is proof-incomplete."
              busy={busyAction === 'proof'}
              disabled={Boolean(busyAction) || !selected}
              onClick={() => runAction('proof', () => apiPostJson<FleetGraphReviewerProofResponse>(
                '/api/fleetgraph/reviewer/proof',
                selected ? { chainId: selected.chainId } : undefined,
                'Failed to generate proof packet',
              ), setProof, (result) => `Packet ${result.verdict}. Static artifacts were generated from live verifier evidence.`)}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-rose-400/30 bg-rose-950/40 px-6 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <StatusStrip data={data} loading={loading} proof={proof} selected={selected} />
      <ProofExplanation data={data} proof={proof} selected={selected} />
      <HistoricalAudit data={data} loading={loading} />

      {operation && (
        <LiveOperationDrawer
          operation={operation}
          selected={selected}
          onClose={() => setOperation(null)}
        />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border-t border-white/10 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="min-h-0 overflow-y-auto border-b border-white/10 bg-[#0a0e16] p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:border-b-0 lg:border-r">
          <ScenarioRail
            chains={chains}
            loading={loading}
            selectedChainId={selected?.chainId}
            onChooseChain={(chain) => chooseReviewerChain(chain, setSelectedId, setSearchParams)}
          />
        </aside>

        <main className="min-h-0 min-w-0 overflow-y-auto bg-[#080b12] p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {selected ? <ChainWorkspace chain={selected} /> : <EmptyState loading={loading} />}
        </main>

        <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#0a0e16] p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:border-l lg:border-t-0">
          {selected ? (
            <DetailPane chain={selected} blastRadius={blastRadius} blastRadiusError={blastRadiusError} />
          ) : (
            <EmptyState loading={loading} compact />
          )}
          {selected?.links.findingId && <ReviewerChatPanel key={selected.links.findingId} findingId={selected.links.findingId} />}
        </aside>
      </div>
    </div>
  );
}
