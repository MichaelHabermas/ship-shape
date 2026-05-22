import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import type { IssueListItem } from '@/api/schemas';
import type { IssueState } from '@ship/shared';

interface ContextMenuEvent {
  x: number;
  y: number;
  issueId: string;
}

interface KanbanBoardProps {
  issues: IssueListItem[];
  onUpdateIssue: (id: string, updates: { state: IssueState }) => Promise<void>;
  onIssueClick: (id: string) => void;
  // Selection props
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  onCheckboxClick?: (id: string, e: React.MouseEvent) => void;
  // Context menu props
  onContextMenu?: (event: ContextMenuEvent) => void;
  // Disable drag-drop (for historical/read-only views)
  disabled?: boolean;
}

const COLUMNS = [
  { id: 'backlog', title: 'Backlog', color: 'bg-gray-500' },
  { id: 'todo', title: 'Todo', color: 'bg-blue-500' },
  { id: 'in_progress', title: 'In Progress', color: 'bg-yellow-500' },
  { id: 'in_review', title: 'In Review', color: 'bg-cyan-500' },
  { id: 'done', title: 'Done', color: 'bg-green-500' },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-blue-500',
  none: 'border-l-transparent',
};

export function KanbanBoard({
  issues,
  onUpdateIssue,
  onIssueClick,
  selectedIds = new Set(),
  onCheckboxClick,
  onContextMenu,
  disabled = false,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getIssuesByColumn = (columnId: string) => {
    return issues.filter((issue) => issue.state === columnId);
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (disabled) return;
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (disabled) return;

    if (!over) return;

    const activeIssue = issues.find((i) => i.id === active.id);
    if (!activeIssue) return;

    // Determine target column
    let targetColumn: string | null = null;

    // Check if dropped on a column
    if (COLUMNS.some((col) => col.id === over.id)) {
      targetColumn = over.id as string;
    } else {
      // Dropped on another issue - find its column
      const overIssue = issues.find((i) => i.id === over.id);
      if (overIssue) {
        targetColumn = overIssue.state;
      }
    }

    if (targetColumn && targetColumn !== activeIssue.state) {
      onUpdateIssue(activeIssue.id, { state: targetColumn as IssueState });
    }
  };

  const activeIssue = activeId ? issues.find((i) => i.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        role="application"
        aria-label="Kanban board with keyboard navigation. Use Tab to navigate between issues, Space or Enter to pick up an issue, arrow keys to move, and Space or Enter to drop."
        aria-roledescription="sortable kanban board"
        className="flex h-full gap-4 overflow-x-auto p-4"
      >
        {COLUMNS.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            issues={getIssuesByColumn(column.id)}
            onIssueClick={onIssueClick}
            selectedIds={selectedIds}
            onCheckboxClick={onCheckboxClick}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
      <DragOverlay>
        {activeIssue ? <IssueCard issue={activeIssue} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  column,
  issues,
  onIssueClick,
  selectedIds,
  onCheckboxClick,
  onContextMenu,
}: {
  column: { id: string; title: string; color: string };
  issues: IssueListItem[];
  onIssueClick: (id: string) => void;
  selectedIds: Set<string>;
  onCheckboxClick?: (id: string, e: React.MouseEvent) => void;
  onContextMenu?: (event: ContextMenuEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div className={cn(
      "flex w-72 flex-shrink-0 flex-col rounded-lg bg-border/30",
      isOver && "ring-2 ring-accent ring-inset"
    )}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          data-status-indicator
          data-status={column.id}
          aria-label={`Status: ${column.title}`}
          className="inline-flex items-center"
        >
          <ColumnStatusIcon state={column.id} color={column.color} />
          <span className="sr-only">Status: {column.title}</span>
        </span>
        <span className="text-sm font-medium text-foreground">{column.title}</span>
        <span className="ml-auto text-xs text-muted">{issues.length}</span>
      </div>
      <ul
        ref={setNodeRef}
        className="flex flex-1 flex-col gap-2 overflow-auto p-2 pb-20 list-none m-0"
        aria-label={`${column.title} issues`}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <li key={issue.id} className="list-none">
              <SortableIssueCard
                issue={issue}
                onClick={() => onIssueClick(issue.id)}
                isSelected={selectedIds.has(issue.id)}
                onCheckboxClick={onCheckboxClick ? (e) => onCheckboxClick(issue.id, e) : undefined}
                onContextMenu={onContextMenu}
              />
            </li>
          ))}
        </SortableContext>
        {issues.length === 0 && (
          <li className="flex h-20 items-center justify-center text-xs text-muted list-none">
            Drop issues here
          </li>
        )}
      </ul>
    </div>
  );
}

function SortableIssueCard({
  issue,
  onClick,
  isSelected,
  onCheckboxClick,
  onContextMenu,
}: {
  issue: IssueListItem;
  onClick: () => void;
  isSelected?: boolean;
  onCheckboxClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (event: ContextMenuEvent) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.({ x: e.clientX, y: e.clientY, issueId: issue.id });
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onContextMenu?.({ x: rect.right, y: rect.bottom, issueId: issue.id });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      draggable="true"
      data-draggable
      data-issue
      data-dragging={isDragging ? 'true' : undefined}
      data-selected={isSelected ? 'true' : undefined}
      aria-grabbed={isDragging ? 'true' : 'false'}
      aria-selected={isSelected}
      tabIndex={0}
      role="button"
      aria-roledescription="draggable issue"
      aria-label={`${issue.ticket_number ? `Issue #${issue.ticket_number}` : 'Issue'}: ${issue.title}. Press Space to pick up and move.`}
      className={cn(isDragging && 'opacity-50', 'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background rounded-md')}
    >
      <IssueCard issue={issue} isSelected={isSelected} onCheckboxClick={onCheckboxClick} onMenuClick={handleMenuClick} />
    </div>
  );
}

function IssueCard({
  issue,
  isDragging,
  isSelected,
  onCheckboxClick,
  onMenuClick,
}: {
  issue: IssueListItem;
  isDragging?: boolean;
  isSelected?: boolean;
  onCheckboxClick?: (e: React.MouseEvent) => void;
  onMenuClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        'group cursor-pointer rounded-md border-l-2 bg-background p-3 shadow-sm transition-shadow hover:shadow-md relative',
        PRIORITY_COLORS[issue.priority] || PRIORITY_COLORS.none,
        isDragging && 'shadow-lg',
        isSelected && 'ring-2 ring-accent bg-accent/10'
      )}
    >
      {/* Hover-reveal controls */}
      <div
        className={cn(
          'absolute top-2 right-2 flex items-center gap-1 transition-opacity',
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        {/* Three-dot menu button */}
        {onMenuClick && (
          <Tooltip content="More actions">
            <button
              type="button"
              onClick={onMenuClick}
              className="p-0.5 rounded hover:bg-border/50 text-muted hover:text-foreground"
              aria-label={`More actions for ${issue.ticket_number ? `issue #${issue.ticket_number}` : 'issue'}`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </Tooltip>
        )}
        {/* Checkbox */}
        {onCheckboxClick && (
          <input
            type="checkbox"
            checked={isSelected ?? false}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              onCheckboxClick(e);
            }}
            aria-label={`Select ${issue.ticket_number ? `issue #${issue.ticket_number}` : 'issue'}`}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent cursor-pointer"
          />
        )}
      </div>
      {issue.ticket_number && <div className="mb-1 text-xs text-muted">#{issue.ticket_number}</div>}
      <div className="text-sm text-foreground">{issue.title}</div>
      {issue.assignee_name && (
        <div className={cn("mt-2 flex items-center gap-1", issue.assignee_archived && "opacity-50")}>
          <div className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white",
            issue.assignee_archived ? "bg-gray-400" : "bg-accent/50"
          )}>
            {issue.assignee_name.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs text-muted">
            {issue.assignee_name}{issue.assignee_archived && ' (archived)'}
          </span>
        </div>
      )}
    </div>
  );
}

function ColumnStatusIcon({ state, color }: { state: string; color: string }) {
  const colorClass = color.replace('bg-', 'text-').replace('-500', '-400');
  const iconProps = { className: cn('h-3 w-3', colorClass), 'aria-hidden': 'true' as const };

  switch (state) {
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
          <path d="M8 2 A6 6 0 1 1 8 14" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'done':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="6" />
          <path d="M5.5 8l2 2 3-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
