// FleetGraph active-week banner surfaces sprint findings without a global inbox.
import { Link } from 'react-router-dom';
import type { FleetGraphFindingView } from '@/hooks/useFleetGraphQuery';

export function FleetGraphActiveWeekBanner({ findings }: { findings: FleetGraphFindingView[] }) {
  if (findings.length === 0) return null;

  const first = findings[0];
  return (
    <aside className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3" aria-label="FleetGraph active week findings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-200">
              FleetGraph
            </span>
            <span className="text-xs text-amber-100/80">
              {findings.length} active-week {findings.length === 1 ? 'finding' : 'findings'}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-foreground">{first.title}</p>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted">{first.summary}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {findings.slice(0, 4).map((finding, index) => (
            <Link
              key={finding.id}
              to={`/documents/${finding.sourceIssueId}`}
              aria-label={`Open issue: ${finding.title}`}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
            >
              Issue {index + 1}
            </Link>
          ))}
          {findings.length > 4 && (
            <span className="rounded border border-amber-500/30 px-3 py-1.5 text-sm text-amber-100/80">
              +{findings.length - 4} more below
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
