// FleetGraph reviewer control room renders live proof chains, gated controls, and reviewer chat evidence.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  FleetGraphChatResponse,
  FleetGraphReviewerChain,
  FleetGraphReviewerChainsResponse,
  FleetGraphReviewerProofResponse,
  FleetGraphReviewerRepairResponse,
  FleetGraphReviewerScenarioResponse,
} from '@ship/shared';
import { apiGetJson, apiPostJson } from '@/lib/api';
import { useFleetGraphChatTurns } from '@/hooks/useFleetGraphChatTurns';

const statusTone: Record<FleetGraphReviewerChain['status'], string> = {
  complete: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  in_progress: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  broken: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  failed: 'border-rose-400/40 bg-rose-400/10 text-rose-200',
};

const statusHelp: Record<FleetGraphReviewerChain['status'], string> = {
  complete: 'Every required reviewer-proof gate passed for this chain.',
  in_progress: 'The chain has started, but one or more required proof rows has not appeared yet.',
  broken: 'Proof incomplete: one or more submission-proof gates is missing or inconsistent. This does not necessarily mean the product path failed.',
  failed: 'The graph run errored and this chain cannot be used as proof.',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g;
const compactDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

type OperationKind = 'scenario' | 'worker' | 'repair' | 'proof';
type OperationStatus = 'running' | 'passed' | 'failed';
type OperationStep = {
  key: string;
  label: string;
  detail: string;
};
type LiveOperation = {
  kind: OperationKind;
  title: string;
  status: OperationStatus;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  detail?: string;
  outputTail?: string[];
};

export function FleetGraphReviewerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const findingId = searchParams.get('findingId');
  const [data, setData] = useState<FleetGraphReviewerChainsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(findingId);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<FleetGraphReviewerProofResponse | null>(null);
  const [operation, setOperation] = useState<LiveOperation | null>(null);
  const refreshIdRef = useRef(0);

  async function refresh(options: { showLoading?: boolean } = {}) {
    const requestId = refreshIdRef.current + 1;
    refreshIdRef.current = requestId;
    if (options.showLoading !== false) setLoading(true);
    if (options.showLoading !== false) setError(null);
    try {
      const response = await apiGetJson<FleetGraphReviewerChainsResponse>(
        '/api/fleetgraph/reviewer/chains?limit=25',
        'Failed to load FleetGraph reviewer chains'
      );
      if (requestId !== refreshIdRef.current) return;
      setData(response);
      setSelectedId((current) => {
        if (current && response.chains.some((chain) => chain.chainId === current || chain.links.findingId === current)) {
          return current;
        }
        return preferredReviewerProofChain(response.chains)?.chainId ?? null;
      });
    } catch (err) {
      if (requestId !== refreshIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load reviewer chains');
    } finally {
      if (requestId === refreshIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async (showLoading = false) => {
      await refresh({ showLoading });
      if (!cancelled) timer = window.setTimeout(() => void poll(false), 10_000);
    };
    void poll(true);
    return () => {
      cancelled = true;
      refreshIdRef.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const chains = data?.chains ?? [];
  const selected = useMemo(() => {
    return chains.find((chain) => chain.chainId === selectedId || chain.links.findingId === selectedId)
      ?? preferredReviewerProofChain(chains)
      ?? null;
  }, [chains, selectedId]);

  useEffect(() => {
    if (findingId && selected?.chainId && findingId !== selected.chainId) {
      setSelectedId(findingId);
    }
  }, [findingId, selected?.chainId]);

  async function runAction<T>(
    kind: OperationKind,
    action: () => Promise<T>,
    onDone?: (value: T) => void,
    resultText?: (value: T) => string
  ) {
    if (busyAction) return;
    setBusyAction(kind);
    setError(null);
    setOperation({
      kind,
      title: operationTitle(kind),
      status: 'running',
      startedAt: Date.now(),
    });
    try {
      const result = await action();
      onDone?.(result);
      await refresh();
      setOperation((current) => current?.kind === kind ? {
        ...current,
        status: 'passed',
        completedAt: Date.now(),
        result: resultText?.(result) ?? 'Completed and refreshed live proof.',
      } : current);
    } catch (err) {
      const failure = operationFailure(err, `${operationTitle(kind)} failed`);
      setError(failure.message);
      setOperation((current) => current?.kind === kind ? {
        ...current,
        status: 'failed',
        completedAt: Date.now(),
        error: failure.message,
        detail: failure.detail,
        outputTail: failure.outputTail,
      } : current);
    } finally {
      setBusyAction(null);
    }
  }

  function chooseChain(chain: FleetGraphReviewerChain) {
    setSelectedId(chain.chainId);
    setSearchParams(chain.links.findingId ? { findingId: chain.links.findingId } : {});
  }

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
                'Failed to run reviewer scenario'
              ), (result) => setSelectedId(result.chainId), (result) => `Scenario created. Chain ${result.chainId} is selected.`)}
            />
            <ProofButton
              label="Worker tick"
              help="Runs one FleetGraph worker pass so queued attention events can become graph runs and findings."
              busy={busyAction === 'worker'}
              disabled={Boolean(busyAction)}
              onClick={() => runAction('worker', () => apiPostJson<{ triggered: true }>(
                '/api/fleetgraph/reviewer/worker-tick',
                undefined,
                'Failed to trigger worker'
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
                'Failed to repair reviewer proof'
              ), (result) => setSelectedId(result.chainId), (result) => repairResultText(result))}
            />
            <ProofButton
              label="Generate packet"
              help="Builds the static proof packet from the latest live verifier output. It should fail if the selected proof chain is proof-incomplete."
              busy={busyAction === 'proof'}
              disabled={Boolean(busyAction) || !selected}
              onClick={() => runAction('proof', () => apiPostJson<FleetGraphReviewerProofResponse>(
                '/api/fleetgraph/reviewer/proof',
                selected ? { chainId: selected.chainId } : undefined,
                'Failed to generate proof packet'
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
                    onClick={() => chooseChain(chain)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        chooseChain(chain);
                      }
                    }}
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      selected?.chainId === chain.chainId
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
        </aside>

        <main className="min-h-0 min-w-0 overflow-y-auto bg-[#080b12] p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {selected ? <ChainWorkspace chain={selected} /> : <EmptyState loading={loading} />}
        </main>

        <aside className="min-h-0 overflow-y-auto border-t border-white/10 bg-[#0a0e16] p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:border-l lg:border-t-0">
          {selected ? <DetailPane chain={selected} /> : <EmptyState loading={loading} compact />}
          {selected?.links.findingId && <ReviewerChat key={selected.links.findingId} findingId={selected.links.findingId} />}
        </aside>
      </div>
    </div>
  );
}

function StatusStrip({
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
      <Metric label="Product path" value={selected ? productPathStatus(selected) : loading ? 'Loading' : 'No data'} tone={productPathTone(selected)} />
      <Metric label="Submission proof" value={loading && !summary ? 'Loading' : summary?.status ?? 'No data'} tone={summary?.status} />
      <Metric label="Canonical chain" value={selected ? `${selected.scenario} / ${selected.status}` : loading ? 'Loading' : 'No data'} tone={selected?.status} />
      <Metric label="Last packet" value={proof ? proof.verdict : 'Not generated'} tone={proof?.verdict} />
    </section>
  );
}

function HistoricalAudit({
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

function ProofExplanation({
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
  const selectedGaps = selected?.missing ?? [];
  const details = [
    proof ? <span>Last packet used chain <CopyableUuid value={proof.chainId} /> and returned {proof.verdict}.</span> : 'No packet has been generated in this session.',
    selected ? `Selected chain is ${selected.scenario} / ${selected.status}.` : 'No chain is selected.',
    selected ? <span>Generate packet will use the selected {selected.scenario} / {selected.status} chain <CopyableUuid value={selected.chainId} />.</span> : 'No packet target is available.',
    failedGates.length > 0
      ? `Submission gates still failing: ${failedGates.map((gate) => gate.name).join(', ')}.`
      : 'Submission gates pass for the canonical proof set.',
    selectedGaps.length > 0
      ? `Selected-chain gaps: ${selectedGaps.map(proofGapLabel).join(', ')}.`
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

function LiveOperationDrawer({
  operation,
  selected,
  onClose,
}: {
  operation: LiveOperation;
  selected: FleetGraphReviewerChain | null;
  onClose: () => void;
}) {
  const now = useNow(operation.status === 'running');
  const steps = operationSteps(operation.kind);
  const elapsedMs = (operation.completedAt ?? now) - operation.startedAt;
  const activeIndex = operation.status === 'running'
    ? Math.min(steps.length - 1, Math.floor(elapsedMs / 1400))
    : steps.length - 1;
  const showCompact = operation.status !== 'running' && !operation.outputTail?.length;

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
              ? 'Expected path shown while the API works; final truth comes from the refreshed proof chain.'
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
              <div className="mt-1 text-xs leading-5 text-slate-400">{step.detail}</div>
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

function ChainWorkspace({ chain }: { chain: FleetGraphReviewerChain }) {
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
          Missing: {chain.missing.map(proofGapLabel).join(', ')}
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

function DetailPane({ chain }: { chain: FleetGraphReviewerChain }) {
  return (
    <div className="space-y-4">
      <Panel title="Chain detail" help="Raw IDs and trace links for the selected proof chain. These are for reviewers/admins, not public static proof.">
        <KeyValue label="Chain" value={chain.chainId} copyUuid />
        <KeyValue label="Run" value={chain.links.runId} copyUuid />
        <KeyValue label="Finding" value={chain.links.findingId} copyUuid />
        <KeyValue label="Trace" value={chain.links.traceUrl} link />
      </Panel>
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

function ReviewerChat({ findingId }: { findingId: string }) {
  const [prompt, setPrompt] = useState('What evidence proves this blocked finding and what still requires a human?');
  const [submitting, setSubmitting] = useState(false);
  const { chatTurns, beginTurn, resolveTurn, failTurn } = useFleetGraphChatTurns();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || submitting) return;
    const { turnId, history } = beginTurn(prompt.trim());
    setSubmitting(true);
    try {
      const response = await apiPostJson<FleetGraphChatResponse>(
        '/api/fleetgraph/chat',
        {
          prompt: prompt.trim(),
          context: { kind: 'finding', findingId },
          history,
        },
        'FleetGraph reviewer chat failed'
      );
      resolveTurn(turnId, response);
    } catch (err) {
      failTurn(turnId, err instanceof Error ? err.message : 'FleetGraph reviewer chat failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Panel title="Reviewer chat" help="Asks FleetGraph from the selected finding context. It should explain evidence and uncertainty without changing the source issue.">
      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-h-24 w-full resize-none rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-sky-300/60"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md border border-sky-300/30 bg-sky-400/10 px-3 py-2 text-sm font-medium text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Asking...' : 'Ask from finding context'}
        </button>
      </form>
      <div className="mt-4 space-y-3">
        {chatTurns.map((turn) => (
          <div key={turn.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs text-slate-500">{turn.prompt}</div>
            <div className="mt-2 text-sm text-slate-200">
              {turn.status === 'loading' ? 'Thinking...' : turn.response?.answer.body ?? turn.errorMessage}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ProofButton({
  label,
  help,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  help: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip text={help}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm font-medium text-white hover:border-white/35 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Running...' : label}
      </button>
    </Tooltip>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-[#0b0f18] px-5 py-4">
      <Tooltip text={metricHelp(label, value)}>
        <div className="inline-flex text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</div>
      </Tooltip>
      <div className={`mt-1 truncate text-lg font-semibold ${tone ? toneText(tone) : 'text-white'}`}>{value}</div>
    </div>
  );
}

function Panel({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-white/10 bg-[#0b0f18]">
      <div className="border-b border-white/10 px-3 py-2 text-sm font-semibold text-white">
        {help ? <Tooltip text={help}>{title}</Tooltip> : title}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function RailCard({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <Tooltip text={help}>
        <div className="inline-flex text-xs text-slate-500">{label}</div>
      </Tooltip>
      <div className="mt-1 text-sm text-slate-200">{value}</div>
    </div>
  );
}

function KeyValue({ label, value, link = false, copyUuid = false }: { label: string; value?: string; link?: boolean; copyUuid?: boolean }) {
  const help = keyValueHelp(label);
  return (
    <div className="mb-2 grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-3 last:mb-0">
      <div className="min-w-0">
        {help ? (
          <Tooltip text={help}>
            <div className="inline-flex max-w-full truncate text-xs text-slate-500">{label}</div>
          </Tooltip>
        ) : (
          <div className="truncate text-xs text-slate-500">{label}</div>
        )}
      </div>
      <div className="min-w-0 justify-self-end text-right">
        {value && link ? (
          <Tooltip text={value}>
            <a className="inline-flex max-w-full truncate text-sm text-sky-300 hover:text-sky-200" href={value} target="_blank" rel="noreferrer">
              {shortTraceUrl(value)}
            </a>
          </Tooltip>
        ) : value && copyUuid ? (
          <div className="truncate text-sm text-slate-300">
            <CopyableUuid value={value} />
          </div>
        ) : (
          <div className="truncate text-sm text-slate-300">{value ?? 'missing'}</div>
        )}
      </div>
    </div>
  );
}

function CopyableUuid({ value }: { value?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <>missing</>;
  const uuid = value;

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(uuid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Tooltip text={copied ? 'Copied' : `Click to copy ${uuid}`}>
      <button
        type="button"
        onClick={copy}
        onKeyDown={(event) => event.stopPropagation()}
        className="inline-flex max-w-full align-baseline font-mono text-inherit underline decoration-white/10 underline-offset-2 hover:text-sky-200 hover:decoration-sky-200/50"
      >
        {copied ? 'Copied' : shortUuid(uuid)}
      </button>
    </Tooltip>
  );
}

function StatusPill({ status }: { status: FleetGraphReviewerChain['status'] }) {
  return (
    <Tooltip text={statusHelp[status]}>
      <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[status]}`}>
        {status}
      </span>
    </Tooltip>
  );
}

function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex min-w-0 max-w-full align-middle">
      <span className="min-w-0 max-w-full cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60" tabIndex={0}>
        {children}
      </span>
      <span className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-72 rounded-md border border-white/10 bg-[#111827] px-3 py-2 text-left text-xs font-normal normal-case leading-5 tracking-normal text-slate-200 shadow-2xl shadow-black/40 group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

function EmptyState({ loading, compact = false }: { loading: boolean; compact?: boolean }) {
  return (
    <div className={`rounded-md border border-white/10 bg-white/[0.03] text-slate-400 ${compact ? 'p-3 text-sm' : 'p-8'}`}>
      {loading ? 'Loading live proof...' : 'Run the week-blocker scenario to create live proof.'}
    </div>
  );
}

function toneText(tone: string): string {
  if (tone === 'complete' || tone === 'pass') return 'text-emerald-200';
  if (tone === 'failed' || tone === 'fail') return 'text-rose-200';
  if (tone === 'broken' || tone === 'risk') return 'text-amber-200';
  if (tone === 'in_progress' || tone === 'blocked') return 'text-sky-200';
  return 'text-white';
}

function metricHelp(label: string, value: string): string {
  if (label === 'Product path') {
    return 'Whether the selected chain has the core FleetGraph path working: source, graph run, trace, finding, notification projection, and human gate.';
  }
  if (label === 'Submission proof') {
    return value === 'broken'
      ? 'Proof incomplete means the current proof set is not submission-ready. It often means a required proof gate is missing, not that FleetGraph itself failed.'
      : 'Overall final-submission proof status across the chains currently returned by the verifier.';
  }
  if (label === 'Canonical chain') return 'The live reviewer chain that represents the current submission proof story.';
  if (label === 'Last packet') return 'Most recent static proof packet generated from live verifier evidence in this session.';
  return 'Reviewer proof metric.';
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <Tooltip text={label === 'Historical audit'
      ? 'Complete historical runs divided by total loaded runs. This is background inventory, not the submission gate.'
      : 'Historical runs that are proof-incomplete under today’s stricter gates.'}
    >
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
        <div className="mt-1 text-base font-semibold text-white">{value}</div>
      </div>
    </Tooltip>
  );
}

function keyValueHelp(label: string): string | null {
  if (label === 'Chain') return 'The unique reviewer proof chain ID. This is normally the FleetGraph run ID.';
  if (label === 'Run') return 'The durable fleetgraph_runs row that produced this evidence.';
  if (label === 'Finding') return 'The durable fleetgraph_findings row attached to this chain, when one exists.';
  if (label === 'Trace') return 'Reviewer-safe observability trace link after URL sanitization.';
  if (label === 'Run age') return 'How long ago this FleetGraph run was created.';
  if (label === 'Worker age') return 'How long ago the matched worker tick started.';
  return null;
}

function chainTooltip(chain: FleetGraphReviewerChain): string {
  const missing = chain.missing.length ? ` Missing gates: ${chain.missing.map(proofGapLabel).join(', ')}.` : '';
  const scenario = chain.scenario === 'week-blocker'
    ? 'Canonical week-blocker proof scenario.'
    : 'Historical FleetGraph run from existing database evidence.';
  return `${scenario} Status: ${chain.status}. ${statusHelp[chain.status]}${missing}`;
}

function scenarioLabel(chain: FleetGraphReviewerChain): string {
  return chain.scenario === 'existing' ? 'historical run' : chain.scenario;
}

function preferredReviewerProofChain(chains: FleetGraphReviewerChain[]): FleetGraphReviewerChain | null {
  return chains.find((chain) => chain.scenario === 'week-blocker' && chain.status === 'complete')
    ?? chains.find((chain) => chain.status === 'complete')
    ?? chains.find((chain) => chain.scenario === 'week-blocker')
    ?? chains[0]
    ?? null;
}

function productPathStatus(chain: FleetGraphReviewerChain): string {
  const required = ['source', 'graph_run', 'trace', 'finding', 'notification_projection', 'chat_human_gate'];
  return required.every((key) => chain.steps.find((step) => step.key === key)?.status === 'pass')
    ? 'working'
    : 'partial';
}

function productPathTone(chain: FleetGraphReviewerChain | null): string | undefined {
  if (!chain) return undefined;
  return productPathStatus(chain) === 'working' ? 'complete' : 'in_progress';
}

function sourceMutationLabel(chain: FleetGraphReviewerChain): string {
  if (chain.sourceMutationCheck.passed) return 'Source fields unchanged by chat.';
  return chain.sourceMutationCheck.changedFields.includes('not_measured')
    ? 'Not measured yet.'
    : 'Source fields changed.';
}

function operationTitle(kind: OperationKind): string {
  if (kind === 'scenario') return 'Running reviewer scenario';
  if (kind === 'worker') return 'Triggering worker tick';
  if (kind === 'repair') return 'Repairing proof';
  return 'Generating proof packet';
}

function repairResultText(result: FleetGraphReviewerRepairResponse): string {
  if (result.repaired.length > 0) return `Repaired: ${result.repaired.map(proofGapLabel).join(', ')}.`;
  if (result.unsupported.length > 0) return `No safe repair was available for: ${result.unsupported.map(proofGapLabel).join(', ')}.`;
  return 'Proof inspected. No safe missing gates needed repair.';
}

function proofGapLabel(key: string): string {
  if (key === 'source_mutation_check') return 'source unchanged after chat';
  if (key === 'latency_under_5_minutes') return 'latency under 5 minutes';
  if (key === 'trace_quality') return 'trace quality';
  if (key === 'notification_projection') return 'notification projection';
  if (key === 'chat_human_gate') return 'chat/human gate';
  return key.replaceAll('_', ' ');
}

function operationFailure(err: unknown, fallback: string): {
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

function operationSteps(kind: OperationKind): OperationStep[] {
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

function operationStepState(
  status: OperationStatus,
  index: number,
  activeIndex: number
): 'waiting' | 'running' | 'passed' | 'failed' | 'expected' {
  if (status === 'failed') return index === activeIndex ? 'failed' : 'waiting';
  if (status === 'passed') return 'passed';
  if (index < activeIndex) return 'expected';
  if (index === activeIndex) return 'running';
  return 'waiting';
}

function operationStepClass(state: ReturnType<typeof operationStepState>): string {
  if (state === 'passed') return 'border-emerald-300/25 bg-emerald-400/[0.07] text-emerald-200';
  if (state === 'expected') return 'border-sky-300/20 bg-sky-400/[0.04] text-sky-200';
  if (state === 'running') return 'border-sky-300/35 bg-sky-400/[0.08] text-sky-200';
  if (state === 'failed') return 'border-rose-300/35 bg-rose-400/[0.08] text-rose-200';
  return 'border-white/10 bg-white/[0.03] text-slate-500';
}

function operationStepLabel(state: ReturnType<typeof operationStepState>): string {
  if (state === 'passed') return 'done';
  if (state === 'expected') return 'expected';
  if (state === 'running') return 'running';
  if (state === 'failed') return 'failed';
  return 'waiting';
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'missing';
  if (value < 1000) return `${value} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${(seconds / 60).toFixed(1)} m`;
}

function shortUuid(value: string): string {
  return UUID_PATTERN.test(value) ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}

function shortTraceUrl(value: string): string {
  try {
    const url = new URL(value);
    const traceId = url.pathname.split('/').filter(Boolean).at(-1);
    return traceId ? `trace ${shortId(traceId)}` : url.hostname;
  } catch {
    return value.length > 18 ? `${value.slice(0, 7)}...${value.slice(-7)}` : value;
  }
}

function shortId(value: string): string {
  return UUID_PATTERN.test(value) ? shortUuid(value) : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatCompactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return compactDateFormatter.format(date);
}

function formatDateText(value: string): string {
  return value.replace(ISO_TIMESTAMP_PATTERN, (match) => formatCompactDate(match));
}
