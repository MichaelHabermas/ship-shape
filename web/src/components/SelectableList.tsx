import { useState, useCallback, useEffect, ReactNode } from 'react';
import { useSelection, UseSelectionReturn } from '@/hooks/useSelection';
import { cn } from '@/lib/cn';

export interface SelectableListProps<T extends { id: string }> {
  /** Items to display in the list */
  items: T[];

  /** Loading state - shows skeleton */
  loading?: boolean;

  /** Empty state content */
  emptyState?: ReactNode;

  /** Render function for each row's content (excluding checkbox) */
  renderRow: (item: T, props: RowRenderProps) => ReactNode;

  /** Get unique ID from item (defaults to item.id) */
  getItemId?: (item: T) => string;

  /** Enable selection features (checkboxes, multi-select) */
  selectable?: boolean;

  /** Initial selected IDs - for restoring selection after navigation */
  initialSelectedIds?: Set<string>;

  /** Callback when selection changes - receives both selectedIds and selection object */
  onSelectionChange?: (selectedIds: Set<string>, selection: UseSelectionReturn) => void;

  /** Callback when item is clicked (not checkbox) */
  onItemClick?: (item: T) => void;

  /** Callback when item is right-clicked (for context menu) */
  onContextMenu?: (e: React.MouseEvent, item: T, selection: UseSelectionReturn) => void;

  /** Table columns header */
  columns?: { key: string; label: string; className?: string }[];

  /** Aria label for the list */
  ariaLabel?: string;
}

export interface RowRenderProps {
  isSelected: boolean;
  isHovered: boolean;
  isFocused: boolean;
}

/**
 * SelectableList - Canonical component for lists with selection support
 *
 * Features:
 * - Hover-visible checkboxes
 * - Multi-select with Shift+Click (range) and Ctrl/Cmd+Click (toggle)
 * - Keyboard navigation (Arrow Up/Down, Shift+Arrow to extend)
 * - Space to toggle selection on focused row
 * - Escape to clear selection
 */
