import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { apiGet, apiPatch, readJson } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { DroppableRow } from './org-chart/DroppableRow';
import { NoSupervisorDropZone } from './org-chart/NoSupervisorDropZone';
import { OrgChartRow } from './org-chart/OrgChartRow';
import {
  buildTree,
  collectAncestorIds,
  findNode,
  flattenTree,
  getDescendantIds,
  getInitials,
  type PersonData,
} from './org-chart/org-chart-tree';

export function OrgChartPage() {
  const navigate = useNavigate();
  const { isWorkspaceAdmin } = useWorkspace();
  const [people, setPeople] = useState<PersonData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [preSearchExpanded, setPreSearchExpanded] = useState<Set<string> | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; undoFn: (() => void) | null } | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canDrag = isWorkspaceAdmin;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Fetch people
  const fetchPeople = useCallback(async () => {
    try {
      const res = await apiGet('/api/team/people');
      if (res.ok) {
        const data = await readJson<PersonData[]>(res);
        setPeople(data.filter((p: PersonData) => !p.isPending && !p.isArchived));
      }
    } catch (err) {
      console.error('Failed to fetch people:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPeople(); }, [fetchPeople]);

  // Build tree
  const tree = useMemo(() => buildTree(people), [people]);

  // Compute invalid drop targets when dragging
  const invalidDropIds = useMemo(() => {
    if (!activeId) return new Set<string>();
    const activeNode = findNode(tree, activeId);
    if (!activeNode) return new Set<string>();
    const descendants = getDescendantIds(activeNode);
    descendants.add(activeId); // can't drop on yourself
    return descendants;
  }, [activeId, tree]);

  // Set default expanded (first 2 levels) once tree is built
  useEffect(() => {
    if (tree.length > 0 && expandedIds.size === 0) {
      const defaultExpanded = new Set<string>();
      for (const root of tree) {
        defaultExpanded.add(root.personId);
        for (const child of root.children) {
          defaultExpanded.add(child.personId);
        }
      }
      setExpandedIds(defaultExpanded);
    }
  }, [tree]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search
  const searchMatches = useMemo(() => {
    if (!debouncedQuery.trim()) return null;
    const q = debouncedQuery.toLowerCase();
    const matchIds = new Set<string>();
    for (const p of people) {
      if (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) {
        matchIds.add(p.id);
      }
    }
    return matchIds;
  }, [debouncedQuery, people]);

  // Auto-expand ancestors when searching
  useEffect(() => {
    if (searchMatches !== null) {
      if (!preSearchExpanded) {
        setPreSearchExpanded(new Set(expandedIds));
      }
      if (searchMatches.size > 0) {
        const ancestorIds = collectAncestorIds(people, searchMatches);
        setExpandedIds(new Set([...ancestorIds, ...searchMatches]));
      }
    } else if (preSearchExpanded) {
      setExpandedIds(preSearchExpanded);
      setPreSearchExpanded(null);
    }
  }, [searchMatches]);

  const flatRows = useMemo(() => {
    const rows = flattenTree(tree, expandedIds);
    if (searchMatches === null) return rows;
    if (searchMatches.size === 0) return [];
    const ancestorIds = collectAncestorIds(people, searchMatches);
    const visibleIds = new Set([...searchMatches, ...ancestorIds]);
    return rows.filter(row => visibleIds.has(row.node.personId));
  }, [tree, expandedIds, searchMatches, people]);

  const toggleExpand = useCallback((personId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const rows = flatRows;
    if (rows.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, rows.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
        break;
      case 'ArrowRight': {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (row && row.hasChildren && !row.isExpanded) {
          toggleExpand(row.node.personId);
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (row && row.isExpanded) {
          toggleExpand(row.node.personId);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (row) navigate(`/team/${row.node.personId}`);
        break;
      }
    }
  }, [flatRows, focusedIndex, toggleExpand, navigate]);

  // Scroll focused item into view
  useEffect(() => {
    if (treeRef.current) {
      const items = treeRef.current.querySelectorAll('[role="treeitem"]');
      items[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  // Show toast with auto-dismiss
  const showToast = useCallback((message: string, undoFn: (() => void) | null) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, undoFn });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const draggedPersonId = String(active.id);
    const overId = String(over.id);

    // Determine target
    const isNoSupervisor = overId === 'drop-no-supervisor';
    const targetPersonId = isNoSupervisor ? null : overId.replace('drop-', '');

    // Find the dragged person
    const draggedPerson = people.find(p => p.id === draggedPersonId);
    if (!draggedPerson) return;

    // Find target person (for the new reports_to user_id)
    let newReportsTo: string | null = null;
    let targetName = 'No supervisor';
    if (targetPersonId) {
      const targetNode = findNode(tree, targetPersonId);
      if (!targetNode || !targetNode.userId) return;
      // Don't drop on self or descendants (already prevented via disabled, but double-check)
      if (invalidDropIds.has(targetPersonId)) return;
      newReportsTo = targetNode.userId;
      targetName = targetNode.name;
    }

    // Don't update if nothing changed
    const currentReportsTo = draggedPerson.reportsTo || null;
    if (currentReportsTo === newReportsTo) return;

    // Optimistically update local state
    const previousReportsTo = currentReportsTo;
    setPeople(prev => prev.map(p =>
      p.id === draggedPersonId ? { ...p, reportsTo: newReportsTo } : p,
    ));

    // Call API
    try {
      const res = await apiPatch(`/api/documents/${draggedPersonId}`, {
        properties: { reports_to: newReportsTo },
      });
      if (!res.ok) throw new Error('Failed to update');

      const undoFn = async () => {
        setPeople(prev => prev.map(p =>
          p.id === draggedPersonId ? { ...p, reportsTo: previousReportsTo } : p,
        ));
        try {
          await apiPatch(`/api/documents/${draggedPersonId}`, {
            properties: { reports_to: previousReportsTo },
          });
        } catch {
          // If undo fails, refetch
          fetchPeople();
        }
      };

      const message = isNoSupervisor
        ? `${draggedPerson.name} removed from reporting chain`
        : `${draggedPerson.name} now reports to ${targetName}`;
      showToast(message, undoFn);
    } catch {
      // Revert optimistic update
      setPeople(prev => prev.map(p =>
        p.id === draggedPersonId ? { ...p, reportsTo: previousReportsTo } : p,
      ));
      showToast('Failed to update reporting relationship', null);
    }
  }, [people, tree, invalidDropIds, fetchPeople, showToast]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  // Find the active node for drag overlay
  const activeNode = activeId ? findNode(tree, activeId) : null;

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-10 items-center border-b border-border px-4">
          <h1 className="text-sm font-medium text-foreground">Org Chart</h1>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  const matchCount = searchMatches?.size ?? null;

  const treeContent = (
    <>
      {/* No supervisor drop zone */}
      {canDrag && activeId && <NoSupervisorDropZone />}

      {flatRows.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted">
            {searchMatches ? 'No matching people found' : 'No reporting hierarchy configured'}
          </p>
        </div>
      ) : (
        <ul
          ref={treeRef}
          role="tree"
          aria-label="Organization chart"
          onKeyDown={handleKeyDown}
          className="space-y-px"
        >
          {flatRows.map((row, index) => {
            const { node, depth, isExpanded, hasChildren } = row;
            const isFocused = index === focusedIndex;
            const isMatch = searchMatches?.has(node.personId);
            const isInvalidTarget = invalidDropIds.has(node.personId);

            return (
              <DroppableRow
                key={node.personId}
                personId={node.personId}
                disabled={!canDrag || isInvalidTarget}
              >
                {({ isOver }) => (
                  <OrgChartRow
                    node={node}
                    depth={depth}
                    isExpanded={isExpanded}
                    hasChildren={hasChildren}
                    isFocused={isFocused}
                    isMatch={isMatch}
                    isOver={isOver && !isInvalidTarget}
                    isDragging={activeId === node.personId}
                    isInvalidTarget={isInvalidTarget && activeId !== null}
                    canDrag={canDrag}
                    searchMatches={searchMatches}
                    debouncedQuery={debouncedQuery}
                    onFocus={() => setFocusedIndex(index)}
                    onToggleExpand={toggleExpand}
                    onNavigate={navigate}
                  />
                )}
              </DroppableRow>
            );
          })}
        </ul>
      )}
    </>
  );

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex h-10 items-center gap-3 border-b border-border px-4">
        <h1 className="text-sm font-medium text-foreground">Org Chart</h1>
        <span className="text-xs text-muted">{people.length} people</span>
      </header>

      {/* Search */}
      <div className="border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search people..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          {matchCount !== null && (
            <span className="text-xs text-muted">
              {matchCount === 0 ? 'No results' : `${matchCount} result${matchCount !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="relative flex-1 overflow-auto p-2">
        {canDrag ? (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {treeContent}
            <DragOverlay dropAnimation={null}>
              {activeNode && (
                <div className="flex items-center gap-2 rounded-md bg-surface border border-accent px-3 py-1.5 text-sm shadow-lg">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-white">
                    {getInitials(activeNode.name)}
                  </div>
                  <span className="font-medium text-foreground">{activeNode.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          treeContent
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm shadow-lg">
          <span className="text-foreground">{toast.message}</span>
          {toast.undoFn && (
            <button
              onClick={() => {
                toast.undoFn?.();
                setToast(null);
                if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
              }}
              className="font-medium text-accent hover:underline"
            >
              Undo
            </button>
          )}
          <button
            onClick={() => {
              setToast(null);
              if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
            }}
            className="text-muted hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
