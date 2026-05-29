import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BulkActionBar } from '@/components/BulkActionBar';
import type { Issue, IssueListItem } from '@/contexts/IssuesContext';
import {
  useCreateIssue,
  useIssuesQuery,
  useUpdateIssue,
  issueKeys,
} from '@/hooks/useIssuesQuery';
import type { BelongsTo, IssueState } from '@ship/shared';
import { projectKeys, useProjectsQuery } from '@/hooks/useProjectsQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { useSprintsQuery } from '@/hooks/useWeeksQuery';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useListFilters, type ViewMode } from '@/hooks/useListFilters';
import { useGlobalListNavigation } from '@/hooks/useGlobalListNavigation';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { FilterTabs, type FilterTab } from '@/components/FilterTabs';
import { apiPost, readJson } from '@/lib/api';
import type { LegacyErrorResponse } from '@/api/schemas';
import { ConversionDialog } from '@/components/dialogs/ConversionDialog';
import { BacklogPickerModal } from '@/components/dialogs/BacklogPickerModal';
import { useSelectionPersistenceOptional } from '@/contexts/SelectionPersistenceContext';
import type { UseSelectionReturn } from '@/components/SelectableList';
import { ALL_COLUMNS, DEFAULT_FILTER_TABS, SORT_OPTIONS } from '@/components/issues/issues-list-constants';
import { IssuesTableView } from '@/components/issues/IssuesTableView';
import { IssuesKanbanView } from '@/components/issues/IssuesKanbanView';
import { IssuesListContextMenu } from '@/components/issues/IssuesListContextMenu';
import { IssuesListFilterCombobox, IssuesListHeader } from '@/components/issues/IssuesListHeader';
import { useIssuesListFilters } from '@/hooks/useIssuesListFilters';
import { useIssuesBulkActions } from '@/hooks/useIssuesBulkActions';

export type { IssueListItem, Issue } from '@/contexts/IssuesContext';
export { StatusBadge, PriorityBadge } from '@/components/issues/issue-badges';
export { ALL_COLUMNS, DEFAULT_FILTER_TABS, SORT_OPTIONS } from '@/components/issues/issues-list-constants';

