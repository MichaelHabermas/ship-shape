// Issue list context menu applies bulk issue actions from the current selection.
import type { IssueListItem } from '@/api/schemas';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import type { UseSelectionReturn } from '@/components/SelectableList';
import { ArrowUpRightIcon, TrashIcon } from '@/components/issues/issue-badges';
import { ISSUE_STATE_OPTIONS } from '@ship/shared';

export interface IssuesListContextMenuProps {
  x: number;
  y: number;
  selection: UseSelectionReturn;
  filteredIssues: IssueListItem[];
  showPromoteToProject: boolean;
  onClose: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onChangeStatus: (status: string) => void;
  onMoveToSprint: (sprintId: string | null) => void;
  onPromoteToProject: (issue: IssueListItem) => void;
}

export function IssuesListContextMenu({
  x,
  y,
  selection,
  filteredIssues,
  showPromoteToProject,
  onClose,
  onArchive,
  onDelete,
  onChangeStatus,
  onMoveToSprint,
  onPromoteToProject,
}: IssuesListContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <div className="px-3 py-1.5 text-xs text-muted border-b border-border mb-1">
        {Math.max(1, selection.selectedCount)} selected
      </div>
      <ContextMenuItem onClick={onArchive}>
        <ArchiveIcon className="h-4 w-4" />
        Archive
      </ContextMenuItem>
      <ContextMenuSubmenu label="Change Status">
        {ISSUE_STATE_OPTIONS.map((state) => (
          <ContextMenuItem key={state.value} onClick={() => onChangeStatus(state.value)}>
            {state.label}
          </ContextMenuItem>
        ))}
      </ContextMenuSubmenu>
      <ContextMenuSubmenu label="Move to Week">
        <ContextMenuItem onClick={() => onMoveToSprint(null)}>No Week</ContextMenuItem>
      </ContextMenuSubmenu>
      {showPromoteToProject && selection.selectedCount === 1 && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => {
            const selectedId = Array.from(selection.selectedIds)[0];
            const issue = filteredIssues.find(i => i.id === selectedId);
            if (issue) onPromoteToProject(issue);
          }}>
            <ArrowUpRightIcon className="h-4 w-4" />
            Promote to Project
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onDelete} destructive>
        <TrashIcon className="h-4 w-4" />
        Delete
      </ContextMenuItem>
    </ContextMenu>
  );
}
