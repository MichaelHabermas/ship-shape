// FleetGraph reviewer UI primitives render shared control-room panels, metrics, and tooltips.
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import type { FleetGraphReviewerChain } from '@ship/shared';
import { statusHelp, statusTone } from '@/fleetgraph/reviewer/constants';
import { formatMs, shortTraceUrl, shortUuid, toneText } from '@/fleetgraph/reviewer/formatters';
import { keyValueHelp, metricHelp } from '@/fleetgraph/reviewer/chain-helpers';

export function ProofButton({
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

export function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-[#0b0f18] px-5 py-4">
      <Tooltip text={metricHelp(label, value)}>
        <div className="inline-flex text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</div>
      </Tooltip>
      <div className={`mt-1 truncate text-lg font-semibold ${tone ? toneText(tone) : 'text-white'}`}>{value}</div>
    </div>
  );
}

export function MetricMini({ label, value }: { label: string; value: string }) {
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

export function Panel({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-white/10 bg-[#0b0f18]">
      <div className="border-b border-white/10 px-3 py-2 text-sm font-semibold text-white">
        {help ? <Tooltip text={help}>{title}</Tooltip> : title}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function RailCard({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
      <Tooltip text={help}>
        <div className="inline-flex text-xs text-slate-500">{label}</div>
      </Tooltip>
      <div className="mt-1 text-sm text-slate-200">{value}</div>
    </div>
  );
}

export function KeyValue({ label, value, link = false, copyUuid = false }: { label: string; value?: string; link?: boolean; copyUuid?: boolean }) {
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

export function CopyableUuid({ value }: { value?: string }) {
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

export function StatusPill({ status }: { status: FleetGraphReviewerChain['status'] }) {
  return (
    <Tooltip text={statusHelp[status]}>
      <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[status]}`}>
        {status}
      </span>
    </Tooltip>
  );
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
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

export function EmptyState({ loading, compact = false }: { loading: boolean; compact?: boolean }) {
  return (
    <div className={`rounded-md border border-white/10 bg-white/[0.03] text-slate-400 ${compact ? 'p-3 text-sm' : 'p-8'}`}>
      {loading ? 'Loading live proof...' : 'Run the week-blocker scenario to create live proof.'}
    </div>
  );
}

export function useNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

export { formatMs };
