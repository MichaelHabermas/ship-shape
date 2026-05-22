import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatDate } from '@/lib/date-utils';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import { KanbanBoard } from '@/components/KanbanBoard';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { BulkActionBar } from '@/components/BulkActionBar';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { IssueListItem, Issue } from '@/contexts/IssuesContext';
import { useBulkUpdateIssues, useIssuesQuery, useCreateIssue, useUpdateIssue, issueKeys, getProgramId, getProgramTitle, getProjectId, getProjectTitle, getSprintId, getSprintTitle } from '@/hooks/useIssuesQuery';
import { ISSUE_STATE_LABELS, ISSUE_PRIORITY_LABELS, type BelongsTo, type IssueState } from '@ship/shared';
import { projectKeys, useProjectsQuery } from '@/hooks/useProjectsQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { useSprintsQuery } from '@/hooks/useWeeksQuery';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { useListFilters, ViewMode } from '@/hooks/useListFilters';
import { useGlobalListNavigation } from '@/hooks/useGlobalListNavigation';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { Combobox } from '@/components/ui/Combobox';
import { useToast } from '@/components/ui/Toast';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { cn } from '@/lib/cn';
import { FilterTabs, FilterTab } from '@/components/FilterTabs';
import { apiPost, apiPatch, readJson } from '@/lib/api';
import type { LegacyErrorResponse } from '@/api/schemas';
import { ConversionDialog } from '@/components/dialogs/ConversionDialog';
import { BacklogPickerModal } from '@/components/dialogs/BacklogPickerModal';
import { useSelectionPersistenceOptional } from '@/contexts/SelectionPersistenceContext';
import { InlineWeekSelector } from '@/components/InlineWeekSelector';

// Re-export Issue type for convenience
export type { IssueListItem, Issue } from '@/contexts/IssuesContext';

// All available columns with metadata
export const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'id', label: 'ID', hideable: true },
  { key: 'title', label: 'Title', hideable: false }, // Cannot hide title
  { key: 'status', label: 'Status', hideable: true },
  { key: 'source', label: 'Source', hideable: true },
  { key: 'program', label: 'Program', hideable: true },
  { key: 'sprint', label: 'Week', hideable: true },
  { key: 'priority', label: 'Priority', hideable: true },
  { key: 'assignee', label: 'Assignee', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

export const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
];

export const STATE_LABELS: Record<string, string> = ISSUE_STATE_LABELS;

const SOURCE_STYLES: Record<string, string> = {
  internal: 'bg-blue-500/20 text-blue-300',
  external: 'bg-purple-500/20 text-purple-300',
  action_items: 'bg-amber-500/20 text-amber-300',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-blue-500',
  none: 'text-muted',
};

const STATUS_COLORS: Record<string, string> = {
  triage: 'bg-yellow-500/20 text-yellow-300',
  backlog: 'bg-zinc-500/20 text-zinc-300',
  todo: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-amber-500/20 text-amber-300',
  in_review: 'bg-purple-500/20 text-purple-300',
  done: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-red-500/20 text-red-300',
};

