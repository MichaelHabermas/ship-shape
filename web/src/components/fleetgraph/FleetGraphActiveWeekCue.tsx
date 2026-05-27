// FleetGraphActiveWeekCue makes proactive findings discoverable before opening a deep week tab.
import { Link } from 'react-router-dom';
import { useActiveWeeksQuery, type ActiveWeekItem } from '@/hooks/useWeeksQuery';
import { useFleetGraphSprintFindings } from '@/hooks/useFleetGraphQuery';

function FleetGraphWeekCueRow({ week }: { week: ActiveWeekItem }) {
  const findings = useFleetGraphSprintFindings(week.id);
  const count = findings.data?.length ?? 0;

  if (count === 0) return null;

  return (
    <div className="flex min-h-9 items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-200">
          FleetGraph
        </span>
        <span className="truncate text-sm text-amber-50">
          {count} active-week blocker{count === 1 ? ' needs' : 's need'} PM review
        </span>
        <span className="hidden truncate text-xs text-amber-100/70 sm:inline">
          {week.name}
        </span>
      </div>
      <Link
        to={`/documents/${week.id}/issues`}
        className="flex-shrink-0 rounded bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent/90 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background"
      >
        Open week
      </Link>
    </div>
  );
}

export function FleetGraphActiveWeekCue() {
  const activeWeeks = useActiveWeeksQuery();
  const weeks = activeWeeks.data?.weeks ?? [];

  if (weeks.length === 0) return null;

  return (
    <>
      {weeks.map((week) => (
        <FleetGraphWeekCueRow key={week.id} week={week} />
      ))}
    </>
  );
}
