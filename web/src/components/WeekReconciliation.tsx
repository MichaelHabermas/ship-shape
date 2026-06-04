import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { apiGet, apiPatch, apiPost, readJson } from '@/lib/api';
import type { Sprint as WeekSprint } from '@/hooks/useWeeksQuery';
import type { ProgramSprintsResponse } from '@/api/schemas';
import { priorityColors } from '@/lib/statusColors';

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  display_id: string;
  estimate: number | null;
  assignee_name: string | null;
}

export interface ReconciliationDecision {
  issue_id: string;
  issue_title: string;
  display_id: string;
  action: 'next_sprint' | 'backlog' | 'close_done' | 'close_cancelled';
  timestamp: string;
}

interface WeekReconciliationProps {
  sprintId: string;
  sprintNumber: number;
  programId: string;
  onDecisionMade?: (decision: ReconciliationDecision) => void;
}

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

export function WeekReconciliation({
  sprintId,
  sprintNumber,
  programId,
  onDecisionMade,
}: WeekReconciliationProps) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);

  // Fetch sprint issues
  const { data: issues = [], isLoading } = useQuery<Issue[]>({
    queryKey: ['sprint-issues', sprintId],
    queryFn: async () => {
      const response = await apiGet(`/api/weeks/${sprintId}/issues`);
      if (!response.ok) throw new Error('Failed to fetch issues');
      return readJson<Issue[]>(response);
    },
  });

  // Filter incomplete issues (not done, not cancelled)
  const incompleteIssues = useMemo(() => {
    return issues.filter(issue => issue.state !== 'done' && issue.state !== 'cancelled');
  }, [issues]);

  // Fetch or find next sprint
  const { data: nextSprint } = useQuery<WeekSprint | null>({
    queryKey: ['next-sprint', programId, sprintNumber],
    queryFn: async () => {
      // Try to find existing sprint with sprint_number + 1 for same program
      const response = await apiGet(`/api/programs/${programId}/sprints`);
      if (!response.ok) return null;

      const data = await readJson<ProgramSprintsResponse>(response);
      const sprints = data.weeks || [];
      const next = sprints.find(s => s.sprint_number === sprintNumber + 1);
      return next || null;
    },
  });

  // Mutation to move issue to next sprint
  const moveToNextSprintMutation = useMutation({
    mutationFn: async (issue: Issue) => {
      let targetSprintId: string | undefined = nextSprint?.id;

      // If next sprint doesn't exist, create it
      if (!targetSprintId) {
        const createResponse = await apiPost('/api/weeks', {
          program_id: programId,
          sprint_number: sprintNumber + 1,
          title: `Week ${sprintNumber + 1}`,
        });

        if (!createResponse.ok) {
          throw new Error('Failed to create next week');
        }

        const newSprint = await readJson<{ id: string }>(createResponse);
        targetSprintId = newSprint.id;
      }

      if (!targetSprintId) {
        throw new Error('Missing target sprint');
      }

      const resolvedTargetSprintId = targetSprintId;

      // Move issue to next sprint with carryover tracking
      // Build belongs_to array preserving program, updating sprint
      const belongs_to = [
        { id: programId, type: 'program' as const },
        { id: resolvedTargetSprintId, type: 'sprint' as const },
      ];
      const response = await apiPatch(`/api/issues/${issue.id}`, {
        belongs_to,
        carryover_from_sprint_id: sprintId,
      });

      if (!response.ok) {
        throw new Error('Failed to move issue to next week');
      }

      return { issue, targetSprintId: resolvedTargetSprintId };
    },
    onSuccess: ({ issue }) => {
      queryClient.invalidateQueries({ queryKey: ['sprint-issues', sprintId] });
      queryClient.invalidateQueries({ queryKey: ['next-sprint', programId, sprintNumber] });

      onDecisionMade?.({
        issue_id: issue.id,
        issue_title: issue.title,
        display_id: issue.display_id,
        action: 'next_sprint',
        timestamp: new Date().toISOString(),
      });

      setPendingAction(null);
    },
  });

  // Mutation to return issue to backlog
  const moveToBacklogMutation = useMutation({
    mutationFn: async (issue: Issue) => {
      // Remove sprint association while keeping program
      const belongs_to = [{ id: programId, type: 'program' }];
      const response = await apiPatch(`/api/issues/${issue.id}`, {
        belongs_to,
      });

      if (!response.ok) {
        throw new Error('Failed to move issue to backlog');
      }

      return issue;
    },
    onSuccess: (issue) => {
      queryClient.invalidateQueries({ queryKey: ['sprint-issues', sprintId] });

      onDecisionMade?.({
        issue_id: issue.id,
        issue_title: issue.title,
        display_id: issue.display_id,
        action: 'backlog',
        timestamp: new Date().toISOString(),
      });

      setPendingAction(null);
    },
  });

  // Mutation to close issue (done or cancelled)
  const closeIssueMutation = useMutation({
    mutationFn: async ({ issue, state }: { issue: Issue; state: 'done' | 'cancelled' }) => {
      const response = await apiPatch(`/api/issues/${issue.id}`, {
        state,
      });

      if (!response.ok) {
        throw new Error('Failed to close issue');
      }

      return { issue, state };
    },
    onSuccess: ({ issue, state }) => {
      queryClient.invalidateQueries({ queryKey: ['sprint-issues', sprintId] });

      onDecisionMade?.({
        issue_id: issue.id,
        issue_title: issue.title,
        display_id: issue.display_id,
        action: state === 'done' ? 'close_done' : 'close_cancelled',
        timestamp: new Date().toISOString(),
      });

      setPendingAction(null);
    },
  });

  // Bulk mutation to move all incomplete issues to backlog
  const moveAllToBacklogMutation = useMutation({
    mutationFn: async (issues: Issue[]) => {
      const results = await Promise.all(
        issues.map(async (issue) => {
          const belongs_to = [{ id: programId, type: 'program' }];
          const response = await apiPatch(`/api/issues/${issue.id}`, {
            belongs_to,
          });
          if (!response.ok) {
            throw new Error(`Failed to move issue ${issue.display_id} to backlog`);
          }
          return issue;
        })
      );
      return results;
    },
    onSuccess: (movedIssues) => {
      queryClient.invalidateQueries({ queryKey: ['sprint-issues', sprintId] });

      movedIssues.forEach(issue => {
        onDecisionMade?.({
          issue_id: issue.id,
          issue_title: issue.title,
          display_id: issue.display_id,
          action: 'backlog',
          timestamp: new Date().toISOString(),
        });
      });

      setBulkPending(false);
    },
    onError: () => {
      setBulkPending(false);
    },
  });

  const handleMoveAllToBacklog = useCallback(() => {
    setBulkPending(true);
    moveAllToBacklogMutation.mutate(incompleteIssues);
  }, [moveAllToBacklogMutation, incompleteIssues]);

  const handleNextSprint = useCallback((issue: Issue) => {
    setPendingAction(issue.id);
    moveToNextSprintMutation.mutate(issue);
  }, [moveToNextSprintMutation]);

  const handleBacklog = useCallback((issue: Issue) => {
    setPendingAction(issue.id);
    moveToBacklogMutation.mutate(issue);
  }, [moveToBacklogMutation]);

  const handleClose = useCallback((issue: Issue, state: 'done' | 'cancelled') => {
    setPendingAction(issue.id);
    closeIssueMutation.mutate({ issue, state });
  }, [closeIssueMutation]);

  if (isLoading) {
    return (
      <div className="p-4 text-center text-muted">
        Loading issues...
      </div>
    );
  }

  // If no incomplete issues, show success message
  if (incompleteIssues.length === 0) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium text-green-600">All issues completed!</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          All issues in this sprint have been completed or cancelled.
        </p>
      </div>
    );
  }

  // If dismissed, don't show anything
  if (dismissed) {
    return null;
  }

  // Soft prompt with collapse/expand functionality
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
          {/* Quick actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleMoveAllToBacklog}
              disabled={bulkPending}
              className="rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {bulkPending ? 'Moving...' : 'Move all to backlog'}
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
            >
              {expanded ? 'Collapse' : 'Review individually'}
            </button>
            <button
              onClick={() => setDismissed(true)}
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

      {/* Expanded issue list */}
      {expanded && (
        <div className="space-y-2">
          {incompleteIssues.map(issue => {
            const isPending = pendingAction === issue.id;

            return (
              <div
                key={issue.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
              >
                {/* Issue info */}
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

                {/* Action buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleNextSprint(issue)}
                    disabled={isPending || bulkPending}
                    className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    title="Move to next week"
                  >
                    {isPending && moveToNextSprintMutation.isPending ? '...' : 'Next Week'}
                  </button>
                  <button
                    onClick={() => handleBacklog(issue)}
                    disabled={isPending || bulkPending}
                    className="rounded-md bg-gray-600 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                    title="Return to backlog"
                  >
                    {isPending && moveToBacklogMutation.isPending ? '...' : 'Backlog'}
                  </button>
                  <button
                    onClick={() => handleClose(issue, 'done')}
                    disabled={isPending || bulkPending}
                    className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                    title="Mark as done"
                  >
                    {isPending && closeIssueMutation.isPending ? '...' : 'Done'}
                  </button>
                  <button
                    onClick={() => handleClose(issue, 'cancelled')}
                    disabled={isPending || bulkPending}
                    className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                    title="Cancel issue"
                  >
                    {isPending && closeIssueMutation.isPending ? '...' : 'Cancel'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
