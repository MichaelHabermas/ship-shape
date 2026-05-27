// FleetGraph finding card presents sparse unblock prompts for PM review.
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  useFleetGraphChanges,
  useFleetGraphDismiss,
  useFleetGraphExplain,
  useFleetGraphRefine,
  type FleetGraphFindingView,
} from '@/hooks/useFleetGraphQuery';
import { useTeamMembersQuery } from '@/hooks/useTeamMembersQuery';
import { getApiErrorStatus } from '@/lib/api-error';

type FleetGraphFindingCardProps = {
  finding: FleetGraphFindingView;
};

const showDeveloperTrace = import.meta.env.DEV;

function label(value: string | null): string {
  return value ? value.replace(/_/g, ' ') : 'Unknown';
}

function sentenceLabel(value: string | null): string {
  const text = label(value);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
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

function blockerText(summary: string): string {
  const recordedBlocker = summary.match(/recorded blocker:\s*(.+)$/i)?.[1];
  if (recordedBlocker) return recordedBlocker.replace(/\.$/, '');
  return summary.replace(/\.$/, '');
}

function whyNow(finding: FleetGraphFindingView): string {
  const priority = finding.severity ? sentenceLabel(finding.severity) : 'Important';
  return `${priority} active week.`;
}

function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

function preparedAsk(name: string | null, blocker: string, fallback: string | null): string {
  if (!name) return fallback ?? 'Confirm the unblock path today.';
  if (!blocker) return fallback ?? 'Confirm the unblock path today.';
  return `${firstName(name)}, can you confirm the unblock path today? ${blocker}.`;
}

export function FleetGraphFindingCard({ finding }: FleetGraphFindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState('');
  const dismiss = useFleetGraphDismiss();
  const changes = useFleetGraphChanges();
  const explain = useFleetGraphExplain();
  const refine = useFleetGraphRefine();
  const dismissErrorStatus = getApiErrorStatus(dismiss.error);
  const teamMembers = useTeamMembersQuery();
  const proposedRecipient = finding.proposedRecipient ?? { role: null, userId: null, rationale: null };
  const recipient = proposedRecipient.userId
    ? (teamMembers.data ?? []).find((member) => member.user_id === proposedRecipient.userId)
    : null;
  const recipientName = recipient?.name ?? 'No named recipient';
  const recipientEmail = recipient?.email;
  const summary = userSummary(finding.summary);
  const blocker = blockerText(summary);
  const nextAction = finding.recommendedAction ?? 'Confirm the unblock path.';
  const ask = preparedAsk(recipient ? recipientName : null, blocker, finding.draftText);
  const changeRows = expanded
    ? changes.data?.rows.filter((row) => row.label !== 'Not done')
    : changes.data?.rows;

  async function handleDismiss() {
    await dismiss.mutateAsync(finding.id).catch(() => undefined);
  }

  async function handleChanges() {
    await changes.mutateAsync(finding.id).catch(() => undefined);
  }

  async function handleExplain() {
    setExpanded(true);
    await explain.mutateAsync(finding.id).catch(() => undefined);
  }

  async function handleRefine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instruction = refineInstruction.trim();
    if (!instruction) return;
    await refine.mutateAsync({ findingId: finding.id, instruction }).then(() => {
      setRefineInstruction('');
    }).catch(() => undefined);
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
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{finding.title}</h3>
          <p className="mt-1 leading-5 text-muted">{blocker}</p>
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
            onClick={handleChanges}
            disabled={changes.isPending}
            aria-busy={changes.isPending}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-border disabled:opacity-50"
          >
            {changes.isPending ? 'Checking...' : 'What changed?'}
          </button>
          <button
            type="button"
            onClick={handleExplain}
            disabled={explain.isPending}
            aria-busy={explain.isPending}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-border disabled:opacity-50"
          >
            {explain.isPending ? 'Explaining...' : 'Why flagged?'}
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

      {changes.isError && (
        <p className="mt-3 text-sm text-red-300">No change summary available.</p>
      )}

      {explain.isError && (
        <p className="mt-3 text-sm text-red-300">FleetGraph could not explain this finding.</p>
      )}

      {refine.isError && (
        <p className="mt-3 text-sm text-red-300">FleetGraph could not refine the draft.</p>
      )}

      {changes.data && (
        <section className="mt-3 rounded border border-border bg-background/40 p-3" aria-label="FleetGraph change summary">
          <h4 className="text-sm font-medium text-foreground">{changes.data.headline}</h4>
          <dl className="mt-2 grid gap-2">
            {changeRows?.map((row, index) => (
              <div key={`${row.label}-${index}`} className="grid gap-1 sm:grid-cols-[7rem_1fr]">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">{row.label}</dt>
                <dd className="text-sm leading-5 text-foreground">{row.text}</dd>
              </div>
            ))}
          </dl>
        </section>
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
          {explain.data?.visibleOutput && (
            <section className="mt-3 rounded border border-border bg-background/40 p-3" aria-label="FleetGraph contextual answer">
              <h4 className="text-sm font-medium text-foreground">{explain.data.visibleOutput.title}</h4>
              <p className="mt-1 text-sm leading-5 text-foreground">{explain.data.visibleOutput.summary}</p>
              <p className="mt-2 text-xs text-muted">No issue changed. No message sent.</p>
            </section>
          )}

          <section className="mt-3 rounded border border-border bg-background/40 p-3" aria-label="FleetGraph unblock prompt">
            <dl className="grid gap-3 md:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">Unblock</dt>
                <dd className="mt-1 text-sm leading-5 text-foreground">{blocker}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">Ask</dt>
                <dd className="mt-1 text-sm leading-5 text-foreground">{nextAction}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">Why now</dt>
                <dd className="mt-1 text-sm leading-5 text-foreground">{whyNow(finding)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted">Not done</dt>
                <dd className="mt-1 text-sm leading-5 text-foreground">No issue changed. No message sent.</dd>
              </div>
            </dl>
          </section>

          {proposedRecipient.userId && (
            <section className="mt-3 rounded border border-border bg-background/40 px-3 py-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Send to</h4>
              <p className="mt-1 text-sm text-foreground">
                {recipientName}
                <span className="text-muted"> · {recipientRoleLabel(proposedRecipient.role)}</span>
              </p>
              {recipientEmail && <p className="mt-0.5 truncate text-xs text-muted">{recipientEmail}</p>}
            </section>
          )}

          {ask && (
            <section className="mt-3 rounded border border-border bg-background/40 px-3 py-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Message</h4>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-foreground">{ask}</p>
              <form onSubmit={handleRefine} className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={refineInstruction}
                  onChange={(event) => setRefineInstruction(event.target.value)}
                  maxLength={2000}
                  placeholder="Ask FleetGraph to rewrite this draft..."
                  aria-label="Ask FleetGraph to rewrite this draft"
                  className="min-h-9 flex-1 rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button
                  type="submit"
                  disabled={refine.isPending || refineInstruction.trim().length === 0}
                  aria-busy={refine.isPending}
                  className="rounded bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                >
                  {refine.isPending ? 'Rewriting...' : 'Rewrite'}
                </button>
              </form>
            </section>
          )}

          {finding.uncertainty && (
            <section className="mt-3 rounded border border-border bg-background/40 px-3 py-2">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted">Unknown</h4>
              <p className="mt-1 text-sm leading-5 text-foreground">{finding.uncertainty}</p>
            </section>
          )}

          {showDeveloperTrace && (
            <footer className="mt-3 truncate border-t border-border pt-2 text-xs text-muted">
              Dev trace: {finding.trace.decision}
            </footer>
          )}
        </>
      )}
    </article>
  );
}
