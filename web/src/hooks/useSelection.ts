import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

export interface UseSelectionOptions<T> {
  items: T[];
  getItemId: (item: T) => string;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  /** Optional hovered ID - used as anchor for Shift+Arrow when nothing is selected */
  hoveredId?: string | null;
  /** Initial selected IDs - for restoring selection after navigation */
  initialSelectedIds?: Set<string>;
}

export interface UseSelectionReturn {
  // State
  selectedIds: Set<string>;
  focusedId: string | null;

  // Actions
  toggleSelection: (id: string) => void;
  toggleInGroup: (id: string) => void;
  selectRange: (targetId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setFocusedId: (id: string | null) => void;

  // Keyboard navigation
  moveFocus: (direction: 'up' | 'down' | 'home' | 'end') => void;
  extendSelection: (direction: 'up' | 'down' | 'home' | 'end') => void;

  // Derived state
  isSelected: (id: string) => boolean;
  isFocused: (id: string) => boolean;
  selectedCount: number;
  hasSelection: boolean;

  // Event handlers
  handleClick: (id: string, e: React.MouseEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useSelection<T>({
  items,
  getItemId,
  onSelectionChange,
  hoveredId,
  initialSelectedIds,
}: UseSelectionOptions<T>): UseSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => initialSelectedIds || new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  const lastSelectedIdRef = useRef<string | null>(null);

  // Get ordered list of IDs for navigation
  const itemIds = useMemo(() => items.map(getItemId), [items, getItemId]);

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);

  const updateFocusedId = useCallback((id: string | null) => {
    focusedIdRef.current = id;
    setFocusedId(id);
  }, []);

  const updateLastSelectedId = useCallback((id: string | null) => {
    lastSelectedIdRef.current = id;
  }, []);

  // Toggle selection of a single item (Enter/Space or simple click)
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    updateLastSelectedId(id);
  }, [updateLastSelectedId]);

  // Toggle item in group (Cmd/Ctrl+click) - adds/removes without affecting others
  const toggleInGroup = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    updateLastSelectedId(id);
  }, [updateLastSelectedId]);

  // Select range from last selected to target (Shift+click)
  const selectRange = useCallback((targetId: string) => {
    const currentLastSelectedId = lastSelectedIdRef.current;
    if (!currentLastSelectedId) {
      toggleSelection(targetId);
      return;
    }

    const startIdx = itemIds.indexOf(currentLastSelectedId);
    const endIdx = itemIds.indexOf(targetId);

    if (startIdx === -1 || endIdx === -1) {
      toggleSelection(targetId);
      return;
    }

    const [start, end] = startIdx < endIdx
      ? [startIdx, endIdx]
      : [endIdx, startIdx];

    setSelectedIds(prev => {
      const next = new Set(prev);
      for (let i = start; i <= end; i++) {
        next.add(itemIds[i]);
      }
      return next;
    });
  }, [itemIds, toggleSelection]);

  // Select all visible items
  const selectAll = useCallback(() => {
    setSelectedIds(prev => {
      // If all are already selected, deselect all
      const allSelected = itemIds.every(id => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(itemIds);
    });
  }, [itemIds]);

  // Clear all selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    updateLastSelectedId(null);
  }, [updateLastSelectedId]);

  // Move focus without changing selection
  const moveFocus = useCallback((direction: 'up' | 'down' | 'home' | 'end') => {
    if (itemIds.length === 0) {
      return;
    }

    const currentId = focusedIdRef.current;
    const currentIdx = currentId ? itemIds.indexOf(currentId) : -1;

    let newFocusedId: string | null = currentId;
    switch (direction) {
      case 'up':
        if (currentIdx <= 0) newFocusedId = itemIds[0];
        else newFocusedId = itemIds[currentIdx - 1];
        break;
      case 'down':
        if (currentIdx === -1) newFocusedId = itemIds[0];
        else if (currentIdx >= itemIds.length - 1) newFocusedId = itemIds[itemIds.length - 1];
        else newFocusedId = itemIds[currentIdx + 1];
        break;
      case 'home':
        newFocusedId = itemIds[0];
        break;
      case 'end':
        newFocusedId = itemIds[itemIds.length - 1];
        break;
      default:
        newFocusedId = currentId;
    }
    updateFocusedId(newFocusedId);
  }, [itemIds, updateFocusedId]);

  // Extend selection with arrow keys (Shift+Arrow)
  const extendSelection = useCallback((direction: 'up' | 'down' | 'home' | 'end') => {
    if (itemIds.length === 0) return;

    // Determine anchor point (where selection started)
    // Priority: lastSelectedId > focusedId > hoveredId > first item
    const currentFocusedId = focusedIdRef.current;
    const currentLastSelectedId = lastSelectedIdRef.current;
    const anchor = currentLastSelectedId || currentFocusedId || hoveredId || itemIds[0];
    const anchorIdx = itemIds.indexOf(anchor);
    if (anchorIdx === -1) return;

    // Get current position - use hovered position if nothing else is set
    const currentIdx = currentFocusedId
      ? itemIds.indexOf(currentFocusedId)
      : hoveredId
        ? itemIds.indexOf(hoveredId)
        : anchorIdx;

    let newIdx: number;
    switch (direction) {
      case 'up':
        newIdx = Math.max(0, currentIdx - 1);
        break;
      case 'down':
        newIdx = Math.min(itemIds.length - 1, currentIdx + 1);
        break;
      case 'home':
        newIdx = 0;
        break;
      case 'end':
        newIdx = itemIds.length - 1;
        break;
      default:
        return;
    }

    // Select range from anchor to new position
    const [start, end] = anchorIdx < newIdx
      ? [anchorIdx, newIdx]
      : [newIdx, anchorIdx];

    setSelectedIds(() => {
      const next = new Set<string>();
      for (let i = start; i <= end; i++) {
        next.add(itemIds[i]);
      }
      return next;
    });

    updateFocusedId(itemIds[newIdx]);

    // Keep lastSelectedId at anchor for continued range operations
    if (!currentLastSelectedId) {
      updateLastSelectedId(anchor);
    }
  }, [itemIds, hoveredId, updateFocusedId, updateLastSelectedId]);

  // Derived state
  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);
  const isFocused = useCallback((id: string) => focusedId === id, [focusedId]);
  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  // Click handler that handles modifiers
  const handleClick = useCallback((id: string, e: React.MouseEvent) => {
    const isCtrlKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    if (isShiftKey) {
      selectRange(id);
    } else if (isCtrlKey) {
      toggleInGroup(id);
    } else {
      // Simple click - toggle this item only
      setSelectedIds(prev => {
        const next = new Set<string>();
        if (!prev.has(id)) {
          next.add(id);
        }
        return next;
      });
      updateLastSelectedId(id);
    }

    updateFocusedId(id);
  }, [selectRange, toggleInGroup, updateFocusedId, updateLastSelectedId]);

  // Keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isCtrlKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    switch (e.key) {
      case 'ArrowUp':
      case 'k': // Vim-style navigation
        e.preventDefault();
        e.stopPropagation(); // Prevent global listener from also handling
        if (isShiftKey) {
          extendSelection('up');
        } else {
          moveFocus('up');
        }
        break;

      case 'ArrowDown':
      case 'j': // Vim-style navigation
        e.preventDefault();
        e.stopPropagation(); // Prevent global listener from also handling
        if (isShiftKey) {
          extendSelection('down');
        } else {
          moveFocus('down');
        }
        break;

      case 'Home':
        e.preventDefault();
        e.stopPropagation(); // Prevent global listener from also handling
        if (isShiftKey) {
          extendSelection('home');
        } else {
          moveFocus('home');
        }
        break;

      case 'End':
        e.preventDefault();
        e.stopPropagation(); // Prevent global listener from also handling
        if (isShiftKey) {
          extendSelection('end');
        } else {
          moveFocus('end');
        }
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation(); // Prevent global listener from also handling
        if (focusedId) {
          if (isCtrlKey) {
            toggleInGroup(focusedId);
          } else {
            toggleSelection(focusedId);
          }
        }
        break;

      case 'a':
        if (isCtrlKey) {
          e.preventDefault();
          selectAll();
        }
        break;

      case 'Escape':
        e.preventDefault();
        clearSelection();
        break;
    }
  }, [
    focusedId,
    moveFocus,
    extendSelection,
    toggleSelection,
    toggleInGroup,
    selectAll,
    clearSelection,
  ]);

  return {
    selectedIds,
    focusedId,
    toggleSelection,
    toggleInGroup,
    selectRange,
    selectAll,
    clearSelection,
    setFocusedId: updateFocusedId,
    moveFocus,
    extendSelection,
    isSelected,
    isFocused,
    selectedCount,
    hasSelection,
    handleClick,
    handleKeyDown,
  };
}
