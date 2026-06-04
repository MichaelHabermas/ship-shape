import { cn } from '@/lib/cn';
import { priorityColors } from '@/lib/statusColors';
import type { Issue } from '@/components/WeekReconciliation';

const STATE_COLORS: Record<string, string> = {
  backlog: 'bg-gray-500',
  todo: 'bg-blue-500',
  in_progress: 'bg-yellow-500',
  in_review: 'bg-purple-500',
  done: 'bg-green-500',
  cancelled: 'bg-red-500',
};

const STATE_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

type WeekReconciliationPromptProps = {
  incompleteIssues: Issue[];
  expanded: boolean;
  bulkPending: boolean;
  pendingAction: string | null;
  moveToNextSprintPending: boolean;
  moveToBacklogPending: boolean;
  closeIssuePending: boolean;
  onMoveAllToBacklog: () => void;
  onToggleExpanded: () => void;
  onDismiss: () => void;
  onNextSprint: (issue: Issue) => void;
  onBacklog: (issue: Issue) => void;
  onClose: (issue: Issue, state: 'done' | 'cancelled') => void;
};

export function WeekReconciliationPrompt({
  incompleteIssues,
  expanded,
  bulkPending,
  pendingAction,
  moveToNextSprintPending,
  moveToBacklogPending,
  closeIssuePending,
  onMoveAllToBacklog,
  onToggleExpanded,
  onDismiss,
  onNextSprint,
  onBacklog,
  onClose,
}: WeekReconciliationPromptProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium text-yellow-600">
              {incompleteIssues.length} incomplete issue{incompleteIssues.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onMoveAllToBacklog}
              disabled={bulkPending}
              className="rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {bulkPending ? 'Moving...' : 'Move all to backlog'}
            </button>
            <button
              type="button"
              onClick={onToggleExpanded}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
            >
              {expanded ? 'Collapse' : 'Review individually'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-border/50 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          {expanded
            ? 'Choose what to do with each issue below.'
            : 'Move all to backlog, review individually, or dismiss to continue with the review.'}
        </p>
      </div>

      {expanded && (
        <div className="space-y-2">
          {incompleteIssues.map(issue => (
            <WeekReconciliationIssueRow
              key={issue.id}
              issue={issue}
              isPending={pendingAction === issue.id}
              bulkPending={bulkPending}
              moveToNextSprintPending={moveToNextSprintPending}
              moveToBacklogPending={moveToBacklogPending}
              closeIssuePending={closeIssuePending}
              onNextSprint={onNextSprint}
              onBacklog={onBacklog}
              onClose={onClose}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekReconciliationIssueRow({
  issue,
  isPending,
  bulkPending,
  moveToNextSprintPending,
  moveToBacklogPending,
  closeIssuePending,
  onNextSprint,
  onBacklog,
  onClose,
}: {
  issue: Issue;
  isPending: boolean;
  bulkPending: boolean;
  moveToNextSprintPending: boolean;
  moveToBacklogPending: boolean;
  closeIssuePending: boolean;
  onNextSprint: (issue: Issue) => void;
  onBacklog: (issue: Issue) => void;
  onClose: (issue: Issue, state: 'done' | 'cancelled') => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', STATE_COLORS[issue.state])} />
          <span className="text-xs font-mono text-muted">{issue.display_id}</span>
          <span className={cn('text-xs', priorityColors[issue.priority])}>
            {issue.priority !== 'none' && issue.priority.charAt(0).toUpperCase()}
          </span>
          {issue.estimate && (
            <span className="text-xs text-muted">{issue.estimate}h</span>
          )}
          <span className="text-xs text-muted capitalize">
            {STATE_LABELS[issue.state] || issue.state}
          </span>
        </div>
        <p className="mt-1 truncate text-sm text-foreground">{issue.title}</p>
        {issue.assignee_name && (
          <p className="text-xs text-muted">Assigned to {issue.assignee_name}</p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onNextSprint(issue)}
          disabled={isPending || bulkPending}
          className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          title="Move to next week"
        >
          {isPending && moveToNextSprintPending ? '...' : 'Next Week'}
        </button>
        <button
          type="button"
          onClick={() => onBacklog(issue)}
          disabled={isPending || bulkPending}
          className="rounded-md bg-gray-600 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
          title="Return to backlog"
        >
          {isPending && moveToBacklogPending ? '...' : 'Backlog'}
        </button>
        <button
          type="button"
          onClick={() => onClose(issue, 'done')}
          disabled={isPending || bulkPending}
          className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          title="Mark as done"
        >
          {isPending && closeIssuePending ? '...' : 'Done'}
        </button>
        <button
          type="button"
          onClick={() => onClose(issue, 'cancelled')}
          disabled={isPending || bulkPending}
          className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          title="Cancel issue"
        >
          {isPending && closeIssuePending ? '...' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