export function SelectableList<T extends { id: string }>({
  items,
  loading,
  emptyState,
  renderRow,
  getItemId = (item) => item.id,
  selectable = true,
  initialSelectedIds,
  onSelectionChange,
  onItemClick,
  onContextMenu,
  columns,
  ariaLabel = 'Selectable list',
}: SelectableListProps<T>) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const selection = useSelection({
    items,
    getItemId,
    hoveredId,
    initialSelectedIds,
  });

  // Notify parent of selection changes with both IDs and selection object
  // NOTE: We intentionally don't include moveFocus/extendSelection in dependencies
  // because extendSelection depends on focusedId, causing infinite loops when hover
  // changes focus. The parent receives fresh selection object on selectedIds/focusedId changes.
  useEffect(() => {
    onSelectionChange?.(selection.selectedIds, selection);
  }, [selection.selectedIds, selection.focusedId, onSelectionChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: T) => {
    e.preventDefault();
    const itemId = getItemId(item);

    // If right-clicked item is not selected, select only that item
    if (!selection.isSelected(itemId)) {
      selection.clearSelection();
      selection.handleClick(itemId, e);
    }

    onContextMenu?.(e, item, selection);
  }, [getItemId, selection, onContextMenu]);

  if (loading) {
    return <SelectableListSkeleton columns={columns?.length || 5} />;
  }

  if (items.length === 0 && emptyState) {
    return (
      <div className="flex h-full items-center justify-center">
        {emptyState}
      </div>
    );
  }

  return (
    <>
      <table
        className="w-full"
        role="grid"
        aria-multiselectable={selectable ? 'true' : undefined}
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={selectable ? selection.handleKeyDown : undefined}
        onMouseLeave={() => {
          // Clear focusedId when mouse leaves the table entirely.
          // This ensures pressing 'j' after mouse exits starts from the first row.
          setHoveredId(null);
          selection.setFocusedId(null);
        }}
      >
        {columns && (
          <thead className="sticky top-0 bg-background z-10">
            <tr className="border-b border-border text-left text-xs text-muted">
              {selectable && <th className="w-10 px-2 py-2" aria-label="Selection"></th>}
              {columns.map((col) => (
                <th key={col.key} className={cn('px-4 py-2 font-medium', col.className)}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {items.map((item) => {
            const itemId = getItemId(item);
            const isSelected = selection.isSelected(itemId);
            const isFocused = selection.isFocused(itemId);
            const isHovered = hoveredId === itemId;

            return (
              <SelectableRow
                key={itemId}
                itemId={itemId}
                isSelected={isSelected}
                isFocused={isFocused}
                isHovered={isHovered}
                selectable={selectable}
                onCheckboxClick={(e) => {
                  // Checkbox clicks should toggle without clearing selection
                  // (unlike row clicks which replace selection on plain click)
                  if (e.shiftKey) {
                    selection.selectRange(itemId);
                  } else {
                    selection.toggleSelection(itemId);
                  }
                }}
                onRowClick={() => onItemClick?.(item)}
                onFocus={() => selection.setFocusedId(itemId)}
                onMouseEnter={() => {
                  setHoveredId(itemId);
                  // Set focusedId on hover for Superhuman-style UX.
                  // When mouse leaves the table entirely (see onMouseLeave on <table>),
                  // focusedId is cleared so 'j' starts from the first row.
                  selection.setFocusedId(itemId);
                }}
                onMouseLeave={() => setHoveredId(null)}
                onContextMenu={(e) => handleContextMenu(e, item)}
              >
                {renderRow(item, { isSelected, isHovered, isFocused })}
              </SelectableRow>
            );
          })}
        </tbody>
      </table>

      {/* Selection announcer for screen readers */}
      <div
        id="selection-announcer"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {selection.hasSelection ? `${selection.selectedCount} items selected` : ''}
      </div>
    </>
  );
}

interface SelectableRowProps {
  itemId: string;
  isSelected: boolean;
  isFocused: boolean;
  isHovered: boolean;
  selectable: boolean;
  onCheckboxClick: (e: React.MouseEvent) => void;
  onRowClick: () => void;
  onFocus: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  children: ReactNode;
}

function SelectableRow({
  itemId,
  isSelected,
  isFocused,
  isHovered,
  selectable,
  onCheckboxClick,
  onRowClick,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
  children,
}: SelectableRowProps) {
  return (
    <tr
      role="row"
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      onClick={onRowClick}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
      data-selected={isSelected}
      data-focused={isFocused}
      className={cn(
        'group cursor-pointer border-b border-border/50 transition-colors',
        isSelected && 'bg-accent/10',
        isFocused && 'ring-2 ring-accent ring-inset',
        !isSelected && 'hover:bg-border/30'
      )}
    >
      {/* Checkbox cell */}
      {selectable && (
        <td className="w-10 px-2 py-3" role="gridcell">
          <div
            className={cn(
              'flex items-center justify-center transition-opacity',
              isSelected || isHovered ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                onCheckboxClick(e);
              }}
              aria-label={`Select item ${itemId}`}
              className={cn(
                'h-4 w-4 rounded flex items-center justify-center transition-all',
                'border focus:outline-none focus:ring-2 focus:ring-accent/50',
                isSelected
                  ? 'bg-accent border-accent text-white'
                  : 'border-muted/50 hover:border-muted bg-transparent'
              )}
            >
              {isSelected && (
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          </div>
        </td>
      )}
      {/* Row content - rendered by parent */}
      {children}
    </tr>
  );
}

function SelectableListSkeleton({ columns }: { columns: number }) {
  return (
    <div className="w-full animate-pulse">
      <div className="flex border-b border-border px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="flex-1 px-4">
            <div className="h-3 w-16 rounded bg-border/50" />
          </div>
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex border-b border-border/50 px-4 py-4">
          <div className="w-10 px-2">
            <div className="h-4 w-4 rounded bg-border/30" />
          </div>
          {Array.from({ length: columns }).map((_, colIdx) => (
            <div key={colIdx} className="flex-1 px-4">
              <div
                className="h-4 rounded bg-border/30"
                style={{ width: `${60 + Math.random() * 40}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Re-export useSelection for convenience
export { useSelection } from '@/hooks/useSelection';
export type { UseSelectionReturn } from '@/hooks/useSelection';
