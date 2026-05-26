// FleetGraph explain panel runs bounded on-demand explanation for one finding.
import { useState } from 'react';
import { useFleetGraphExplain } from '@/hooks/useFleetGraphQuery';
import { getApiErrorStatus } from '@/lib/api-error';

export function FleetGraphExplainPanel({ findingId }: { findingId: string }) {
  const explain = useFleetGraphExplain();
  const [open, setOpen] = useState(false);
  const output = explain.data?.visibleOutput;
  const errorStatus = getApiErrorStatus(explain.error);

  async function handleExplain() {
    setOpen(true);
    await explain.mutateAsync(findingId).catch(() => undefined);
  }

  return (
    <section className="rounded border border-border bg-background/40 p-3" aria-label="FleetGraph explanation">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-foreground">Why flagged?</h4>
          <p className="mt-0.5 text-xs text-muted">Explain from the current finding and visible evidence.</p>
        </div>
        <button
          type="button"
          onClick={handleExplain}
          disabled={explain.isPending}
          aria-busy={explain.isPending}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {explain.isPending ? 'Explaining...' : open ? 'Refresh' : 'Explain'}
        </button>
      </div>

      {explain.isError && (
        <p className="mt-3 text-sm text-red-300">
          {errorStatus === 404
            ? 'No visible FleetGraph finding here.'
            : 'FleetGraph could not explain this finding.'}
        </p>
      )}

      {output && (
        <div className="mt-3 max-h-64 overflow-auto rounded border border-border bg-border/20 p-3">
          <p className="text-sm font-medium text-foreground">{output.title}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{output.summary}</p>
          {output.evidence.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {output.evidence.map((item, index) => (
                <li key={`${item.kind}-${index}`}>{item.claim}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
