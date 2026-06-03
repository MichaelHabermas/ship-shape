import { useDraggable } from '@dnd-kit/core';
import { HighlightedText } from './HighlightedText';
import { getInitials, type OrgTreeNode } from './org-chart-tree';

const INDENT_PX = 24;

export function OrgChartRow({
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
