// FleetGraph finding card shows evidence, draft, trace, and human gate in context.
import { useFleetGraphDismiss, type FleetGraphFindingView } from '@/hooks/useFleetGraphQuery';
import { getApiErrorStatus } from '@/lib/api-error';
import { FleetGraphDraftRefiner } from './FleetGraphDraftRefiner';
import { FleetGraphExplainPanel } from './FleetGraphExplainPanel';
import { FleetGraphHumanGate } from './FleetGraphHumanGate';

type FleetGraphFindingCardProps = {
  finding: FleetGraphFindingView;
};

function label(value: string | null): string {
  return value ? value.replace(/_/g, ' ') : 'Unknown';
}

export function FleetGraphFindingCard({ finding }: FleetGraphFindingCardProps) {
  const dismiss = useFleetGraphDismiss();
  const dismissErrorStatus = getApiErrorStatus(dismiss.error);

  async function handleDismiss() {
    await dismiss.mutateAsync(finding.id).catch(() => undefined);
  }

  return (
    <article className="rounded border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground" aria-label="FleetGraph finding">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-200">
              FleetGraph
            </span>
            <span className="text-xs text-muted">{finding.status}</span>
          </div>
          <h3 className="mt-2 text-base font-semibold text-foreground">{finding.title}</h3>
          <p className="mt-1 leading-6 text-muted">{finding.summary}</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={dismiss.isPending}
          aria-busy={dismiss.isPending}
          className="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-border hover:text-foreground disabled:opacity-50"
        >
          {dismiss.isPending ? 'Dismissing...' : 'Admin dismiss'}
        </button>
      </div>

      {dismiss.isError && (
        <p className="mt-3 text-sm text-red-300">
          {dismissErrorStatus === 403
            ? 'Only workspace admins can dismiss shared FleetGraph findings.'
            : 'FleetGraph could not dismiss this finding.'}
        </p>
      )}

      {(finding.severity || finding.confidence || finding.recommendedAction) && (
        <dl className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded border border-border bg-border/20 px-3 py-2">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Severity</dt>
            <dd className="mt-1 capitalize text-foreground">{label(finding.severity)}</dd>
          </div>
          <div className="rounded border border-border bg-border/20 px-3 py-2">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Confidence</dt>
            <dd className="mt-1 capitalize text-foreground">{label(finding.confidence)}</dd>
          </div>
          <div className="rounded border border-border bg-border/20 px-3 py-2">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Next action</dt>
            <dd className="mt-1 text-foreground">{finding.recommendedAction ?? 'Prepare unblock follow-up'}</dd>
          </div>
        </dl>
      )}

      <section className="mt-4" aria-label="FleetGraph evidence">
        <h4 className="text-sm font-medium text-foreground">Evidence</h4>
        <ul className="mt-2 space-y-2">
          {finding.evidence.map((item, index) => (
            <li key={`${item.kind}-${index}`} className="rounded border border-border bg-background/40 px-3 py-2">
              <p className="text-sm text-foreground">{item.claim}</p>
              {item.excerpt && <p className="mt-1 text-xs leading-5 text-muted">{item.excerpt}</p>}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          {finding.recipientRationale && (
            <section className="rounded border border-border bg-background/40 p-3">
              <h4 className="text-sm font-medium text-foreground">Smallest useful audience</h4>
              <p className="mt-1 text-sm leading-6 text-muted">{finding.recipientRationale}</p>
            </section>
          )}
          {finding.uncertainty && (
            <section className="rounded border border-border bg-background/40 p-3">
              <h4 className="text-sm font-medium text-foreground">Uncertainty</h4>
              <p className="mt-1 text-sm leading-6 text-muted">{finding.uncertainty}</p>
            </section>
          )}
          <FleetGraphExplainPanel findingId={finding.id} />
        </div>

        <div className="space-y-3">
          {finding.draftText && (
            <section className="rounded border border-border bg-background/40 p-3">
              <h4 className="text-sm font-medium text-foreground">Prepared draft</h4>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{finding.draftText}</p>
            </section>
          )}
          <FleetGraphDraftRefiner findingId={finding.id} />
          <FleetGraphHumanGate finding={finding} />
        </div>
      </div>

      <footer className="mt-4 border-t border-border pt-3 text-xs text-muted">
        Trace: {finding.trace.decision} via {finding.trace.nodePath.join(' -> ')}
        {finding.trace.traceUrl && (
          <>
            {' '}
            <a className="text-accent hover:underline" href={finding.trace.traceUrl} target="_blank" rel="noreferrer">
              Open trace
            </a>
          </>
        )}
      </footer>
    </article>
  );
}
