// FleetGraph week surface renders the contextual agent panel above active-week work.
import { FleetGraphContextPanel } from './FleetGraphContextPanel';
import { useFleetGraphSprintFindings } from '@/hooks/useFleetGraphQuery';

export function FleetGraphWeekSurface({ sprintId }: { sprintId: string }) {
  const findings = useFleetGraphSprintFindings(sprintId);

  if (findings.isLoading) {
    return <FleetGraphContextPanel contextType="sprint" contextLabel="week" findings={[]} state="loading" />;
  }

  if (findings.isError) {
    return <FleetGraphContextPanel contextType="sprint" contextLabel="week" findings={[]} state="error" />;
  }

  return (
    <FleetGraphContextPanel
      contextType="sprint"
      contextLabel="week"
      findings={findings.data ?? []}
      showEmpty
    />
  );
}
