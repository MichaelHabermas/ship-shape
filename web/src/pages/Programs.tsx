import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrograms, Program } from '@/contexts/ProgramsContext';
import { SelectableList, RowRenderProps } from '@/components/SelectableList';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { UseSelectionReturn } from '@/hooks/useSelection';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';
import { getContrastTextColor, cn } from '@/lib/cn';
import { formatDate } from '@/lib/date-utils';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';

// Column definitions for programs list
const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'name', label: 'Name', hideable: false },
  { key: 'owner', label: 'Owner', hideable: true },
  { key: 'issue_count', label: 'Issues', hideable: true },
  { key: 'sprint_count', label: 'Weeks', hideable: true },
  { key: 'created', label: 'Created', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

// Sort options
const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'issue_count', label: 'Issues' },
];

// localStorage key
const COLUMN_VISIBILITY_KEY = 'programs-column-visibility';

export function ProgramsPage() {
  const navigate = useNavigate();
  const { programs, loading, createProgram, updateProgram, deleteProgram } = usePrograms();
  const { showToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [sortBy, setSortBy] = useState<string>('name');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionRef = useRef<UseSelectionReturn | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  // Column visibility
  const {
    visibleColumns,
    columns,
    hiddenCount,
    toggleColumn,
  } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: COLUMN_VISIBILITY_KEY,
  });

  // Sort programs (exclude archived)
  const sortedPrograms = useMemo(() => {
    const activePrograms = programs.filter(p => !p.archived_at);
    const sorted = [...activePrograms];
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'created':
        sorted.sort((a, b) => {
          const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bDate - aDate; // Newest first
        });
        break;
      case 'updated':
        sorted.sort((a, b) => {
          const aDate = a.updated_at ? new Date(a.updated_at).getTime() : 0;
          const bDate = b.updated_at ? new Date(b.updated_at).getTime() : 0;
          return bDate - aDate; // Newest first
        });
        break;
      case 'issue_count':
        sorted.sort((a, b) => (b.issue_count ?? 0) - (a.issue_count ?? 0));
        break;
    }
    return sorted;
  }, [programs, sortBy]);

  const handleCreateProgram = async () => {
    if (creating) return;
    setCreating(true);

    try {
      const program = await createProgram();
      if (program) {
        navigate(`/documents/${program.id}`);
      }
    } catch (err) {
      console.error('Failed to create program:', err);
    } finally {
      setCreating(false);
    }
  };

  // Clear selection helper
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    selectionRef.current?.clearSelection();
    setContextMenu(null);
  }, []);

  // Selection change handler
  const handleSelectionChange = useCallback((ids: Set<string>, selection: UseSelectionReturn) => {
    setSelectedIds(ids);
    selectionRef.current = selection;
  }, []);

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: Program, selection: UseSelectionReturn) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  // Bulk archive handler
  const handleBulkArchive = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;

    // Archive all selected programs
    await Promise.all(
      ids.map(id => updateProgram(id, { archived_at: new Date().toISOString() }))
    );

    clearSelection();
    showToast(`${count} program${count === 1 ? '' : 's'} archived`, 'success');
  }, [selectedIds, updateProgram, clearSelection, showToast]);

  // Bulk delete handler
  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;

    // Delete all selected programs
    await Promise.all(ids.map(id => deleteProgram(id)));

    clearSelection();
    showToast(`${count} program${count === 1 ? '' : 's'} deleted`, 'success');
  }, [selectedIds, deleteProgram, clearSelection, showToast]);

  // Render function for program rows
  const renderProgramRow = useCallback((program: Program, { isSelected: _isSelected }: RowRenderProps) => (
    <ProgramRowContent program={program} visibleColumns={visibleColumns} />
  ), [visibleColumns]);

  // Empty state
  const emptyState = useMemo(() => (
    <div className="text-center">
      <p className="text-muted">No programs yet</p>
      <button
        onClick={handleCreateProgram}
        disabled={creating}
        className="mt-2 text-sm text-accent hover:underline disabled:opacity-50"
      >
        Create your first program
      </button>
    </div>
  ), [creating, handleCreateProgram]);

  return (
    <div className="flex h-full flex-col">
      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <ProgramBulkActionBar
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Programs</h1>
        <DocumentListToolbar
          sortOptions={SORT_OPTIONS}
          sortBy={sortBy}
          onSortChange={setSortBy}
          allColumns={ALL_COLUMNS}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          hiddenCount={hiddenCount}
          showColumnPicker={true}
          createButton={{
            label: creating ? 'Creating...' : 'New Program',
            onClick: handleCreateProgram,
          }}
        />
      </div>

      {/* Programs List */}
      <div className="flex-1 overflow-auto pb-20">
        <SelectableList
          items={sortedPrograms}
          loading={loading}
          renderRow={renderProgramRow}
          columns={columns}
          emptyState={emptyState}
          onItemClick={(program) => navigate(`/documents/${program.id}`)}
          selectable={true}
          onSelectionChange={handleSelectionChange}
          onContextMenu={handleContextMenu}
          ariaLabel="Programs list"
        />
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={handleBulkArchive}>
            <ArchiveIcon className="h-4 w-4" />
            Archive {selectedIds.size > 1 ? `${selectedIds.size} programs` : 'program'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleBulkDelete} destructive>
            <TrashIcon className="h-4 w-4" />
            Delete {selectedIds.size > 1 ? `${selectedIds.size} programs` : 'program'}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

/**
 * ProgramBulkActionBar - Simplified bulk action bar for programs (Archive + Delete only)
 */
interface ProgramBulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function ProgramBulkActionBar({
  selectedCount,
  onClearSelection,
  onArchive,
  onDelete,
}: ProgramBulkActionBarProps) {
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

/**
 * ProgramRowContent - Renders the content cells for a program row
 */
interface ProgramRowContentProps {
  program: Program;
  visibleColumns: Set<string>;
}

function ProgramRowContent({ program, visibleColumns }: ProgramRowContentProps) {
  return (
    <>
      {/* Name (with emoji/color badge) */}
      {visibleColumns.has('name') && (
        <td className="px-4 py-3" role="gridcell">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-md text-sm flex-shrink-0"
              style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
            >
              {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
            </div>
            <span className="text-sm text-foreground font-medium truncate">{program.name}</span>
          </div>
        </td>
      )}
      {/* Owner */}
      {visibleColumns.has('owner') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.owner ? (
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-white flex-shrink-0">
                {getInitials(program.owner.name)}
              </div>
              <span className="truncate">{program.owner.name}</span>
            </div>
          ) : (
            <span className="text-muted/50">—</span>
          )}
        </td>
      )}
      {/* Issue Count */}
      {visibleColumns.has('issue_count') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.issue_count ?? 0}
        </td>
      )}
      {/* Sprint Count */}
      {visibleColumns.has('sprint_count') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.sprint_count ?? 0}
        </td>
      )}
      {/* Created */}
      {visibleColumns.has('created') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.created_at ? formatDate(program.created_at) : '—'}
        </td>
      )}
      {/* Updated */}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.updated_at ? formatDate(program.updated_at) : '—'}
        </td>
      )}
    </>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Icons
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
