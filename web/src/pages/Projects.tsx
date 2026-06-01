import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { usePrograms } from '@/contexts/ProgramsContext';
import { useAuth } from '@/hooks/useAuth';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { useListFilters } from '@/hooks/useListFilters';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { Combobox } from '@/components/ui/Combobox';
import { useToast } from '@/components/ui/Toast';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/ContextMenu';
import { FilterTabs } from '@/components/FilterTabs';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import { apiPostJson } from '@/lib/api';
import type { Document } from '@/api/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys } from '@/hooks/useProjectsQuery';
import { ConversionDialog } from '@/components/dialogs/ConversionDialog';
import {
  ArrowDownLeftIcon,
  ProjectRowContent,
  ProjectsBulkActionBar,
  TrashIcon,
} from '@/pages/ProjectsListViews';

// All available columns with metadata
const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'title', label: 'Title', hideable: false }, // Cannot hide title
  { key: 'impact', label: 'I', hideable: true },
  { key: 'confidence', label: 'C', hideable: true },
  { key: 'ease', label: 'E', hideable: true },
  { key: 'score', label: 'Score', hideable: true },
  { key: 'program', label: 'Program', hideable: true },
  { key: 'designReview', label: 'Design Review', hideable: true },
  { key: 'owner', label: 'Owner', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

const SORT_OPTIONS = [
  { value: 'ice_score', label: 'ICE Score' },
  { value: 'impact', label: 'Impact' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'ease', label: 'Ease' },
  { value: 'title', label: 'Title' },
  { value: 'updated', label: 'Updated' },
];

export function ProjectsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { projects: allProjects, loading, createProject, updateProject, deleteProject, refreshProjects } = useProjects();
  const { programs } = usePrograms();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  // Use shared hooks for list state management
  const { sortBy, setSortBy, viewMode, setViewMode } = useListFilters({
    sortOptions: SORT_OPTIONS,
    defaultSort: 'ice_score',
  });

  const { visibleColumns, columns, hiddenCount, toggleColumn } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: 'projects-column-visibility',
  });

  const [programFilter, setProgramFilter] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  // Conversion state
  const [convertingProject, setConvertingProject] = useState<Project | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // Track selection state for BulkActionBar
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionRef = useRef<UseSelectionReturn | null>(null);

  // Normalize status filter - invalid values default to 'all' (empty string)
  const validStatuses = ['', 'active', 'planned', 'completed', 'archived'];
  const rawStatusFilter = searchParams.get('status') || '';
  const statusFilter = validStatuses.includes(rawStatusFilter) ? rawStatusFilter : '';

  // Compute unique programs from projects for the filter dropdown
  const programOptions = useMemo(() => {
    return programs.map(p => ({ value: p.id, label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [programs]);

  // Get program name lookup
  const programNameById = useMemo(() => {
    const map = new Map<string, string>();
    programs.forEach(p => map.set(p.id, p.name));
    return map;
  }, [programs]);

  // Compute counts for each status filter tab
  const statusCounts = useMemo(() => {
    // Apply program filter first to get the relevant projects
    const programFiltered = programFilter
      ? allProjects.filter(project => project.program_id === programFilter)
      : allProjects;

    return {
      all: programFiltered.filter(p => p.inferred_status !== 'archived').length,
      active: programFiltered.filter(p => p.inferred_status === 'active').length,
      planned: programFiltered.filter(p => p.inferred_status === 'planned').length,
      completed: programFiltered.filter(p => p.inferred_status === 'completed').length,
      archived: programFiltered.filter(p => p.inferred_status === 'archived').length,
    };
  }, [allProjects, programFilter]);

  // Filter projects client-side based on status filter AND program filter
  const filteredProjects = useMemo(() => {
    let filtered = allProjects;

    // Apply program filter
    if (programFilter) {
      filtered = filtered.filter(project => project.program_id === programFilter);
    }

    // Apply status filter based on inferred_status
    switch (statusFilter) {
      case 'active':
        filtered = filtered.filter(project => project.inferred_status === 'active');
        break;
      case 'planned':
        filtered = filtered.filter(project => project.inferred_status === 'planned');
        break;
      case 'completed':
        filtered = filtered.filter(project => project.inferred_status === 'completed');
        break;
      case 'archived':
        filtered = filtered.filter(project => project.inferred_status === 'archived');
        break;
      default:
        // 'all' or empty = show all non-archived projects (active, planned, completed, backlog)
        filtered = filtered.filter(project => project.inferred_status !== 'archived');
    }

    return filtered;
  }, [allProjects, statusFilter, programFilter]);

  // Sort projects
  const projects = useMemo(() => {
    const sorted = [...filteredProjects];

    // Helper to sort nullable values (nulls go to bottom)
    const sortNullable = (aVal: number | null, bVal: number | null): number => {
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1; // a goes to bottom
      if (bVal === null) return -1; // b goes to bottom
      return bVal - aVal; // Descending
    };

    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'ice_score':
          return sortNullable(a.ice_score, b.ice_score);
        case 'impact':
          return sortNullable(a.impact, b.impact);
        case 'confidence':
          return sortNullable(a.confidence, b.confidence);
        case 'ease':
          return sortNullable(a.ease, b.ease);
        case 'title':
          return a.title.localeCompare(b.title); // Ascending
        case 'updated':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(); // Descending
        default:
          return sortNullable(a.ice_score, b.ice_score);
      }
    });

    return sorted;
  }, [filteredProjects, sortBy]);

  const handleCreateProject = useCallback(async () => {
    if (!user?.id) {
      showToast('You must be logged in to create a project', 'error');
      return;
    }
    // Create project without owner (unassigned) - owner can be set later
    const project = await createProject({});
    if (project) {
      navigate(`/documents/${project.id}`);
    }
  }, [createProject, navigate, user, showToast]);

  const setFilter = (status: string) => {
    setSearchParams((prev) => {
      if (status) {
        prev.set('status', status);
      } else {
        prev.delete('status');
      }
      return prev;
    });
  };

  // Clear selection helper
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    selectionRef.current?.clearSelection();
    setContextMenu(null);
  }, []);

  // Clear selection when filter changes
  useEffect(() => {
    clearSelection();
  }, [statusFilter, clearSelection]);

  // Bulk action handlers
  const handleBulkArchive = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Archive each project
    let success = 0;
    for (const id of ids) {
      const result = await updateProject(id, { archived_at: new Date().toISOString() });
      if (result) success++;
    }

    if (success > 0) {
      showToast(
        `${success} project${success === 1 ? '' : 's'} archived`,
        'success',
        5000,
        {
          label: 'Undo',
          onClick: async () => {
            for (const id of ids) {
              await updateProject(id, { archived_at: null });
            }
            showToast('Archive undone', 'info');
            refreshProjects();
          },
        }
      );
    }
    clearSelection();
  }, [selectedIds, updateProject, showToast, clearSelection, refreshProjects]);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    let success = 0;
    for (const id of ids) {
      const result = await deleteProject(id);
      if (result) success++;
    }

    if (success > 0) {
      showToast(`${success} project${success === 1 ? '' : 's'} deleted`, 'success');
    }
    clearSelection();
  }, [selectedIds, deleteProject, showToast, clearSelection]);

  // Handle convert to issue - opens confirmation dialog
  const handleConvertToIssue = useCallback((project: Project) => {
    setConvertingProject(project);
    setContextMenu(null);
  }, []);

  // Execute the conversion to issue
  const executeConversion = useCallback(async () => {
    if (!convertingProject) return;
    setIsConverting(true);
    try {
      const data = await apiPostJson<Document>(
        `/api/documents/${convertingProject.id}/convert`,
        { target_type: 'issue' },
        'Failed to convert project to issue'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
      ]);
      showToast(`Project converted to issue: ${convertingProject.title}`, 'success');
      navigate(`/documents/${data.id}`, { replace: true });
    } catch (err) {
      console.error('Failed to convert project:', err);
      showToast(err instanceof Error ? err.message : 'Failed to convert project to issue', 'error');
      setIsConverting(false);
      setConvertingProject(null);
    }
  }, [convertingProject, navigate, showToast, queryClient]);

  // Selection change handler - keeps parent state in sync with SelectableList
  const handleSelectionChange = useCallback((newSelectedIds: Set<string>, selection: UseSelectionReturn) => {
    setSelectedIds(newSelectedIds);
    selectionRef.current = selection;
  }, []);

  // Context menu handler - receives selection from SelectableList
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: Project, selection: UseSelectionReturn) => {
    selectionRef.current = selection;
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // "c" to create project
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleCreateProject();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCreateProject]);

  // Render function for project rows
  const renderProjectRow = useCallback((project: Project, { isSelected }: RowRenderProps) => (
    <ProjectRowContent project={project} isSelected={isSelected} visibleColumns={visibleColumns} programNameById={programNameById} />
  ), [visibleColumns, programNameById]);

  // Empty state for the list
  const emptyState = useMemo(() => (
    <div className="text-center">
      <p className="text-muted">No projects yet</p>
      <button
        onClick={handleCreateProject}
        className="mt-2 text-sm text-accent hover:underline"
      >
        Create your first project
      </button>
    </div>
  ), [handleCreateProject]);

  if (loading) {
    return <IssuesListSkeleton />;
  }

  // Program filter for toolbar
  const programFilterContent = programOptions.length > 0 ? (
    <div className="w-40">
      <Combobox
        options={programOptions}
        value={programFilter}
        onChange={setProgramFilter}
        placeholder="All Programs"
        aria-label="Filter projects by program"
        id="projects-program-filter"
        allowClear={true}
        clearLabel="All Programs"
      />
    </div>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Projects</h1>
        <DocumentListToolbar
          sortOptions={SORT_OPTIONS}
          sortBy={sortBy}
          onSortChange={setSortBy}
          viewModes={['list']}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          allColumns={ALL_COLUMNS}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          hiddenCount={hiddenCount}
          showColumnPicker={true}
          filterContent={programFilterContent}
          createButton={{ label: 'New Project', onClick: handleCreateProject }}
        />
      </div>

      {/* Filter tabs OR Bulk action bar (mutually exclusive) */}
      {selectedIds.size > 0 ? (
        <ProjectsBulkActionBar
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
        />
      ) : (
        <FilterTabs
          tabs={[
            { id: '', label: 'All', count: statusCounts.all },
            { id: 'active', label: 'Active', count: statusCounts.active },
            { id: 'planned', label: 'Planned', count: statusCounts.planned },
            { id: 'completed', label: 'Completed', count: statusCounts.completed },
            { id: 'archived', label: 'Archived', count: statusCounts.archived },
          ]}
          activeId={statusFilter}
          onChange={setFilter}
          ariaLabel="Project filters"
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto pb-20">
        <SelectableList
          items={projects}
          renderRow={renderProjectRow}
          columns={columns}
          emptyState={emptyState}
          onItemClick={(project) => navigate(`/documents/${project.id}`)}
          onSelectionChange={handleSelectionChange}
          onContextMenu={handleContextMenu}
          ariaLabel="Projects list"
        />
      </div>

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
          {contextMenu.selection.selectedCount === 1 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => {
                const selectedId = Array.from(contextMenu.selection.selectedIds)[0];
                const project = projects.find(p => p.id === selectedId);
                if (project) handleConvertToIssue(project);
              }}>
                <ArrowDownLeftIcon className="h-4 w-4" />
                Convert to Issue
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
      {convertingProject && (
        <ConversionDialog
          isOpen={!!convertingProject}
          onClose={() => setConvertingProject(null)}
          onConvert={executeConversion}
          sourceType="project"
          title={convertingProject.title}
          isConverting={isConverting}
        />
      )}
    </div>
  );
}
