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
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/date-utils';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import { apiPost } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys } from '@/hooks/useProjectsQuery';
import { ConversionDialog } from '@/components/dialogs/ConversionDialog';

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
    const count = ids.length;

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
    const count = ids.length;

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
      const res = await apiPost(`/api/documents/${convertingProject.id}/convert`, { target_type: 'issue' });
      if (res.ok) {
        const data = await res.json();
        // Invalidate both issues and projects caches to reflect the conversion
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        ]);
        showToast(`Project converted to issue: ${convertingProject.title}`, 'success');
        navigate(`/documents/${data.id}`, { replace: true });
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to convert project to issue', 'error');
        setIsConverting(false);
        setConvertingProject(null);
      }
    } catch (err) {
      console.error('Failed to convert project:', err);
      showToast('Failed to convert project to issue', 'error');
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

/**
 * ProjectRowContent - Renders the content cells for a project row
 * Used by SelectableList which handles the <tr>, checkbox, and selection state
 */
interface ProjectRowContentProps {
  project: Project;
  isSelected: boolean;
  visibleColumns: Set<string>;
  programNameById: Map<string, string>;
}

function ProjectRowContent({ project, visibleColumns, programNameById }: ProjectRowContentProps) {
  return (
    <>
      {/* Title with color dot */}
      {visibleColumns.has('title') && (
        <td className="px-4 py-3 text-sm text-foreground" role="gridcell">
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: project.color || '#6366f1' }}
              aria-hidden="true"
            />
            <span className={project.archived_at ? 'text-muted line-through' : ''}>
              {project.title}
            </span>
            {project.is_complete === false && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-500/10 text-orange-500 border border-orange-500/20 whitespace-nowrap">
                Incomplete
              </span>
            )}
          </div>
        </td>
      )}
      {/* Impact */}
      {visibleColumns.has('impact') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.impact} />
        </td>
      )}
      {/* Confidence */}
      {visibleColumns.has('confidence') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.confidence} />
        </td>
      )}
      {/* Ease */}
      {visibleColumns.has('ease') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.ease} />
        </td>
      )}
      {/* ICE Score */}
      {visibleColumns.has('score') && (
        <td className="px-4 py-3 text-sm text-center font-medium" role="gridcell">
          <span className="inline-flex items-center justify-center rounded bg-accent px-2 py-0.5 text-white whitespace-nowrap">
            {project.ice_score}
          </span>
        </td>
      )}
      {/* Program */}
      {visibleColumns.has('program') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.program_id ? programNameById.get(project.program_id) || '—' : '—'}
        </td>
      )}
      {/* Design Review */}
      {visibleColumns.has('designReview') && (
        <td className="px-4 py-3 text-sm" role="gridcell">
          {project.has_design_review ? (
            <span className="inline-flex items-center gap-1.5 text-green-500">
              <CheckIcon className="h-4 w-4" />
              <span className="font-medium">Approved</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <XCircleIcon className="h-4 w-4" />
              <span>Not Approved</span>
            </span>
          )}
        </td>
      )}
      {/* Owner */}
      {visibleColumns.has('owner') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.owner?.name || 'Unassigned'}
        </td>
      )}
      {/* Updated */}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.updated_at ? formatDate(project.updated_at) : '-'}
        </td>
      )}
    </>
  );
}

function ICEBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="font-medium text-muted">&mdash;</span>;
  }
  const colors = {
    1: 'text-red-500',
    2: 'text-orange-500',
    3: 'text-yellow-500',
    4: 'text-lime-500',
    5: 'text-green-500',
  };
  return (
    <span className={cn('font-medium', colors[value as keyof typeof colors] || 'text-muted')}>
      {value}
    </span>
  );
}

interface ProjectsBulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function ProjectsBulkActionBar({
  selectedCount,
  onClearSelection,
  onArchive,
  onDelete,
}: ProjectsBulkActionBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-6 py-2',
        'animate-in slide-in-from-top-2 fade-in duration-150'
      )}
    >
      {/* Selection count */}
      <span className="text-sm font-medium text-foreground">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-border" aria-hidden="true" />

      {/* Archive button */}
      <button
        onClick={onArchive}
        className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-border/50 hover:text-foreground transition-colors"
      >
        <ArchiveIcon className="h-4 w-4" />
        Archive
      </button>

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
      >
        <TrashIcon className="h-4 w-4" />
        Delete
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear selection */}
      <button
        onClick={onClearSelection}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted hover:bg-border/50 hover:text-foreground transition-colors"
        aria-label="Clear selection"
      >
        <XIcon className="h-4 w-4" />
        Clear
      </button>
    </div>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ArrowDownLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 7L7 17M7 17H17M7 17V7" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}
