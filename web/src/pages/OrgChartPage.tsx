import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { apiGet, apiPatch, readJson } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';

const INDENT_PX = 24;

interface PersonData {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  role?: string | null;
  reportsTo?: string | null;
  isArchived?: boolean;
  isPending?: boolean;
}

interface OrgTreeNode {
  personId: string;
  userId: string | null;
  name: string;
  email: string;
  role: string | null;
  children: OrgTreeNode[];
}

interface FlatRow {
  node: OrgTreeNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
}

function buildTree(people: PersonData[]): OrgTreeNode[] {
  const byUserId = new Map<string, PersonData>();
  for (const p of people) {
    if (p.user_id) byUserId.set(p.user_id, p);
  }

  const nodeMap = new Map<string, OrgTreeNode>();
  for (const p of people) {
    nodeMap.set(p.id, {
      personId: p.id,
      userId: p.user_id,
      name: p.name,
      email: p.email,
      role: p.role || null,
      children: [],
    });
  }

  const roots: OrgTreeNode[] = [];

  for (const p of people) {
    const node = nodeMap.get(p.id);
    if (!node) continue;
    if (p.reportsTo) {
      const parent = byUserId.get(p.reportsTo);
      if (parent) {
        const parentNode = nodeMap.get(parent.id);
        if (parentNode) {
          parentNode.children.push(node);
          continue;
        }
      }
    }
    roots.push(node);
  }

  function sortChildren(nodes: OrgTreeNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortChildren(n.children);
  }
  sortChildren(roots);

  return roots;
}

function flattenTree(nodes: OrgTreeNode[], expandedIds: Set<string>, depth = 0): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    const isExpanded = expandedIds.has(node.personId);
    const hasChildren = node.children.length > 0;
    rows.push({ node, depth, isExpanded, hasChildren });
    if (isExpanded && hasChildren) {
      rows.push(...flattenTree(node.children, expandedIds, depth + 1));
    }
  }
  return rows;
}

function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

function collectAncestorIds(people: PersonData[], matchIds: Set<string>): Set<string> {
  const byUserId = new Map<string, PersonData>();
  for (const p of people) {
    if (p.user_id) byUserId.set(p.user_id, p);
  }

  const ancestorIds = new Set<string>();
  for (const p of people) {
    if (!matchIds.has(p.id)) continue;
    let current = p;
    while (current.reportsTo) {
      const parent = byUserId.get(current.reportsTo);
      if (!parent || ancestorIds.has(parent.id)) break;
      ancestorIds.add(parent.id);
      current = parent;
    }
  }
  return ancestorIds;
}

/** Collect all descendant personIds from a tree node */
function getDescendantIds(node: OrgTreeNode): Set<string> {
  const ids = new Set<string>();
  function walk(n: OrgTreeNode) {
    for (const child of n.children) {
      ids.add(child.personId);
      walk(child);
    }
  }
  walk(node);
  return ids;
}

/** Find a node by personId in the tree */
function findNode(nodes: OrgTreeNode[], personId: string): OrgTreeNode | null {
  for (const node of nodes) {
    if (node.personId === personId) return node;
    const found = findNode(node.children, personId);
    if (found) return found;
  }
  return null;
}

// --- Droppable row wrapper ---
function DroppableRow({
  personId,
  disabled,
  isOver,
  children,
}: {
  personId: string;
  disabled: boolean;
  isOver?: boolean;
  children: (props: { isOver: boolean }) => React.ReactNode;
}) {
  const { setNodeRef, isOver: dndIsOver } = useDroppable({
    id: `drop-${personId}`,
    disabled,
    data: { personId },
  });
  return <div ref={setNodeRef}>{children({ isOver: isOver ?? dndIsOver })}</div>;
}

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

// --- "No supervisor" drop zone ---
function NoSupervisorDropZone() {
  const { setNodeRef, isOver } = useDroppable({
    id: 'drop-no-supervisor',
    data: { personId: null },
  });

  return (
    <div
      ref={setNodeRef}
      className={`mb-2 flex items-center justify-center rounded-md border-2 border-dashed px-4 py-2 text-xs transition-colors ${
        isOver
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border/50 text-muted'
      }`}
    >
      Drop here to remove supervisor
    </div>
  );
}

// --- Individual org chart row (supports dragging) ---
function OrgChartRow({
  node,
  depth,
  isExpanded,
  hasChildren,
  isFocused,
  isMatch,
  isOver,
  isDragging,
  isInvalidTarget,
  canDrag,
  searchMatches,
  debouncedQuery,
  onFocus,
  onToggleExpand,
  onNavigate,
}: {
  node: OrgTreeNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  isFocused: boolean;
  isMatch: boolean | undefined;
  isOver: boolean;
  isDragging: boolean;
  isInvalidTarget: boolean;
  canDrag: boolean;
  searchMatches: Set<string> | null;
  debouncedQuery: string;
  onFocus: () => void;
  onToggleExpand: (id: string) => void;
  onNavigate: (path: string) => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: node.personId,
    disabled: !canDrag,
    data: { personId: node.personId },
  });

  // Exclude role and tabIndex from dnd-kit attributes — we set our own for the tree
  const { role: _role, tabIndex: _tabIndex, ...dragAttributes } = attributes;

  const style = transform ? { opacity: 0.5 } : undefined;

  return (
    <li
      ref={setDragRef}
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-level={depth + 1}
      tabIndex={isFocused ? 0 : -1}
      onFocus={onFocus}
      className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
        isOver ? 'bg-accent/15 ring-1 ring-accent' : ''
      } ${isDragging ? 'opacity-50' : ''} ${
        isInvalidTarget ? 'opacity-30' : ''
      } ${isFocused && !isOver ? 'bg-border/50' : ''} ${
        !isFocused && !isOver ? 'hover:bg-border/30' : ''
      } ${isMatch ? 'ring-1 ring-accent/50' : ''}`}
      style={{ paddingLeft: depth * INDENT_PX + 8, ...style }}
      {...(canDrag ? dragAttributes : {})}
      {...(canDrag ? listeners : {})}
    >
      {/* Expand/collapse chevron */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleExpand(node.personId); }}
        onPointerDown={(e) => e.stopPropagation()}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-transform ${
          hasChildren ? 'text-muted hover:text-foreground' : 'invisible'
        }`}
        tabIndex={-1}
        aria-hidden="true"
      >
        <svg
          className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Avatar */}
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-white">
        {getInitials(node.name)}
      </div>

      {/* Two-line content area */}
      <div className="min-w-0 flex-1">
        {/* Line 1: Name + Role */}
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => onNavigate(`/team/${node.personId}`)}
            onPointerDown={(e) => e.stopPropagation()}
            className="truncate font-medium text-foreground hover:text-accent hover:underline"
            tabIndex={-1}
          >
            {searchMatches && debouncedQuery ? (
              <HighlightedText text={node.name} query={debouncedQuery} />
            ) : (
              node.name
            )}
          </button>
          {node.role && (
            <span className="truncate text-xs text-muted">
              {searchMatches && debouncedQuery ? (
                <HighlightedText text={node.role} query={debouncedQuery} />
              ) : (
                node.role
              )}
            </span>
          )}
          {hasChildren && (
            <span className="ml-auto shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {node.children.length} report{node.children.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {/* Line 2: Email */}
        <div className="text-xs text-muted">
          {searchMatches && debouncedQuery ? (
            <HighlightedText text={node.email} query={debouncedQuery} />
          ) : (
            node.email
          )}
        </div>
      </div>
    </li>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-500/20 text-foreground">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
