import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch, apiPost, readJson } from '@/lib/api';
import type { Sprint as WeekSprint } from '@/hooks/useWeeksQuery';
import type { ProgramSprintsResponse } from '@/api/schemas';
import { WeekReconciliationPrompt } from '@/components/WeekReconciliationPrompt';

export interface Issue {
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
    <WeekReconciliationPrompt
      incompleteIssues={incompleteIssues}
      expanded={expanded}
      bulkPending={bulkPending}
      pendingAction={pendingAction}
      moveToNextSprintPending={moveToNextSprintMutation.isPending}
      moveToBacklogPending={moveToBacklogMutation.isPending}
      closeIssuePending={closeIssueMutation.isPending}
      onMoveAllToBacklog={handleMoveAllToBacklog}
      onToggleExpanded={() => setExpanded(!expanded)}
      onDismiss={() => setDismissed(true)}
      onNextSprint={handleNextSprint}
      onBacklog={handleBacklog}
      onClose={handleClose}
    />
  );
}
