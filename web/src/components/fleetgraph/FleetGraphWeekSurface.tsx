// FleetGraph week surface renders sprint findings above active-week work.
import { FleetGraphActiveWeekBanner } from './FleetGraphActiveWeekBanner';
import { FleetGraphFindingCard } from './FleetGraphFindingCard';
import { FleetGraphStatePanel } from './FleetGraphStatePanel';
import { useFleetGraphSprintFindings } from '@/hooks/useFleetGraphQuery';

export function FleetGraphWeekSurface({ sprintId }: { sprintId: string }) {
  const findings = useFleetGraphSprintFindings(sprintId);

  if (findings.isLoading) {
    return <FleetGraphStatePanel state="loading" />;
  }

  if (findings.isError) {
    return <FleetGraphStatePanel state="error" />;
  }

  if (!findings.data || findings.data.length === 0) {
    return null;
  }

  return (
    <div>
      <FleetGraphActiveWeekBanner findings={findings.data} />
      <div className="space-y-3 border-b border-border bg-background p-4">
        {findings.data.map((finding) => (
          <FleetGraphFindingCard key={finding.id} finding={finding} />
        ))}
      </div>
    </div>
  );
}
