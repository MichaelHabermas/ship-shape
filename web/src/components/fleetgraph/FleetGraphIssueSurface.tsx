// FleetGraph issue surface renders visible findings inside the document context.
import { FleetGraphFindingCard } from './FleetGraphFindingCard';
import { FleetGraphStatePanel } from './FleetGraphStatePanel';
import { useFleetGraphIssueFindings } from '@/hooks/useFleetGraphQuery';

export function FleetGraphIssueSurface({ issueId }: { issueId: string }) {
  const findings = useFleetGraphIssueFindings(issueId);

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
    <div className="space-y-3 border-b border-border bg-background p-4">
      {findings.data.map((finding) => (
        <FleetGraphFindingCard key={finding.id} finding={finding} />
      ))}
    </div>
  );
}