export interface IssuesListProps {
  issues?: IssueListItem[];
  loading?: boolean;
  onUpdateIssue?: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
  onCreateIssue?: () => Promise<Issue | null>;
  onRefreshIssues?: () => Promise<void>;
  storageKeyPrefix?: string;
  filterTabs?: FilterTab[] | null;
  initialStateFilter?: string;
  onStateFilterChange?: (filter: string) => void;
  urlParamPrefix?: string;
  showProgramFilter?: boolean;
  showProjectFilter?: boolean;
  showSprintFilter?: boolean;
  lockedProgramId?: string;
  lockedProjectId?: string;
  lockedSprintId?: string;
  inheritedContext?: {
    programId?: string;
    projectId?: string;
    sprintId?: string;
    assigneeId?: string;
  };
  showCreateButton?: boolean;
  createButtonLabel?: string;
  createButtonTestId?: string;
  viewModes?: ViewMode[];
  initialViewMode?: ViewMode;
  defaultColumns?: string[];
  enableKeyboardNavigation?: boolean;
  emptyState?: React.ReactNode;
  showPromoteToProject?: boolean;
  className?: string;
  headerContent?: React.ReactNode;
  hideHeader?: boolean;
  toolbarContent?: React.ReactNode;
  selectionPersistenceKey?: string;
  enableInlineSprintAssignment?: boolean;
  showBacklogPicker?: boolean;
  allowShowAllIssues?: boolean;
}

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
  const updateIssueMutation = useUpdateIssue();
  const { data: teamMembers = [] } = useAssignableMembersQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: sprintsData } = useSprintsQuery(lockedProgramId);
  const availableSprints = useMemo(() => {
    if (!sprintsData?.weeks) return [];
    return sprintsData.weeks.map(s => ({ id: s.id, name: s.name }));
  }, [sprintsData]);

  const shouldSelfFetch = Boolean(lockedProgramId || lockedProjectId || lockedSprintId);
  const [showAllIssues, setShowAllIssues] = useState(false);

  const { data: fetchedIssues, isLoading: isFetchingIssues } = useIssuesQuery(
    shouldSelfFetch ? {
      programId: lockedProgramId,
      projectId: lockedProjectId,
      sprintId: lockedSprintId,
    } : {},
    { enabled: shouldSelfFetch }
  );

  const { data: allIssuesData, isLoading: isLoadingAllIssues } = useIssuesQuery(
    {},
    { enabled: allowShowAllIssues && showAllIssues && shouldSelfFetch }
  );

  const createIssueMutation = useCreateIssue();

  const effectiveContext = useMemo(() => {
    const projectId = inheritedContext?.projectId ?? lockedProjectId;
    const sprintId = inheritedContext?.sprintId ?? lockedSprintId;
    let programId = inheritedContext?.programId ?? lockedProgramId;

    if (projectId && !programId) {
      const project = projects.find(p => p.id === projectId);
      if (project?.program_id) {
        programId = project.program_id;
      }
    }

    return {
      programId,
      projectId,
      sprintId,
      assigneeId: inheritedContext?.assigneeId,
    };
  }, [inheritedContext, lockedProgramId, lockedProjectId, lockedSprintId, projects]);

  const buildBelongsTo = useCallback((): BelongsTo[] => {
    const belongs_to: BelongsTo[] = [];
    if (effectiveContext.programId) {
      belongs_to.push({ id: effectiveContext.programId, type: 'program' });
    }
    if (effectiveContext.projectId) {
      belongs_to.push({ id: effectiveContext.projectId, type: 'project' });
    }
    if (effectiveContext.sprintId) {
      belongs_to.push({ id: effectiveContext.sprintId, type: 'sprint' });
    }
    return belongs_to;
  }, [effectiveContext]);

  const inContextIssues = shouldSelfFetch ? (fetchedIssues ?? []) : (issuesProp ?? []);
  const loading = shouldSelfFetch ? (isFetchingIssues || (showAllIssues && isLoadingAllIssues)) : loadingProp;

  const inContextIds = useMemo(() => new Set(inContextIssues.map(i => i.id)), [inContextIssues]);

  const issues = useMemo(() => {
    if (!showAllIssues || !allIssuesData) {
      return inContextIssues;
    }
    const outOfContextIssues = allIssuesData.filter(issue => !inContextIds.has(issue.id));
    return [...inContextIssues, ...outOfContextIssues];
  }, [showAllIssues, inContextIssues, allIssuesData, inContextIds]);

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

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);
  const [convertingIssue, setConvertingIssue] = useState<IssueListItem | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isBacklogPickerOpen, setIsBacklogPickerOpen] = useState(false);

  const selectionPersistence = useSelectionPersistenceOptional();
  const getInitialSelection = useCallback((): Set<string> => {
    if (selectionPersistenceKey && selectionPersistence) {
      return selectionPersistence.getSelection(selectionPersistenceKey).selectedIds;
    }
    return new Set();
  }, [selectionPersistenceKey, selectionPersistence]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(getInitialSelection);
  const selectionRef = useRef<UseSelectionReturn | null>(null);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (selectionPersistenceKey && selectionPersistence) {
      selectionPersistence.setSelection(selectionPersistenceKey, {
        selectedIds,
        lastSelectedId: null,
      });
    }
  }, [selectedIds, selectionPersistenceKey, selectionPersistence]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    selectionRef.current?.clearSelection();
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (stateFilterChanged) {
      clearSelection();
    }
  }, [stateFilterChanged, clearSelection]);

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

  const handleCreateIssue = useCallback(async () => {
    if (shouldSelfFetch) {
      const belongs_to = buildBelongsTo();
      const issue = await createIssueMutation.mutateAsync({ belongs_to });
      if (issue) {
        navigate(`/documents/${issue.id}`);
      }
      return;
    }
    if (!onCreateIssue) return;
    const issue = await onCreateIssue();
    if (issue) {
      navigate(`/documents/${issue.id}`);
    }
  }, [shouldSelfFetch, buildBelongsTo, createIssueMutation, onCreateIssue, navigate]);

  const handleAddIssueToContext = useCallback(async (issue: IssueListItem) => {
    const existingBelongsTo = issue.belongs_to || [];
    const newBelongsTo = [...existingBelongsTo];

    if (effectiveContext.sprintId && !existingBelongsTo.some(b => b.id === effectiveContext.sprintId)) {
      newBelongsTo.push({ id: effectiveContext.sprintId, type: 'sprint' });
    }
    if (effectiveContext.projectId && !existingBelongsTo.some(b => b.id === effectiveContext.projectId)) {
      newBelongsTo.push({ id: effectiveContext.projectId, type: 'project' });
    }
    if (effectiveContext.programId && !existingBelongsTo.some(b => b.id === effectiveContext.programId)) {
      newBelongsTo.push({ id: effectiveContext.programId, type: 'program' });
    }

    try {
      await updateIssueMutation.mutateAsync({ id: issue.id, updates: { belongs_to: newBelongsTo } });
      showToast(`Added "${issue.title}" to context`, 'success');
      if (effectiveContext.sprintId) {
        queryClient.invalidateQueries({ queryKey: issueKeys.list({ sprintId: effectiveContext.sprintId }) });
      }
      if (effectiveContext.projectId) {
        queryClient.invalidateQueries({ queryKey: issueKeys.list({ projectId: effectiveContext.projectId }) });
      }
    } catch {
      showToast('Failed to add issue', 'error');
    }
  }, [effectiveContext, updateIssueMutation, queryClient, showToast]);

  const handleUpdateIssue = useCallback(async (id: string, updates: { state: IssueState }) => {
    if (onUpdateIssue) {
      await onUpdateIssue(id, updates);
    }
  }, [onUpdateIssue]);

  const handlePromoteToProject = useCallback((issue: IssueListItem) => {
    setConvertingIssue(issue);
    setContextMenu(null);
  }, []);

  const executeConversion = useCallback(async () => {
    if (!convertingIssue) return;
    setIsConverting(true);
    try {
      const res = await apiPost(`/api/documents/${convertingIssue.id}/convert`, { target_type: 'project' });
      if (res.ok) {
        const data = await readJson<{ id: string }>(res);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        ]);
        showToast(`Issue promoted to project: ${convertingIssue.title}`, 'success');
        navigate(`/documents/${data.id}`, { replace: true });
      } else {
        const error = await readJson<LegacyErrorResponse>(res);
        showToast(error.error || 'Failed to convert issue to project', 'error');
        setIsConverting(false);
        setConvertingIssue(null);
      }
    } catch (err) {
      console.error('Failed to convert issue:', err);
      showToast('Failed to convert issue to project', 'error');
      setIsConverting(false);
      setConvertingIssue(null);
    }
  }, [convertingIssue, navigate, showToast, queryClient]);

  const handleSelectionChange = useCallback((newSelectedIds: Set<string>, newSelection: UseSelectionReturn) => {
    setSelectedIds(newSelectedIds);
    selectionRef.current = newSelection;
    forceUpdate(n => n + 1);
  }, []);

  useGlobalListNavigation({
    selection: selectionRef.current,
    selectionRef,
    enabled: enableKeyboardNavigation && viewMode === 'list',
    onEnter: useCallback((focusedId: string) => {
      navigate(`/documents/${focusedId}`);
    }, [navigate]),
  });

  const handleKanbanCheckboxClick = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const handleKanbanContextMenu = useCallback((event: { x: number; y: number; issueId: string }) => {
    if (!selectedIds.has(event.issueId)) {
      setSelectedIds(new Set([event.issueId]));
    }
    const effectiveIds = selectedIds.has(event.issueId) ? selectedIds : new Set([event.issueId]);
    const mockSelection: UseSelectionReturn = {
      selectedIds: effectiveIds,
      focusedId: event.issueId,
      selectedCount: effectiveIds.size,
      hasSelection: effectiveIds.size > 0,
      isSelected: (id: string) => effectiveIds.has(id),
      isFocused: (id: string) => id === event.issueId,
      toggleSelection: () => {},
      toggleInGroup: () => {},
      selectAll: () => {},
      clearSelection: () => setSelectedIds(new Set()),
      selectRange: () => {},
      setFocusedId: () => {},
      moveFocus: () => {},
      extendSelection: () => {},
      handleClick: () => {},
      handleKeyDown: () => {},
    };
    selectionRef.current = mockSelection;
    setContextMenu({ x: event.x, y: event.y, selection: mockSelection });
  }, [selectedIds]);

  const handleContextMenu = useCallback((e: React.MouseEvent, _item: IssueListItem, selection: UseSelectionReturn) => {
    selectionRef.current = selection;
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  const canCreateIssue = Boolean(onCreateIssue || shouldSelfFetch);

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
          onClose={() => setContextMenu(null)}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onChangeStatus={handleBulkChangeStatus}
          onMoveToSprint={handleBulkMoveToSprint}
          onPromoteToProject={handlePromoteToProject}
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
