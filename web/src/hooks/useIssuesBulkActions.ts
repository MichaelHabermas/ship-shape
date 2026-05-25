import { useCallback, useEffect, useRef } from 'react';
import type { IssueListItem } from '@/api/schemas';
import type { IssueState } from '@ship/shared';
import { useBulkUpdateIssues, getProjectId, getSprintId } from '@/hooks/useIssuesQuery';
import { useToast } from '@/components/ui/Toast';
import { STATE_LABELS } from '@/components/issues/issues-list-constants';

interface UndoState {
  action: 'status' | 'sprint' | 'assign' | 'project';
  ids: string[];
  previousValues: Map<string, {
    state?: string;
    sprint_id?: string | null;
    assignee_id?: string | null;
    project_id?: string | null;
  }>;
  timestamp: number;
}

export interface UseIssuesBulkActionsInput {
  issues: IssueListItem[];
  selectedIds: Set<string>;
  clearSelection: () => void;
  onRefreshIssues?: () => Promise<void>;
  lockedSprintId?: string;
  lockedProjectId?: string;
  availableSprints: { id: string; name: string }[];
  teamMembers: { id: string; name: string; user_id?: string | null }[];
  projects: { id: string; title: string }[];
}

export function useIssuesBulkActions({
  issues,
  selectedIds,
  clearSelection,
  onRefreshIssues,
  lockedSprintId,
  lockedProjectId,
  availableSprints,
  teamMembers,
  projects,
}: UseIssuesBulkActionsInput) {
  const bulkUpdate = useBulkUpdateIssues();
  const { showToast } = useToast();
  const undoStateRef = useRef<UndoState | null>(null);
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearUndoState = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    undoStateRef.current = null;
  }, []);

  const setUndoWithTimeout = useCallback((state: UndoState) => {
    clearUndoState();
    undoStateRef.current = state;
    undoTimeoutRef.current = setTimeout(() => {
      undoStateRef.current = null;
    }, 30000);
  }, [clearUndoState]);

  const executeUndo = useCallback(() => {
    const undoState = undoStateRef.current;
    if (!undoState) return;

    const { action, ids, previousValues } = undoState;
    const updatesByValue = new Map<string, string[]>();

    ids.forEach(id => {
      const prev = previousValues.get(id);
      if (!prev) return;

      let key: string;
      switch (action) {
        case 'status':
          key = `state:${prev.state}`;
          break;
        case 'sprint':
          key = `sprint:${prev.sprint_id ?? 'null'}`;
          break;
        case 'assign':
          key = `assignee:${prev.assignee_id ?? 'null'}`;
          break;
        case 'project':
          key = `project:${prev.project_id ?? 'null'}`;
          break;
        default:
          return;
      }
      const existing = updatesByValue.get(key) || [];
      existing.push(id);
      updatesByValue.set(key, existing);
    });

    updatesByValue.forEach((issueIds, key) => {
      const [type, value] = key.split(':');
      const actualValue = value === 'null' ? null : value;

      switch (type) {
        case 'state':
          bulkUpdate.mutate({ ids: issueIds, action: 'update', updates: { state: actualValue as IssueState } });
          break;
        case 'sprint':
          bulkUpdate.mutate({ ids: issueIds, action: 'update', updates: { sprint_id: actualValue } });
          break;
        case 'assignee':
          bulkUpdate.mutate({ ids: issueIds, action: 'update', updates: { assignee_id: actualValue } });
          break;
        case 'project':
          bulkUpdate.mutate({ ids: issueIds, action: 'update', updates: { project_id: actualValue } });
          break;
      }
    });

    showToast('Changes undone', 'info');
    clearUndoState();
  }, [bulkUpdate, showToast, clearUndoState]);

  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    };
  }, []);

  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;

    bulkUpdate.mutate({ ids, action: 'archive' }, {
      onSuccess: () => {
        showToast(
          `${count} issue${count === 1 ? '' : 's'} archived`,
          'success',
          5000,
          {
            label: 'Undo',
            onClick: () => {
              bulkUpdate.mutate({ ids, action: 'restore' }, {
                onSuccess: () => {
                  showToast('Archive undone', 'info');
                  void onRefreshIssues?.();
                },
              });
            },
          }
        );
      },
      onError: () => showToast('Failed to archive issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, bulkUpdate, showToast, clearSelection, onRefreshIssues]);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;

    bulkUpdate.mutate({ ids, action: 'delete' }, {
      onSuccess: () => {
        showToast(
          `${count} issue${count === 1 ? '' : 's'} deleted`,
          'success',
          5000,
          {
            label: 'Undo',
            onClick: () => {
              bulkUpdate.mutate({ ids, action: 'restore' }, {
                onSuccess: () => {
                  showToast('Delete undone', 'info');
                  void onRefreshIssues?.();
                },
                onError: () => showToast('Failed to undo delete', 'error'),
              });
            },
          }
        );
      },
      onError: () => showToast('Failed to delete issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, bulkUpdate, showToast, clearSelection, onRefreshIssues]);

  const handleBulkMoveToSprint = useCallback((sprintId: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const movingOutOfView = lockedSprintId && sprintId !== lockedSprintId;

    const previousValues = new Map<string, { sprint_id: string | null }>();
    ids.forEach(id => {
      const issue = issues.find(i => i.id === id);
      if (issue) {
        previousValues.set(id, { sprint_id: getSprintId(issue) ?? null });
      }
    });

    bulkUpdate.mutate({ ids, action: 'update', updates: { sprint_id: sprintId } }, {
      onSuccess: () => {
        setUndoWithTimeout({ action: 'sprint', ids, previousValues, timestamp: Date.now() });
        const sprintName = sprintId
          ? availableSprints.find(s => s.id === sprintId)?.name || 'week'
          : 'No Week';
        const message = movingOutOfView
          ? `${count} issue${count === 1 ? '' : 's'} moved out of this view`
          : `${count} issue${count === 1 ? '' : 's'} assigned to ${sprintName}`;
        showToast(message, movingOutOfView ? 'info' : 'success', 5000, {
          label: 'Undo',
          onClick: executeUndo,
        });
      },
      onError: () => showToast('Failed to move issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, issues, bulkUpdate, showToast, clearSelection, lockedSprintId, setUndoWithTimeout, executeUndo, availableSprints]);

  const handleBulkChangeStatus = useCallback((status: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const statusLabel = STATE_LABELS[status] || status;

    const previousValues = new Map<string, { state: string }>();
    ids.forEach(id => {
      const issue = issues.find(i => i.id === id);
      if (issue) {
        previousValues.set(id, { state: issue.state });
      }
    });

    bulkUpdate.mutate({ ids, action: 'update', updates: { state: status as IssueState } }, {
      onSuccess: () => {
        setUndoWithTimeout({ action: 'status', ids, previousValues, timestamp: Date.now() });
        showToast(`${count} issue${count === 1 ? '' : 's'} changed to ${statusLabel}`, 'success', 5000, {
          label: 'Undo',
          onClick: executeUndo,
        });
      },
      onError: () => showToast('Failed to update issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, issues, bulkUpdate, showToast, clearSelection, setUndoWithTimeout, executeUndo]);

  const handleBulkAssign = useCallback((assigneeId: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const teamMember = assigneeId ? teamMembers.find(m => m.id === assigneeId) : null;
    const assigneeName = teamMember?.name || 'Unassigned';
    const userId = teamMember?.user_id || null;

    const previousValues = new Map<string, { assignee_id: string | null }>();
    ids.forEach(id => {
      const issue = issues.find(i => i.id === id);
      if (issue) {
        previousValues.set(id, { assignee_id: issue.assignee_id ?? null });
      }
    });

    bulkUpdate.mutate({ ids, action: 'update', updates: { assignee_id: userId } }, {
      onSuccess: () => {
        setUndoWithTimeout({ action: 'assign', ids, previousValues, timestamp: Date.now() });
        showToast(`${count} issue${count === 1 ? '' : 's'} assigned to ${assigneeName}`, 'success', 5000, {
          label: 'Undo',
          onClick: executeUndo,
        });
      },
      onError: () => showToast('Failed to assign issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, issues, teamMembers, bulkUpdate, showToast, clearSelection, setUndoWithTimeout, executeUndo]);

  const handleBulkAssignProject = useCallback((projectId: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const project = projectId ? projects.find(p => p.id === projectId) : null;
    const projectName = project?.title || 'No Project';
    const movingOutOfView = lockedProjectId && projectId !== lockedProjectId;

    const previousValues = new Map<string, { project_id: string | null }>();
    ids.forEach(id => {
      const issue = issues.find(i => i.id === id);
      if (issue) {
        previousValues.set(id, { project_id: getProjectId(issue) ?? null });
      }
    });

    bulkUpdate.mutate({ ids, action: 'update', updates: { project_id: projectId } }, {
      onSuccess: () => {
        setUndoWithTimeout({ action: 'project', ids, previousValues, timestamp: Date.now() });
        const message = movingOutOfView
          ? `${count} issue${count === 1 ? '' : 's'} moved out of this view`
          : `${count} issue${count === 1 ? '' : 's'} assigned to ${projectName}`;
        showToast(message, movingOutOfView ? 'info' : 'success', 5000, {
          label: 'Undo',
          onClick: executeUndo,
        });
      },
      onError: () => showToast('Failed to assign issues to project', 'error'),
    });
    clearSelection();
  }, [selectedIds, issues, projects, bulkUpdate, showToast, clearSelection, lockedProjectId, setUndoWithTimeout, executeUndo]);

  const handleInlineSprintChange = useCallback((issueId: string, sprintId: string | null) => {
    bulkUpdate.mutate(
      { ids: [issueId], action: 'update', updates: { sprint_id: sprintId } },
      {
        onSuccess: () => {
          const sprintName = sprintId
            ? availableSprints.find(s => s.id === sprintId)?.name || 'week'
            : 'No Week';
          showToast(`Issue moved to ${sprintName}`, 'success');
        },
        onError: () => showToast('Failed to update week', 'error'),
      }
    );
  }, [bulkUpdate, availableSprints, showToast]);

  return {
    bulkUpdate,
    executeUndo,
    undoStateRef,
    handleBulkArchive,
    handleBulkDelete,
    handleBulkMoveToSprint,
    handleBulkChangeStatus,
    handleBulkAssign,
    handleBulkAssignProject,
    handleInlineSprintChange,
  };
}
