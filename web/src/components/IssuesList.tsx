// IssuesList renders filtered issue work queues and publishes bounded FleetGraph page context.
import { useEffect, useMemo, useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BulkActionBar } from '@/components/BulkActionBar';
import type { IssueListItem } from '@/contexts/IssuesContext';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { buildIssuesListPageContext } from '@/fleetgraph/page-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { useProjectsQuery } from '@/hooks/useProjectsQuery';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useListFilters } from '@/hooks/useListFilters';
import { useGlobalListNavigation } from '@/hooks/useGlobalListNavigation';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { FilterTabs } from '@/components/FilterTabs';
import { ConversionDialog } from '@/components/dialogs/ConversionDialog';
import { BacklogPickerModal } from '@/components/dialogs/BacklogPickerModal';
import { ALL_COLUMNS, DEFAULT_FILTER_TABS, SORT_OPTIONS } from '@/components/issues/issues-list-constants';
import { IssuesTableView } from '@/components/issues/IssuesTableView';
import { IssuesKanbanView } from '@/components/issues/IssuesKanbanView';
import { IssuesListContextMenu } from '@/components/issues/IssuesListContextMenu';
import { IssuesListFilterCombobox, IssuesListHeader } from '@/components/issues/IssuesListHeader';
import { useIssuesListFilters } from '@/hooks/useIssuesListFilters';
import { useIssuesBulkActions } from '@/hooks/useIssuesBulkActions';
import { useFleetGraphPageContextRegistration } from '@/contexts/FleetGraphPageContext';
import type { IssuesListProps } from '@/components/issues/issues-list-props';
import { useIssuesListData } from '@/hooks/useIssuesListData';
import { useIssuesListActions } from '@/hooks/useIssuesListActions';
import { useIssuesListSelection } from '@/hooks/useIssuesListSelection';

export type { IssueListItem, Issue } from '@/contexts/IssuesContext';
export type { IssuesListProps } from '@/components/issues/issues-list-props';
export { StatusBadge, PriorityBadge } from '@/components/issues/issue-badges';
export { ALL_COLUMNS, DEFAULT_FILTER_TABS, SORT_OPTIONS } from '@/components/issues/issues-list-constants';

