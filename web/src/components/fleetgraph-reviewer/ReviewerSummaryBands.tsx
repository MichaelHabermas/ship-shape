// FleetGraph reviewer summary bands show product path, proof status, and historical audit context.
import type { FleetGraphReviewerChain, FleetGraphReviewerChainsResponse, FleetGraphReviewerProofResponse } from '@ship/shared';
import { chainMissingLabels } from '@/fleetgraph/reviewer/chain-helpers';
import { CopyableUuid, Metric, MetricMini } from './primitives';

export function StatusStrip({
  data,
  loading,
  proof,
  selected,
}: {
  data: FleetGraphReviewerChainsResponse | null;
  loading: boolean;
  proof: FleetGraphReviewerProofResponse | null;
  selected: FleetGraphReviewerChain | null;
}) {
  const summary = data?.summary;
  return (
    <section className="grid grid-cols-2 gap-px bg-white/10 md:grid-cols-4">
      <Metric
        label="Product path"
        value={selected ? (selected.productPath === 'working' ? 'working' : 'partial') : loading ? 'Loading' : 'No data'}
        tone={selected ? (selected.productPath === 'working' ? 'complete' : 'in_progress') : undefined}
      />
      <Metric label="Submission proof" value={loading && !summary ? 'Loading' : summary?.status ?? 'No data'} tone={summary?.status} />
      <Metric label="Canonical chain" value={selected ? `${selected.scenario} / ${selected.status}` : loading ? 'Loading' : 'No data'} tone={selected?.status} />
      <Metric label="Last packet" value={proof ? proof.verdict : 'Not generated'} tone={proof?.verdict} />
    </section>
  );
}

export function HistoricalAudit({
  data,
  loading,
}: {
  data: FleetGraphReviewerChainsResponse | null;
  loading: boolean;
}) {
  const summary = data?.summary;
  return (
    <section className="shrink-0 border-b border-white/10 bg-[#080d16] px-6 py-3 text-sm text-slate-300">
      <div className="grid gap-3 lg:grid-cols-[180px_180px_minmax(0,1fr)]">
        <MetricMini label="Historical audit" value={loading && !summary ? 'Loading' : `${summary?.completeCount ?? 0}/${summary?.chainCount ?? 0} complete`} />
        <MetricMini label="Historical gaps" value={loading && !summary ? 'Loading' : String(summary?.brokenCount ?? 0)} />
        <div className="min-w-0 text-slate-400">
          Background sample only. These are recent FleetGraph runs scored against today’s reviewer gates; they do not control submission readiness.
        </div>
      </div>
    </section>
  );
}

export function ProofExplanation({
  data,
  proof,
  selected,
}: {
  data: FleetGraphReviewerChainsResponse | null;
  proof: FleetGraphReviewerProofResponse | null;
  selected: FleetGraphReviewerChain | null;
}) {
  if (!data) return null;
  const failedGates = data.summary.requiredGates.filter((gate) => !gate.passed);
  const selectedGapLabels = selected ? chainMissingLabels(selected) : [];
  const details = [
    proof ? <span>Last packet used chain <CopyableUuid value={proof.chainId} /> and returned {proof.verdict}.</span> : 'No packet has been generated in this session.',
    selected ? `Selected chain is ${selected.scenario} / ${selected.status}.` : 'No chain is selected.',
    selected ? <span>Generate packet will use the selected {selected.scenario} / {selected.status} chain <CopyableUuid value={selected.chainId} />.</span> : 'No packet target is available.',
    failedGates.length > 0
      ? `Submission gates still failing: ${failedGates.map((gate) => gate.name).join(', ')}.`
      : 'Submission gates pass for the canonical proof set.',
    selectedGapLabels.length > 0
      ? `Selected-chain gaps: ${selectedGapLabels.join(', ')}.`
      : 'Selected chain has no missing gates.',
  ];

  return (
    <section className="shrink-0 border-b border-white/10 bg-[#09111d] px-6 py-3 text-sm text-slate-300">
      <div className="flex flex-wrap items-start gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Why this status</div>
        <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-2 xl:grid-cols-3">
          {details.map((detail, index) => (
            <div key={index} className="min-w-0 leading-5">{detail}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