// Default filter tabs for issues
export const DEFAULT_FILTER_TABS: FilterTab[] = [
  { id: '', label: 'All' },
  { id: 'triage', label: 'Needs Triage' },
  { id: 'todo,in_progress,in_review', label: 'Active' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
];

export interface IssuesListProps {
  /** Issues to display. Optional when using locked filters (will self-fetch). */
  issues?: IssueListItem[];
  /** Whether data is loading */
  loading?: boolean;
  /** Callback to update an issue */
  onUpdateIssue?: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
  /** Callback to create a new issue */
  onCreateIssue?: () => Promise<Issue | null>;
  /** Callback to refresh issues */
  onRefreshIssues?: () => Promise<void>;
  /** Storage key prefix for persisting view state (column visibility, etc.) */
  storageKeyPrefix?: string;
  /** Filter tabs to show. Pass null to hide filter tabs entirely. */
  filterTabs?: FilterTab[] | null;
  /** Initial state filter */
  initialStateFilter?: string;
  /** Called when state filter changes */
  onStateFilterChange?: (filter: string) => void;
  /** URL parameter name for state filter sync (e.g., 'state' or 'issues_state'). When provided, syncs filter to URL. */
  urlParamPrefix?: string;
  /** Whether to show program filter dropdown */
  showProgramFilter?: boolean;
  /** Whether to show project filter dropdown (default: true) */
  showProjectFilter?: boolean;
  /** Whether to show sprint filter dropdown (default: true) */
  showSprintFilter?: boolean;
  /** Locked program filter - cannot be changed by user, triggers self-fetch */
  lockedProgramId?: string;
  /** Locked project filter - cannot be changed by user, triggers self-fetch */
  lockedProjectId?: string;
  /** Locked sprint filter - cannot be changed by user, triggers self-fetch */
  lockedSprintId?: string;
  /** Context to inherit when creating new issues (derived from locked filters if not provided) */
  inheritedContext?: {
    programId?: string;
    projectId?: string;
    sprintId?: string;
    assigneeId?: string;
  };
  /** Whether to show the create button */
  showCreateButton?: boolean;
  /** Label for the create button */
  createButtonLabel?: string;
  /** Test ID for the create button */
  createButtonTestId?: string;
  /** Available view modes */
  viewModes?: ViewMode[];
  /** Initial view mode */
  initialViewMode?: ViewMode;
  /** Columns to show by default (if not persisted) */
  defaultColumns?: string[];
  /** Whether to enable keyboard navigation (j/k/Enter) */
  enableKeyboardNavigation?: boolean;
  /** Empty state content */
  emptyState?: React.ReactNode;
  /** Whether to show promote to project option in context menu */
  showPromoteToProject?: boolean;
  /** Custom class name for the container */
  className?: string;
  /** Header content (rendered above toolbar) - mutually exclusive with hideHeader */
  headerContent?: React.ReactNode;
  /** Whether to hide the header/toolbar entirely */
  hideHeader?: boolean;
  /** Additional toolbar content (rendered in toolbar) */
  toolbarContent?: React.ReactNode;
  /** Key for persisting selection state across navigation (e.g., 'issues' or 'project:uuid'). When provided, selections survive navigation. */
  selectionPersistenceKey?: string;
  /** Enable inline sprint assignment dropdown in the sprint column. Requires lockedProgramId to fetch available sprints. */
  enableInlineSprintAssignment?: boolean;
  /** Show "Add from Backlog" button to add existing issues to the current context (sprint/project/program) */
  showBacklogPicker?: boolean;
  /** Allow toggling "Show All Issues" to display out-of-context issues with reduced opacity and '+' button */
  allowShowAllIssues?: boolean;
}

/**
 * IssuesList - Reusable component for displaying issues in list or kanban view
 *
 * Features:
 * - List and Kanban view modes with toggle
 * - Multi-select with bulk actions (archive, delete, change status, assign, move to sprint)
 * - Column visibility picker (list view only)
 * - State filter tabs
 * - Program filter dropdown
 * - Keyboard navigation (j/k for focus, x for select, Enter to open)
 * - Context menu with single and bulk actions
 * - Promote to project action
 */
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
  const [searchParams, setSearchParams] = useSearchParams();
  const bulkUpdate = useBulkUpdateIssues();
  const updateIssueMutation = useUpdateIssue();
  const { data: teamMembers = [] } = useAssignableMembersQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  // Fetch sprints when program context is available (for bulk actions and inline assignment)
  const { data: sprintsData } = useSprintsQuery(lockedProgramId);
  const availableSprints = useMemo(() => {
    if (!sprintsData?.weeks) return [];
    return sprintsData.weeks.map(s => ({ id: s.id, name: s.name }));
  }, [sprintsData]);

  // Determine if we should self-fetch based on locked filters
  const shouldSelfFetch = Boolean(lockedProgramId || lockedProjectId || lockedSprintId);

  // State for "Show All Issues" toggle
  const [showAllIssues, setShowAllIssues] = useState(false);

  // Self-fetch issues when using locked filters
  const { data: fetchedIssues, isLoading: isFetchingIssues } = useIssuesQuery(
    shouldSelfFetch ? {
      programId: lockedProgramId,
      projectId: lockedProjectId,
      sprintId: lockedSprintId,
    } : {},
    { enabled: shouldSelfFetch }
  );

  // Also fetch ALL issues when showAllIssues toggle is enabled (for inline add feature)
  const { data: allIssuesData, isLoading: isLoadingAllIssues } = useIssuesQuery(
    {},
    { enabled: allowShowAllIssues && showAllIssues && shouldSelfFetch }
  );

  // Internal create issue mutation for self-fetching mode
  const createIssueMutation = useCreateIssue();

  // Compute effective context for issue creation (from inheritedContext or locked filters)
  const effectiveContext = useMemo(() => {
    // Prefer explicit inheritedContext over locked filters
    const projectId = inheritedContext?.projectId ?? lockedProjectId;
    const sprintId = inheritedContext?.sprintId ?? lockedSprintId;
    let programId = inheritedContext?.programId ?? lockedProgramId;

    // Infer program from project if project is set and program isn't
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

  // Build belongs_to array from effective context
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

  // Use fetched issues when self-fetching, otherwise use the prop
  const inContextIssues = shouldSelfFetch ? (fetchedIssues ?? []) : (issuesProp ?? []);
  const loading = shouldSelfFetch ? (isFetchingIssues || (showAllIssues && isLoadingAllIssues)) : loadingProp;

  // Create set of in-context issue IDs for quick lookup
  const inContextIds = useMemo(() => {
    return new Set(inContextIssues.map(i => i.id));
  }, [inContextIssues]);

  // Combine in-context and out-of-context issues when showAllIssues toggle is enabled
  const issues = useMemo(() => {
    if (!showAllIssues || !allIssuesData) {
      return inContextIssues;
    }
    // Get out-of-context issues (not already in the in-context set)
    const outOfContextIssues = allIssuesData.filter(issue => !inContextIds.has(issue.id));
    // Return in-context first, then out-of-context
    return [...inContextIssues, ...outOfContextIssues];
  }, [showAllIssues, inContextIssues, allIssuesData, inContextIds]);

  // Use shared hooks for list state management
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

  // URL param name for state filter (if URL sync is enabled)
  const stateUrlParam = urlParamPrefix ? `${urlParamPrefix}_state` : null;

  // Initialize state from URL if URL sync is enabled, otherwise use prop
  const getInitialStateFilter = () => {
    if (stateUrlParam) {
      return searchParams.get(stateUrlParam) ?? initialStateFilter;
    }
    return initialStateFilter;
  };

  const [stateFilter, setStateFilter] = useState(getInitialStateFilter);
  const [programFilter, setProgramFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [sprintFilter, setSprintFilter] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  // Conversion state
  const [convertingIssue, setConvertingIssue] = useState<IssueListItem | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // Backlog picker state
  const [isBacklogPickerOpen, setIsBacklogPickerOpen] = useState(false);

  // Undo state for bulk actions - using ref to avoid stale closure issues
  // (state updates are async, but we need the value immediately when toast onClick fires)
  interface UndoState {
    action: 'status' | 'sprint' | 'assign' | 'project';
    ids: string[];
    previousValues: Map<string, { state?: string; sprint_id?: string | null; assignee_id?: string | null; project_id?: string | null }>;
    timestamp: number;
  }
  const undoStateRef = useRef<UndoState | null>(null);
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear undo state helper
  const clearUndoState = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    undoStateRef.current = null;
  }, []);

  // Set undo state with 30s timeout
  const setUndoWithTimeout = useCallback((state: UndoState) => {
    clearUndoState();
    undoStateRef.current = state;
    undoTimeoutRef.current = setTimeout(() => {
      undoStateRef.current = null;
    }, 30000);
  }, [clearUndoState]);

  // Execute undo action
  const executeUndo = useCallback(() => {
    const undoState = undoStateRef.current;
    if (!undoState) return;

    const { action, ids, previousValues } = undoState;

    // Group issues by their previous values for efficient batch updates
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

    // Execute each group of updates
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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    };
  }, []);

  // Selection persistence context (optional - only works when provider is present)
  const selectionPersistence = useSelectionPersistenceOptional();

  // Get initial selection from persistence context
  const getInitialSelection = useCallback((): Set<string> => {
    if (selectionPersistenceKey && selectionPersistence) {
      const persisted = selectionPersistence.getSelection(selectionPersistenceKey);
      return persisted.selectedIds;
    }
    return new Set();
  }, [selectionPersistenceKey, selectionPersistence]);

  // Track selection state for BulkActionBar and global keyboard navigation
  const [selectedIds, setSelectedIds] = useState<Set<string>>(getInitialSelection);
  const selectionRef = useRef<UseSelectionReturn | null>(null);
  // Force re-render trigger for when selection ref updates (used by useGlobalListNavigation)
  const [, forceUpdate] = useState(0);

  // Persist selection changes to context
  useEffect(() => {
    if (selectionPersistenceKey && selectionPersistence) {
      selectionPersistence.setSelection(selectionPersistenceKey, {
        selectedIds,
        lastSelectedId: null, // We don't track lastSelectedId at this level yet
      });
    }
  }, [selectedIds, selectionPersistenceKey, selectionPersistence]);

  // Sync state filter with external state (when not using URL sync)
  useEffect(() => {
    if (!stateUrlParam) {
      setStateFilter(initialStateFilter);
    }
  }, [initialStateFilter, stateUrlParam]);

  // Sync state filter from URL (when using URL sync)
  useEffect(() => {
    if (stateUrlParam) {
      const urlValue = searchParams.get(stateUrlParam) ?? '';
      if (urlValue !== stateFilter) {
        setStateFilter(urlValue);
      }
    }
  }, [searchParams, stateUrlParam, stateFilter]);

  // Compute unique programs from issues for the filter dropdown
  const programOptions = useMemo(() => {
    const programMap = new Map<string, string>();
    issues.forEach(issue => {
      const programId = getProgramId(issue);
      const programName = getProgramTitle(issue);
      if (programId && programName) {
        programMap.set(programId, programName);
      }
    });
    return Array.from(programMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  // Compute unique projects from issues for the filter dropdown
  const projectOptions = useMemo(() => {
    const projectMap = new Map<string, string>();
    issues.forEach(issue => {
      const projectId = getProjectId(issue);
      const projectName = getProjectTitle(issue);
      if (projectId && projectName) {
        projectMap.set(projectId, projectName);
      }
    });
    return Array.from(projectMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  // Compute unique sprints from issues for the filter dropdown
  const sprintOptions = useMemo(() => {
    const sprintMap = new Map<string, string>();
    issues.forEach(issue => {
      const sprintId = getSprintId(issue);
      const sprintName = getSprintTitle(issue);
      if (sprintId && sprintName) {
        sprintMap.set(sprintId, sprintName);
      }
    });
    return Array.from(sprintMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  // Filter issues based on state filter AND program/project/sprint filters
  const filteredIssues = useMemo(() => {
    let result = issues;

    // Apply program filter
    if (programFilter) {
      result = result.filter(issue => getProgramId(issue) === programFilter);
    }

    // Apply project filter
    if (projectFilter) {
      result = result.filter(issue => getProjectId(issue) === projectFilter);
    }

    // Apply sprint filter
    if (sprintFilter) {
      result = result.filter(issue => getSprintId(issue) === sprintFilter);
    }

    // Apply state filter (or special filters)
    if (stateFilter === '__no_project__') {
      // Special filter: show issues without a project association
      result = result.filter(issue => !getProjectId(issue));
    } else if (stateFilter) {
      const states = stateFilter.split(',');
      result = result.filter(issue => states.includes(issue.state));
    }

    return result;
  }, [issues, stateFilter, programFilter, projectFilter, sprintFilter]);

  const handleCreateIssue = useCallback(async () => {
    // When self-fetching with context, use internal creation
    if (shouldSelfFetch) {
      const belongs_to = buildBelongsTo();
      const issue = await createIssueMutation.mutateAsync({ belongs_to });
      if (issue) {
        navigate(`/documents/${issue.id}`);
      }
      return;
    }
    // Otherwise, use external callback
    if (!onCreateIssue) return;
    const issue = await onCreateIssue();
    if (issue) {
      navigate(`/documents/${issue.id}`);
    }
  }, [shouldSelfFetch, buildBelongsTo, createIssueMutation, onCreateIssue, navigate]);

  // Handler for adding an out-of-context issue to the current context (inline '+' button)
  const handleAddIssueToContext = useCallback(async (issue: IssueListItem) => {
    const existingBelongsTo = issue.belongs_to || [];
    const newBelongsTo = [...existingBelongsTo];

    // Add context associations that aren't already present
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
      const res = await apiPatch(`/api/documents/${issue.id}`, { belongs_to: newBelongsTo });
      if (res.ok) {
        showToast(`Added "${issue.title}" to context`, 'success');
        // Invalidate queries to refresh
        queryClient.invalidateQueries({ queryKey: issueKeys.all });
        if (effectiveContext.sprintId) {
          queryClient.invalidateQueries({ queryKey: issueKeys.list({ sprintId: effectiveContext.sprintId }) });
        }
        if (effectiveContext.projectId) {
          queryClient.invalidateQueries({ queryKey: issueKeys.list({ projectId: effectiveContext.projectId }) });
        }
      } else {
        showToast('Failed to add issue', 'error');
      }
    } catch {
      showToast('Failed to add issue', 'error');
    }
  }, [effectiveContext, queryClient, showToast]);

  const handleFilterChange = useCallback((newFilter: string) => {
    setStateFilter(newFilter);
    // Update URL if URL sync is enabled
    if (stateUrlParam) {
      setSearchParams((prev) => {
        if (newFilter) {
          prev.set(stateUrlParam, newFilter);
        } else {
          prev.delete(stateUrlParam);
        }
        return prev;
      });
    }
    // Call external callback if provided
    onStateFilterChange?.(newFilter);
  }, [onStateFilterChange, stateUrlParam, setSearchParams]);

  const handleUpdateIssue = useCallback(async (id: string, updates: { state: IssueState }) => {
    if (onUpdateIssue) {
      await onUpdateIssue(id, updates);
    }
  }, [onUpdateIssue]);

  // Clear selection helper
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    selectionRef.current?.clearSelection();
    setContextMenu(null);
  }, []);

  // Clear selection when filter changes (but not on initial mount to preserve persisted selection)
  const prevStateFilterRef = useRef(stateFilter);
  useEffect(() => {
    if (prevStateFilterRef.current !== stateFilter) {
      clearSelection();
      prevStateFilterRef.current = stateFilter;
    }
  }, [stateFilter, clearSelection]);

  // Bulk action handlers
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
                  onRefreshIssues?.();
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
                  onRefreshIssues?.();
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
    // Check if moving issues out of the current locked sprint context
    const movingOutOfView = lockedSprintId && sprintId !== lockedSprintId;

    // Save previous values for undo
    const previousValues = new Map<string, { sprint_id: string | null }>();
    ids.forEach(id => {
      const issue = issues.find(i => i.id === id);
      if (issue) {
        previousValues.set(id, { sprint_id: getSprintId(issue) ?? null });
      }
    });

    bulkUpdate.mutate({ ids, action: 'update', updates: { sprint_id: sprintId } }, {
      onSuccess: () => {
        // Set up undo state
        setUndoWithTimeout({
          action: 'sprint',
          ids,
          previousValues,
          timestamp: Date.now(),
        });

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

    // Save previous values for undo
    const previousValues = new Map<string, { state: string }>();
    ids.forEach(id => {
      const issue = issues.find(i => i.id === id);
      if (issue) {
        previousValues.set(id, { state: issue.state });
      }
    });

    bulkUpdate.mutate({ ids, action: 'update', updates: { state: status as IssueState } }, {
      onSuccess: () => {
        // Set up undo state
        setUndoWithTimeout({
          action: 'status',
          ids,
          previousValues,
          timestamp: Date.now(),
        });

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

    // Save previous values for undo
    const previousValues = new Map<string, { assignee_id: string | null }>();
    ids.forEach(id => {
      const issue = issues.find(i => i.id === id);
      if (issue) {
        previousValues.set(id, { assignee_id: issue.assignee_id ?? null });
      }
    });

    bulkUpdate.mutate({ ids, action: 'update', updates: { assignee_id: userId } }, {
      onSuccess: () => {
        // Set up undo state
        setUndoWithTimeout({
          action: 'assign',
          ids,
          previousValues,
          timestamp: Date.now(),
        });

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
    // Check if moving issues out of the current locked context
    const movingOutOfView = lockedProjectId && projectId !== lockedProjectId;

    // Save previous values for undo
    const previousValues = new Map<string, { project_id: string | null }>();
    ids.forEach(id => {
      const issue = issues.find(i => i.id === id);
      if (issue) {
        previousValues.set(id, { project_id: getProjectId(issue) ?? null });
      }
    });

    bulkUpdate.mutate({ ids, action: 'update', updates: { project_id: projectId } }, {
      onSuccess: () => {
        // Set up undo state
        setUndoWithTimeout({
          action: 'project',
          ids,
          previousValues,
          timestamp: Date.now(),
        });

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

  // Handle promote to project
  const handlePromoteToProject = useCallback((issue: IssueListItem) => {
    setConvertingIssue(issue);
    setContextMenu(null);
  }, []);

  // Execute the conversion to project
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

  // Selection change handler
  const handleSelectionChange = useCallback((newSelectedIds: Set<string>, newSelection: UseSelectionReturn) => {
    setSelectedIds(newSelectedIds);
    selectionRef.current = newSelection;
    forceUpdate(n => n + 1);
  }, []);

  // Global keyboard navigation for j/k and Enter
  useGlobalListNavigation({
    selection: selectionRef.current,
    selectionRef: selectionRef,
    enabled: enableKeyboardNavigation && viewMode === 'list',
    onEnter: useCallback((focusedId: string) => {
      navigate(`/documents/${focusedId}`);
    }, [navigate]),
  });

  // Kanban checkbox click handler
  const handleKanbanCheckboxClick = useCallback((id: string, _e: React.MouseEvent) => {
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

  // Kanban context menu handler
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

  // Context menu handler for SelectableList
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: IssueListItem, selection: UseSelectionReturn) => {
    selectionRef.current = selection;
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  // Determine if create functionality should be enabled
  // Either external callback is provided OR component is self-fetching with context
  const canCreateIssue = Boolean(onCreateIssue || shouldSelfFetch);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Cmd/Ctrl+Z to undo last bulk action
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey && undoStateRef.current) {
        e.preventDefault();
        executeUndo();
        return;
      }

      // "c" to create issue
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && canCreateIssue) {
        e.preventDefault();
        handleCreateIssue();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCreateIssue, canCreateIssue, executeUndo]);

  // Handler for inline sprint assignment changes (bulk API accepts sprint_id)
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
        onError: () => {
          showToast('Failed to update week', 'error');
        },
      }
    );
  }, [bulkUpdate, availableSprints, showToast]);

  // Render function for issue rows
  const renderIssueRow = useCallback((issue: IssueListItem, { isSelected }: RowRenderProps) => {
    const isOutOfContext = allowShowAllIssues && showAllIssues && !inContextIds.has(issue.id);
    return (
      <IssueRowContent
        issue={issue}
        isSelected={isSelected}
        visibleColumns={visibleColumns}
        sprints={enableInlineSprintAssignment ? availableSprints : undefined}
        onSprintChange={enableInlineSprintAssignment ? handleInlineSprintChange : undefined}
        isOutOfContext={isOutOfContext}
        onAddToContext={isOutOfContext ? () => handleAddIssueToContext(issue) : undefined}
      />
    );
  }, [visibleColumns, enableInlineSprintAssignment, availableSprints, handleInlineSprintChange, allowShowAllIssues, showAllIssues, inContextIds, handleAddIssueToContext]);

  // Default empty state
  const defaultEmptyState = useMemo(() => (
    <div className="text-center">
      <p className="text-muted">No issues found</p>
      {canCreateIssue && (
        <button
          onClick={handleCreateIssue}
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

  // Program filter for toolbar (hidden when locked)
  const programFilterContent = showProgramFilter && !lockedProgramId && programOptions.length > 0 ? (
    <div className="w-40">
      <Combobox
        options={programOptions}
        value={programFilter}
        onChange={setProgramFilter}
        placeholder="All Programs"
        aria-label="Filter issues by program"
        id={`${storageKeyPrefix}-program-filter`}
        allowClear={true}
        clearLabel="All Programs"
      />
    </div>
  ) : null;

  // Project filter for toolbar (hidden when locked)
  const projectFilterContent = showProjectFilter && !lockedProjectId && projectOptions.length > 0 ? (
    <div className="w-40">
      <Combobox
        options={projectOptions}
        value={projectFilter}
        onChange={setProjectFilter}
        placeholder="All Projects"
        aria-label="Filter issues by project"
        id={`${storageKeyPrefix}-project-filter`}
        allowClear={true}
        clearLabel="All Projects"
      />
    </div>
  ) : null;

  // Sprint filter for toolbar (hidden when locked)
  const sprintFilterContent = showSprintFilter && !lockedSprintId && sprintOptions.length > 0 ? (
    <div className="w-40">
      <Combobox
        options={sprintOptions}
        value={sprintFilter}
        onChange={setSprintFilter}
        placeholder="All Weeks"
        aria-label="Filter issues by week"
        id={`${storageKeyPrefix}-sprint-filter`}
        allowClear={true}
        clearLabel="All Weeks"
      />
    </div>
  ) : null;

  // Combine all filter content
  const combinedFilterContent = (programFilterContent || projectFilterContent || sprintFilterContent || toolbarContent) ? (
    <div className="flex items-center gap-2">
      {programFilterContent}
      {projectFilterContent}
      {sprintFilterContent}
      {toolbarContent}
    </div>
  ) : null;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-border px-6 py-4 gap-4">
          {headerContent || <div className="flex-shrink-0" />}
          <div className="flex items-center gap-3">
            {/* Scrollable toolbar section */}
            <div className="flex items-center gap-2 overflow-x-auto flex-shrink min-w-0">
              <DocumentListToolbar
                sortOptions={SORT_OPTIONS}
                sortBy={sortBy}
                onSortChange={setSortBy}
                viewModes={viewModes}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                allColumns={ALL_COLUMNS}
                visibleColumns={visibleColumns}
                onToggleColumn={toggleColumn}
                hiddenCount={hiddenCount}
                showColumnPicker={viewMode === 'list'}
                filterContent={combinedFilterContent}
              />
              {/* Add from Backlog button - text collapses on small screens */}
              {showBacklogPicker && (effectiveContext.sprintId || effectiveContext.projectId || effectiveContext.programId) && (
                <button
                  onClick={() => setIsBacklogPickerOpen(true)}
                  className="rounded-md border border-border px-2 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/30 transition-colors flex items-center gap-1.5 flex-shrink-0"
                  title="Add from Backlog"
                >
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span className="hidden lg:inline whitespace-nowrap">Add from Backlog</span>
                </button>
              )}
              {/* Show All Issues toggle - text collapses on small screens */}
              {allowShowAllIssues && shouldSelfFetch && (
                <button
                  onClick={() => setShowAllIssues(!showAllIssues)}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-sm transition-colors flex items-center gap-1.5 flex-shrink-0",
                    showAllIssues
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted hover:text-foreground hover:bg-border/30"
                  )}
                  aria-pressed={showAllIssues}
                  title={showAllIssues ? "Showing all issues - click to show only in-context" : "Click to show all issues"}
                >
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {showAllIssues ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    )}
                  </svg>
                  <span className="hidden lg:inline whitespace-nowrap">{showAllIssues ? "All Issues" : "In Context"}</span>
                </button>
              )}
            </div>
            {/* Fixed Create button - always visible on the right */}
            {showCreateButton && canCreateIssue && (
              <button
                onClick={handleCreateIssue}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors flex-shrink-0 whitespace-nowrap"
                data-testid={createButtonTestId}
              >
                {createButtonLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter tabs OR Bulk action bar (mutually exclusive) */}
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

      {/* Content */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          issues={filteredIssues}
          onUpdateIssue={handleUpdateIssue}
          onIssueClick={(id) => navigate(`/documents/${id}`)}
          selectedIds={selectedIds}
          onCheckboxClick={handleKanbanCheckboxClick}
          onContextMenu={handleKanbanContextMenu}
        />
      ) : (
        <div className="flex-1 overflow-auto pb-20">
          <SelectableList
            items={filteredIssues}
            renderRow={renderIssueRow}
            columns={columns}
            emptyState={emptyState || defaultEmptyState}
            onItemClick={(issue) => navigate(`/documents/${issue.id}`)}
            onSelectionChange={handleSelectionChange}
            onContextMenu={handleContextMenu}
            ariaLabel="Issues list"
            initialSelectedIds={selectedIds}
          />
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <div className="px-3 py-1.5 text-xs text-muted border-b border-border mb-1">
            {Math.max(1, contextMenu.selection.selectedCount)} selected
          </div>
          <ContextMenuItem onClick={handleBulkArchive}>
            <ArchiveIcon className="h-4 w-4" />
            Archive
          </ContextMenuItem>
          <ContextMenuSubmenu label="Change Status">
            <ContextMenuItem onClick={() => handleBulkChangeStatus('backlog')}>Backlog</ContextMenuItem>
            <ContextMenuItem onClick={() => handleBulkChangeStatus('todo')}>Todo</ContextMenuItem>
            <ContextMenuItem onClick={() => handleBulkChangeStatus('in_progress')}>In Progress</ContextMenuItem>
            <ContextMenuItem onClick={() => handleBulkChangeStatus('done')}>Done</ContextMenuItem>
          </ContextMenuSubmenu>
          <ContextMenuSubmenu label="Move to Week">
            <ContextMenuItem onClick={() => handleBulkMoveToSprint(null)}>No Week</ContextMenuItem>
          </ContextMenuSubmenu>
          {showPromoteToProject && contextMenu.selection.selectedCount === 1 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => {
                const selectedId = Array.from(contextMenu.selection.selectedIds)[0];
                const issue = filteredIssues.find(i => i.id === selectedId);
                if (issue) handlePromoteToProject(issue);
              }}>
                <ArrowUpRightIcon className="h-4 w-4" />
                Promote to Project
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleBulkDelete} destructive>
            <TrashIcon className="h-4 w-4" />
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}

      {/* Conversion confirmation dialog */}
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

      {/* Backlog picker modal for adding existing issues */}
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
            // Invalidate queries to refresh the issues list
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

/**
 * IssueRowContent - Renders the content cells for an issue row
 */
interface IssueRowContentProps {
  issue: IssueListItem;
  isSelected: boolean;
  visibleColumns: Set<string>;
  sprints?: { id: string; name: string }[];
  onSprintChange?: (issueId: string, sprintId: string | null) => void;
  /** Whether this issue is outside the current filter context (for inline add feature) */
  isOutOfContext?: boolean;
  /** Handler to add this issue to the current context */
  onAddToContext?: () => void;
}

function IssueRowContent({ issue, visibleColumns, sprints, onSprintChange, isOutOfContext, onAddToContext }: IssueRowContentProps) {
  // Apply reduced opacity to out-of-context issues
  const cellClass = isOutOfContext ? 'opacity-50' : '';

  return (
    <>
      {visibleColumns.has('id') && (
        <td className={cn("px-4 py-3 text-sm text-muted", cellClass)} role="gridcell">
          {issue.ticket_number ? `#${issue.ticket_number}` : ''}
        </td>
      )}
      {visibleColumns.has('title') && (
        <td className={cn("px-4 py-3 text-sm text-foreground", cellClass)} role="gridcell">
          <div className="flex items-center gap-2">
            <span className="truncate">{issue.title}</span>
            {isOutOfContext && onAddToContext && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToContext();
                }}
                className="flex-shrink-0 p-1 rounded hover:bg-accent/20 text-accent opacity-100 transition-colors"
                title="Add to current context"
                aria-label={`Add "${issue.title}" to context`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
            )}
          </div>
        </td>
      )}
      {visibleColumns.has('status') && (
        <td className={cn("px-4 py-3", cellClass)} role="gridcell">
          <StatusBadge state={issue.state} />
        </td>
      )}
      {visibleColumns.has('source') && (
        <td className={cn("px-4 py-3", cellClass)} role="gridcell">
          <SourceBadge source={issue.source} />
        </td>
      )}
      {visibleColumns.has('program') && (
        <td className={cn("px-4 py-3 text-sm text-muted", cellClass)} role="gridcell">
          {getProgramTitle(issue) || '—'}
        </td>
      )}
      {visibleColumns.has('sprint') && (
        <td className={cn("px-4 py-3 text-sm text-muted", cellClass)} role="gridcell">
          {sprints && onSprintChange ? (
            <InlineWeekSelector
              value={getSprintId(issue)}
              sprints={sprints}
              onChange={(sprintId) => onSprintChange(issue.id, sprintId)}
            />
          ) : (
            getSprintTitle(issue) || '—'
          )}
        </td>
      )}
      {visibleColumns.has('priority') && (
        <td className={cn("px-4 py-3", cellClass)} role="gridcell">
          <PriorityBadge priority={issue.priority} />
        </td>
      )}
      {visibleColumns.has('assignee') && (
        <td className={cn("px-4 py-3 text-sm text-muted", cellClass, issue.assignee_archived && "opacity-50")} role="gridcell">
          {issue.assignee_name ? (
            <>
              {issue.assignee_name}{issue.assignee_archived && ' (archived)'}
            </>
          ) : 'Unassigned'}
        </td>
      )}
      {visibleColumns.has('updated') && (
        <td className={cn("px-4 py-3 text-sm text-muted", cellClass)} role="gridcell">
          {issue.updated_at ? formatDate(issue.updated_at) : '-'}
        </td>
      )}
    </>
  );
}

// Badge components
export function StatusBadge({ state }: { state: string }) {
  const label = STATE_LABELS[state] || state;
  return (
    <span
      data-status-indicator
      data-status={state}
      aria-label={`Status: ${label}`}
      className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_COLORS[state] || STATUS_COLORS.backlog)}
    >
      <StatusIcon state={state} />
      {label}
      <span className="sr-only">Status: {label}</span>
    </span>
  );
}

function StatusIcon({ state }: { state: string }) {
  const iconProps = { className: 'h-3 w-3', 'aria-hidden': 'true' as const };

  switch (state) {
    case 'triage':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
      );
    case 'backlog':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
        </svg>
      );
    case 'todo':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M8 2 A6 6 0 0 1 8 14" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M8 2 A6 6 0 1 1 2 8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'in_review':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'done':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="6" />
          <path d="M5.5 8l2 2 3-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M5 5l6 6M11 5l-6 6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
        </svg>
      );
  }
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn('text-sm', PRIORITY_COLORS[priority] || PRIORITY_COLORS.none)}>
      {ISSUE_PRIORITY_LABELS[priority as keyof typeof ISSUE_PRIORITY_LABELS] || priority}
    </span>
  );
}

function SourceBadge({ source }: { source: IssueListItem['source'] }) {
  const label =
    source === 'internal' ? 'Internal'
    : source === 'action_items' ? 'Action Items'
    : 'External';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        SOURCE_STYLES[source] || SOURCE_STYLES.internal
      )}
    >
      {label}
    </span>
  );
}

// Icons
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 17L17 7M17 7H7M17 7V17" />
    </svg>
  );
}
