// FleetGraph context panel hosts finding-aware agent interactions inside Ship object views.
import { FleetGraphFindingCard } from './FleetGraphFindingCard';
import { FleetGraphStatePanel } from './FleetGraphStatePanel';
import type { FleetGraphFindingView } from '@/hooks/useFleetGraphQuery';

export type FleetGraphContextType = 'issue' | 'sprint' | 'project' | 'program';

type FleetGraphContextPanelProps = {
  contextType: FleetGraphContextType;
  contextLabel: string;
  findings: FleetGraphFindingView[];
  state?: 'ready' | 'loading' | 'empty' | 'error';
  showEmpty?: boolean;
};

function contextNoun(contextType: FleetGraphContextType): string {
  if (contextType === 'sprint') return 'week';
  return contextType;
}

export function FleetGraphContextPanel({
  contextType,
  contextLabel,
  findings,
  state = 'ready',
  showEmpty = false,
}: FleetGraphContextPanelProps) {
  if (state === 'loading') {
    return (
      <section className="border-b border-border bg-background p-4" aria-label={`FleetGraph ${contextLabel}`}>
        <FleetGraphStatePanel state="loading" />
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section className="border-b border-border bg-background p-4" aria-label={`FleetGraph ${contextLabel}`}>
        <FleetGraphStatePanel state="error" />
      </section>
    );
  }

  if (findings.length === 0) {
    if (!showEmpty) return null;

    return (
      <section className="border-b border-border bg-background p-4" aria-label={`FleetGraph ${contextLabel}`}>
        <div className="rounded border border-border bg-border/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">FleetGraph</h2>
              <p className="mt-1 text-sm text-muted">
                No visible findings for this {contextNoun(contextType)} right now.
              </p>
            </div>
            <span className="rounded border border-border px-2 py-1 text-xs capitalize text-muted">
              {contextNoun(contextType)}
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3 border-b border-border bg-background p-4" aria-label={`FleetGraph ${contextLabel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">FleetGraph</h2>
          <p className="mt-0.5 text-sm text-muted">
            {findings.length} contextual finding{findings.length === 1 ? '' : 's'} for this {contextNoun(contextType)}.
          </p>
        </div>
        <span className="rounded border border-border px-2 py-1 text-xs capitalize text-muted">
          {contextNoun(contextType)}
        </span>
      </div>
      {findings.map((finding) => (
        <FleetGraphFindingCard key={finding.id} finding={finding} />
      ))}
    </section>
  );
}
