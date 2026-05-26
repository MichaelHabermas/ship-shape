// WeekIssuesTab shows active/completed week issues and contextual FleetGraph findings.
import { IssuesList, DEFAULT_FILTER_TABS } from '@/components/IssuesList';
import { FleetGraphWeekSurface } from '@/components/fleetgraph/FleetGraphWeekSurface';
import type { DocumentTabProps } from '@/lib/document-tabs';
import { getDocumentProgramId } from '@/lib/document-view-mapper';

/**
 * SprintIssuesTab - Issues view for active/completed sprints
 *
 * This tab shows issues assigned to the sprint during the active and completed phases.
 * Unlike SprintPlanningTab (which shows all program issues for scoping),
 * this tab is filtered to show only issues in this sprint.
 *
 * Used when sprint status is 'active' or 'completed'.
 */
export default function SprintIssuesTab({ documentId, document }: DocumentTabProps) {
  const programId = getDocumentProgramId(document) ?? undefined;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto pb-20">
      <FleetGraphWeekSurface sprintId={documentId} />
      <IssuesList
        // Lock to this sprint - shows only issues assigned to this sprint
        lockedSprintId={documentId}
        // Also show program context for filtering
        lockedProgramId={programId}
        // Inherit context for new issues - auto-assign to this sprint
        inheritedContext={{
          programId,
          sprintId: documentId,
        }}
        // UI configuration
        filterTabs={DEFAULT_FILTER_TABS}
        initialStateFilter=""
        showProgramFilter={false}
        showProjectFilter={true}
        showSprintFilter={false} // Already locked to this sprint
        showCreateButton={true}
        showBacklogPicker={true}
        createButtonLabel="New Issue"
        viewModes={['list', 'kanban']}
        initialViewMode="kanban" // Kanban is better for active sprint tracking
        storageKeyPrefix={`sprint-issues-${documentId}`}
        selectionPersistenceKey={`sprint-issues-${documentId}`}
        enableKeyboardNavigation={true}
        allowShowAllIssues={true}
        emptyState={
          <div className="text-center py-12">
            <svg className="h-12 w-12 mx-auto mb-4 text-muted opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm font-medium text-muted">No issues in this week</p>
            <p className="text-xs text-muted mt-1">Issues assigned to this week will appear here</p>
          </div>
        }
      />
    </div>
  );
}
