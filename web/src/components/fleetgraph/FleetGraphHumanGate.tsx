// FleetGraph human gate makes prepared-but-not-executed consequences explicit.
import type { FleetGraphFindingView } from '@/hooks/useFleetGraphQuery';

export function FleetGraphHumanGate({ finding }: { finding: FleetGraphFindingView }) {
  const reason = finding.humanGate.reason ?? 'FleetGraph needs a human before contacting anyone or changing Ship.';
  const consequence = finding.humanGate.blockedConsequence ?? 'Sending, posting, assigning, moving, or changing Ship records is blocked in this MVP.';

  return (
    <section className="rounded border border-amber-500/30 bg-amber-500/10 p-3" aria-label="Human approval gate">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-amber-200">Needs approval</h4>
          <p className="mt-1 text-xs leading-5 text-amber-100/80">{reason}</p>
        </div>
        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-100">
          Prepared
        </span>
      </div>

      <div className="mt-3 border-t border-amber-500/20 pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-amber-200/80">Blocked consequence</p>
        <p className="mt-1 text-xs leading-5 text-amber-100/80">{consequence}</p>
      </div>

      <button
        type="button"
        disabled
        className="mt-3 w-full rounded bg-border px-3 py-2 text-sm font-medium text-muted opacity-70"
      >
        Prepared only - nothing sent
      </button>
    </section>
  );
}
