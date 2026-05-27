// FleetGraph issue surface renders the contextual agent panel inside issue documents.
import { FleetGraphContextPanel } from './FleetGraphContextPanel';
import { useFleetGraphIssueFindings } from '@/hooks/useFleetGraphQuery';

export function FleetGraphIssueSurface({ issueId }: { issueId: string }) {
  const findings = useFleetGraphIssueFindings(issueId);

  if (findings.isLoading) {
    return <FleetGraphContextPanel contextType="issue" contextLabel="issue" findings={[]} state="loading" />;
  }

  if (findings.isError) {
    return <FleetGraphContextPanel contextType="issue" contextLabel="issue" findings={[]} state="error" />;
  }

  return (
    <FleetGraphContextPanel
      contextType="issue"
      contextLabel="issue"
      findings={findings.data ?? []}
    />
  );
}
