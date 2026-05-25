import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseSelectionReturn } from '@/components/SelectableList';
import { useSelectionPersistenceOptional } from '@/contexts/SelectionPersistenceContext';

export interface UseIssuesListSelectionInput {
  selectionPersistenceKey?: string;
  stateFilterChanged: boolean;
}

export function useIssuesListSelection({
  selectionPersistenceKey,
  stateFilterChanged,
}: UseIssuesListSelectionInput) {
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

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

  const handleSelectionChange = useCallback((newSelectedIds: Set<string>, newSelection: UseSelectionReturn) => {
    setSelectedIds(newSelectedIds);
    selectionRef.current = newSelection;
    forceUpdate(n => n + 1);
  }, []);

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
    setSelectedIds(prev => {
      if (!prev.has(event.issueId)) {
        return new Set([event.issueId]);
      }
      return prev;
    });
    setSelectedIds(current => {
      const effectiveIds = current.has(event.issueId) ? current : new Set([event.issueId]);
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
      return current.has(event.issueId) ? current : new Set([event.issueId]);
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, _item: unknown, selection: UseSelectionReturn) => {
    selectionRef.current = selection;
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
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
  };
}
