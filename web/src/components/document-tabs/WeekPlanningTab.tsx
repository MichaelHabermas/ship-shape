import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IssuesList, DEFAULT_FILTER_TABS } from '@/components/IssuesList';
import { apiPost } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { DocumentTabProps } from '@/lib/document-tabs';
import { getDocumentProgramId } from '@/lib/document-view-mapper';
import { getRecord } from '@/lib/document-view-guards';

/**
 * SprintPlanningTab - Sprint planning view
 *
 * This tab shows the sprint planning interface where issues can be
 * assigned to the sprint. Extracted from SprintPlanningPage.
 *
 * Features:
 * - Shows issues from the sprint's program with filter tabs
 * - Start Sprint button for planning → active transition
 * - Checkbox selection for bulk sprint assignment
 * - Inline sprint assignment dropdown
 * - New issues inherit the sprint context
 */
export default function SprintPlanningTab({ documentId, document }: DocumentTabProps) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [isStarting, setIsStarting] = useState(false);

  const programId = getDocumentProgramId(document) ?? undefined;
  // Sprint status is stored in properties.status
  const properties = getRecord(document.properties);
  const status = properties?.status || 'planning';
  const issueCount = typeof properties?.issue_count === 'number' ? properties.issue_count : 0;

  // Start sprint mutation
  const startSprintMutation = useMutation({
    mutationFn: async () => {
      const response = await apiPost(`/api/weeks/${documentId}/start`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to start week');
      }
      return response.json();
    },
    onSuccess: (data) => {
      const count = data.snapshot_issue_count ?? 0;
      showToast(`Week started with ${count} issue${count === 1 ? '' : 's'}`, 'success');
      // Invalidate queries to refresh document data
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
    },
    onError: (error: Error) => {
      showToast(error.message, 'error');
    },
  });

  // Handle start sprint
  const handleStartSprint = useCallback(async () => {
    setIsStarting(true);
    try {
      await startSprintMutation.mutateAsync();
    } finally {
      setIsStarting(false);
    }
  }, [startSprintMutation]);

  return (
    <div className="flex h-full flex-col">
      {/* Header with status and action */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={status as 'planning' | 'active' | 'completed'} />
          {issueCount > 0 && (
            <span className="text-xs text-muted">
              {issueCount} issue{issueCount === 1 ? '' : 's'} scoped
            </span>
          )}
        </div>
        {status === 'planning' && (
          <button
            onClick={handleStartSprint}
            disabled={isStarting}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isStarting ? 'Starting...' : 'Start Week'}
          </button>
        )}
      </div>

      {/* Issues list */}
      <div className="flex-1 overflow-hidden">
        <IssuesList
          // Lock to sprint context - shows only issues in this sprint by default
          lockedSprintId={documentId}
          // Lock program context for sprint selector dropdown
          lockedProgramId={programId}
          // Inherit context for new issues - auto-assign to this sprint and program
          inheritedContext={{
            programId,
            sprintId: documentId,
          }}
          // UI configuration
          filterTabs={DEFAULT_FILTER_TABS}
          initialStateFilter=""
          showProgramFilter={false}
          showProjectFilter={true}
          showSprintFilter={false}
          showCreateButton={true}
          showBacklogPicker={true}
          createButtonLabel="New Issue"
          viewModes={['list', 'kanban']}
          initialViewMode="list"
          storageKeyPrefix={`sprint-planning-${documentId}`}
          selectionPersistenceKey={`sprint-planning-${documentId}`}
          enableKeyboardNavigation={true}
          enableInlineSprintAssignment={true}
          allowShowAllIssues={true}
          emptyState={
            <div className="text-center py-12">
              <svg className="h-12 w-12 mx-auto mb-4 text-muted opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm font-medium text-muted">No issues in this week yet</p>
              <p className="text-xs text-muted mt-1">Use "Show All" to find issues to add</p>
            </div>
          }
        />
      </div>
    </div>
  );
}

// Status badge component
function StatusBadge({ status }: { status: 'planning' | 'active' | 'completed' }) {
  const statusConfig = {
    planning: { label: 'Planning', className: 'bg-blue-500/20 text-blue-400' },
    active: { label: 'Active', className: 'bg-green-500/20 text-green-400' },
    completed: { label: 'Completed', className: 'bg-gray-500/20 text-gray-400' },
  };

  const config = statusConfig[status];

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', config.className)}>
      {config.label}
    </span>
  );
}