export function IssuesList({
  issues: issuesProp,
  loading: loadingProp = false,
  onUpdateIssue,
  onCreateIssue,
  onRefreshIssues,
  storageKeyPrefix = 'issues-list',
  filterTabs = DEFAULT_FILTER_TABS,
  initialStateFilter = '',
  onStateFilterChange,
  urlParamPrefix,
  showProgramFilter = false,
  showProjectFilter = true,
  showSprintFilter = true,
  lockedProgramId,
  lockedProjectId,
  lockedSprintId,
  inheritedContext,
  showCreateButton = true,
  createButtonLabel = 'New Issue',
  createButtonTestId,
  viewModes = ['list', 'kanban'],
  initialViewMode = 'list',
  defaultColumns,
  enableKeyboardNavigation = true,
  emptyState,
  showPromoteToProject = true,
  className,
  headerContent,
  hideHeader = false,
  toolbarContent,
  selectionPersistenceKey,
  enableInlineSprintAssignment = false,
  showBacklogPicker = false,
  allowShowAllIssues = false,
}: IssuesListProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: teamMembers = [] } = useAssignableMembersQuery();
  const { data: projects = [] } = useProjectsQuery();
  const queryClient = useQueryClient();

  const {
    issues,
    loading,
    shouldSelfFetch,
    showAllIssues,
    setShowAllIssues,
    effectiveContext,
    buildBelongsTo,
    inContextIds,
    availableSprints,
  } = useIssuesListData({
    issuesProp,
    loadingProp,
    lockedProgramId,
    lockedProjectId,
    lockedSprintId,
    inheritedContext,
    allowShowAllIssues,
  });

  const {
    canCreateIssue,
    handleCreateIssue,
    handleAddIssueToContext,
    handleUpdateIssue,
    handlePromoteToProject,
    executeConversion,
    convertingIssue,
    isConverting,
    setConvertingIssue,
  } = useIssuesListActions({
    shouldSelfFetch,
    buildBelongsTo,
    effectiveContext,
    onCreateIssue,
    onUpdateIssue,
  });

  const { sortBy, setSortBy, viewMode, setViewMode } = useListFilters({
    sortOptions: SORT_OPTIONS,
    defaultSort: 'updated',
    defaultViewMode: initialViewMode,
  });

  const { visibleColumns, columns, hiddenCount, toggleColumn } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: `${storageKeyPrefix}-column-visibility`,
    defaultVisible: defaultColumns,
  });

  const {
    stateFilter,
    programFilter,
    setProgramFilter,
    projectFilter,
    setProjectFilter,
    sprintFilter,
    setSprintFilter,
    programOptions,
    projectOptions,
    sprintOptions,
    filteredIssues,
    handleFilterChange,
    stateFilterChanged,
  } = useIssuesListFilters({
    issues,
    initialStateFilter,
    onStateFilterChange,
    urlParamPrefix,
  });

  const [isBacklogPickerOpen, setIsBacklogPickerOpen] = useState(false);

  const {
    selectedIds,
    selectionRef,
    contextMenu,
    clearSelection,
    handleSelectionChange,
    handleKanbanCheckboxClick,
    handleKanbanContextMenu,
    handleContextMenu,
    closeContextMenu,
    setContextMenu,
  } = useIssuesListSelection({
    selectionPersistenceKey,
    stateFilterChanged,
  });

  const scopedIssuesList = Boolean(lockedProjectId || lockedProgramId || lockedSprintId);
  const fleetGraphPageContext = useMemo(() => buildIssuesListPageContext({
    location,
    scoped: scopedIssuesList,
    stateFilter,
    programFilter,
    projectFilter,
    sprintFilter,
    effectiveProgramId: effectiveContext.programId,
    effectiveProjectId: effectiveContext.projectId,
    showAllIssues,
    sortBy,
    viewMode,
    totalCount: issues.length,
    filteredCount: filteredIssues.length,
    selectedCount: selectedIds.size,
    visibleIssues: filteredIssues,
    selectedIds,
  }), [
    effectiveContext.programId,
    effectiveContext.projectId,
    filteredIssues,
    issues.length,
    location,
    programFilter,
    projectFilter,
    scopedIssuesList,
    selectedIds,
    showAllIssues,
    sortBy,
    sprintFilter,
    stateFilter,
    viewMode,
  ]);

  useFleetGraphPageContextRegistration(fleetGraphPageContext);

  const {
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
  } = useIssuesBulkActions({
    issues,
    selectedIds,
    clearSelection,
    onRefreshIssues,
    lockedSprintId,
    lockedProjectId,
    availableSprints,
    teamMembers,
    projects,
  });

  const handlePromoteWithMenuClose = useCallback((issue: IssueListItem) => {
    handlePromoteToProject(issue);
    setContextMenu(null);
  }, [handlePromoteToProject, setContextMenu]);

  useGlobalListNavigation({
    selection: selectionRef.current,
    selectionRef,
    enabled: enableKeyboardNavigation && viewMode === 'list',
    onEnter: useCallback((focusedId: string) => {
      navigate(`/documents/${focusedId}`);
    }, [navigate]),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey && undoStateRef.current) {
        e.preventDefault();
        executeUndo();
        return;
      }
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && canCreateIssue) {
        e.preventDefault();
        void handleCreateIssue();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCreateIssue, canCreateIssue, executeUndo, undoStateRef]);

  const defaultEmptyState = useMemo(() => (
    <div className="text-center">
      <p className="text-muted">No issues found</p>
      {canCreateIssue && (
        <button
          onClick={() => void handleCreateIssue()}
          className="mt-2 text-sm text-accent hover:underline"
        >
          Create an issue
        </button>
      )}
    </div>
  ), [handleCreateIssue, canCreateIssue]);

  if (loading) {
    return <IssuesListSkeleton />;
  }

  const programFilterContent = showProgramFilter && !lockedProgramId ? (
    <IssuesListFilterCombobox
      storageKeyPrefix={storageKeyPrefix}
      suffix="program"
      options={programOptions}
      value={programFilter}
      onChange={setProgramFilter}
      placeholder="All Programs"
      ariaLabel="Filter issues by program"
    />
  ) : null;

  const projectFilterContent = showProjectFilter && !lockedProjectId ? (
    <IssuesListFilterCombobox
      storageKeyPrefix={storageKeyPrefix}
      suffix="project"
      options={projectOptions}
      value={projectFilter}
      onChange={setProjectFilter}
      placeholder="All Projects"
      ariaLabel="Filter issues by project"
    />
  ) : null;

  const sprintFilterContent = showSprintFilter && !lockedSprintId ? (
    <IssuesListFilterCombobox
      storageKeyPrefix={storageKeyPrefix}
      suffix="sprint"
      options={sprintOptions}
      value={sprintFilter}
      onChange={setSprintFilter}
      placeholder="All Weeks"
      ariaLabel="Filter issues by week"
    />
  ) : null;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {!hideHeader && (
        <IssuesListHeader
          headerContent={headerContent}
          sortBy={sortBy}
          onSortChange={setSortBy}
          viewModes={viewModes}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          hiddenCount={hiddenCount}
          programFilterContent={programFilterContent}
          projectFilterContent={projectFilterContent}
          sprintFilterContent={sprintFilterContent}
          toolbarContent={toolbarContent}
          showBacklogPicker={showBacklogPicker}
          canShowBacklogPicker={Boolean(effectiveContext.sprintId || effectiveContext.projectId || effectiveContext.programId)}
          onOpenBacklogPicker={() => setIsBacklogPickerOpen(true)}
          allowShowAllIssues={allowShowAllIssues}
          shouldSelfFetch={shouldSelfFetch}
          showAllIssues={showAllIssues}
          onToggleShowAllIssues={() => setShowAllIssues(prev => !prev)}
          showCreateButton={showCreateButton}
          canCreateIssue={canCreateIssue}
          onCreateIssue={() => void handleCreateIssue()}
          createButtonLabel={createButtonLabel}
          createButtonTestId={createButtonTestId}
        />
      )}

      {selectedIds.size > 0 ? (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onChangeStatus={handleBulkChangeStatus}
          onMoveToSprint={handleBulkMoveToSprint}
          onAssign={handleBulkAssign}
          onAssignProject={handleBulkAssignProject}
          sprints={availableSprints}
          teamMembers={teamMembers}
          projects={projects}
          loading={bulkUpdate.isPending}
        />
      ) : filterTabs ? (
        <FilterTabs
          tabs={filterTabs}
          activeId={stateFilter}
          onChange={handleFilterChange}
          ariaLabel="Issue filters"
        />
      ) : null}

      {viewMode === 'kanban' ? (
        <IssuesKanbanView
          issues={filteredIssues}
          selectedIds={selectedIds}
          onUpdateIssue={handleUpdateIssue}
          onIssueClick={(id) => navigate(`/documents/${id}`)}
          onCheckboxClick={handleKanbanCheckboxClick}
          onContextMenu={handleKanbanContextMenu}
        />
      ) : (
        <IssuesTableView
          issues={filteredIssues}
          columns={columns}
          visibleColumns={visibleColumns}
          emptyState={emptyState || defaultEmptyState}
          initialSelectedIds={selectedIds}
          onItemClick={(issue) => navigate(`/documents/${issue.id}`)}
          onSelectionChange={handleSelectionChange}
          onContextMenu={handleContextMenu}
          enableInlineSprintAssignment={enableInlineSprintAssignment}
          availableSprints={availableSprints}
          onInlineSprintChange={handleInlineSprintChange}
          allowShowAllIssues={allowShowAllIssues}
          showAllIssues={showAllIssues}
          inContextIds={inContextIds}
          onAddIssueToContext={handleAddIssueToContext}
        />
      )}

      {contextMenu && (
        <IssuesListContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selection={contextMenu.selection}
          filteredIssues={filteredIssues}
          showPromoteToProject={showPromoteToProject}
          onClose={closeContextMenu}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onChangeStatus={handleBulkChangeStatus}
          onMoveToSprint={handleBulkMoveToSprint}
          onPromoteToProject={handlePromoteWithMenuClose}
        />
      )}

      {convertingIssue && (
        <ConversionDialog
          isOpen={!!convertingIssue}
          onClose={() => setConvertingIssue(null)}
          onConvert={executeConversion}
          sourceType="issue"
          title={convertingIssue.title}
          isConverting={isConverting}
        />
      )}

      {showBacklogPicker && (
        <BacklogPickerModal
          isOpen={isBacklogPickerOpen}
          onClose={() => setIsBacklogPickerOpen(false)}
          context={{
            sprintId: effectiveContext.sprintId,
            projectId: effectiveContext.projectId,
            programId: effectiveContext.programId,
          }}
          onIssuesAdded={() => {
            queryClient.invalidateQueries({ queryKey: issueKeys.all });
            if (effectiveContext.sprintId) {
              queryClient.invalidateQueries({ queryKey: issueKeys.list({ sprintId: effectiveContext.sprintId }) });
            }
            if (effectiveContext.projectId) {
              queryClient.invalidateQueries({ queryKey: issueKeys.list({ projectId: effectiveContext.projectId }) });
            }
          }}
        />
      )}
    </div>
  );
}
