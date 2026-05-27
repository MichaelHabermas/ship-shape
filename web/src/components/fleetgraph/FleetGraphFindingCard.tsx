// FleetGraph finding card shows blocker evidence and owner context.
import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useFleetGraphDismiss, type FleetGraphFindingView } from '@/hooks/useFleetGraphQuery';
import { useTeamMembersQuery } from '@/hooks/useTeamMembersQuery';
import { getApiErrorStatus } from '@/lib/api-error';

type FleetGraphFindingCardProps = {
  finding: FleetGraphFindingView;
};

const showDeveloperTrace = import.meta.env.DEV;

function label(value: string | null): string {
  return value ? value.replace(/_/g, ' ') : 'Unknown';
}

function recipientRoleLabel(role: string | null): string {
  if (role === 'issue_assignee') return 'Issue assignee';
  if (role === 'sprint_owner') return 'Week owner';
  return 'Recipient';
}

function userSummary(summary: string): string {
  return summary
    .replace(/;\s*FleetGraph refreshed the existing finding instead of creating a duplicate\./g, '.')
    .replace(/\s*FleetGraph refreshed the existing finding instead of creating a duplicate\./g, '')
    .trim();
}

export function FleetGraphFindingCard({ finding }: FleetGraphFindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const dismiss = useFleetGraphDismiss();
  const dismissErrorStatus = getApiErrorStatus(dismiss.error);
  const teamMembers = useTeamMembersQuery();
  const proposedRecipient = finding.proposedRecipient ?? { role: null, userId: null, rationale: null };
  const recipient = proposedRecipient.userId
    ? (teamMembers.data ?? []).find((member) => member.user_id === proposedRecipient.userId)
    : null;
  const recipientName = recipient?.name ?? 'No named recipient';
  const recipientEmail = recipient?.email;
  const summary = userSummary(finding.summary);

  async function handleDismiss() {
    await dismiss.mutateAsync(finding.id).catch(() => undefined);
  }

  function toggleExpanded() {
    setExpanded((current) => !current);
  }

  function handleToggleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleExpanded();
    }
  }

  return (
    <article className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-foreground" aria-label="FleetGraph finding">
      <div
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={handleToggleKeyDown}
        aria-expanded={expanded}
        className="flex cursor-pointer items-start justify-between gap-4"
      >
        <div
          className="min-w-0"
        >
          <h3 className="text-base font-semibold text-foreground">{finding.title}</h3>
          <p className="mt-1 leading-5 text-muted">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <Link
            to={`/documents/${finding.sourceIssueId}`}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-border"
          >
            Open issue
          </Link>
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-border"
          >
            {expanded ? 'Collapse' : 'Details'}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismiss.isPending}
            aria-busy={dismiss.isPending}
            title="Hide this FleetGraph finding. It can reappear if the blocker signal is detected again."
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-foreground disabled:opacity-50"
          >
            {dismiss.isPending ? 'Dismissing...' : 'Dismiss'}
          </button>
        </div>
      </div>

      {dismiss.isError && (
        <p className="mt-3 text-sm text-red-300">
          {dismissErrorStatus === 403
            ? 'Only workspace admins can dismiss shared FleetGraph findings.'
            : 'FleetGraph could not dismiss this finding.'}
        </p>
      )}

      {finding.severity && (
        <dl
          role="button"
          tabIndex={0}
          onClick={toggleExpanded}
          onKeyDown={handleToggleKeyDown}
          aria-expanded={expanded}
          className="mt-3 flex cursor-pointer flex-wrap gap-x-4 gap-y-1 border-y border-border py-2 text-xs"
        >
          <div className="flex gap-1.5">
            <dt className="text-muted">Priority</dt>
            <dd className="capitalize text-foreground">{label(finding.severity)}</dd>
          </div>
        </dl>
      )}

      {expanded && (
        <>
          <section className="mt-3" aria-label="FleetGraph evidence">
            <h4 className="text-sm font-medium text-foreground">Evidence</h4>
            <ul className="mt-1.5 divide-y divide-border rounded border border-border bg-background/30">
              {finding.evidence.map((item, index) => (
                <li key={`${item.kind}-${index}`} className="px-3 py-1.5">
                  <p className="text-sm leading-5 text-foreground">
                    {item.claim}
                    {item.excerpt && <span className="text-muted"> · {item.excerpt}</span>}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {proposedRecipient.userId && (
            <section className="mt-3 rounded border border-border bg-background/40 px-3 py-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Recipient</h4>
              <p className="mt-1 text-sm text-foreground">
                {recipientName}
                <span className="text-muted"> · {recipientRoleLabel(proposedRecipient.role)}</span>
              </p>
              {recipientEmail && <p className="mt-0.5 truncate text-xs text-muted">{recipientEmail}</p>}
            </section>
          )}

          {showDeveloperTrace && (
            <footer className="mt-3 truncate border-t border-border pt-2 text-xs text-muted">
              Dev trace: {finding.trace.decision}
              {finding.trace.traceUrl && (
                <>
                  {' '}
                  <a className="text-accent hover:underline" href={finding.trace.traceUrl} target="_blank" rel="noreferrer">
                    Open trace
                  </a>
                </>
              )}
            </footer>
          )}
        </>
      )}
    </article>
  );
}
