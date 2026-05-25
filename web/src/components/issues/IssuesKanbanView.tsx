import type { IssueListItem } from '@/api/schemas';
import type { IssueState } from '@ship/shared';
import { KanbanBoard } from '@/components/KanbanBoard';

export interface IssuesKanbanViewProps {
  issues: IssueListItem[];
  selectedIds: Set<string>;
  onUpdateIssue?: (id: string, updates: { state: IssueState }) => Promise<void>;
  onIssueClick: (id: string) => void;
  onCheckboxClick: (id: string, e: React.MouseEvent) => void;
  onContextMenu: (event: { x: number; y: number; issueId: string }) => void;
}

export function IssuesKanbanView({
  issues,
  selectedIds,
  onUpdateIssue,
  onIssueClick,
  onCheckboxClick,
  onContextMenu,
}: IssuesKanbanViewProps) {
  return (
    <KanbanBoard
      issues={issues}
      onUpdateIssue={onUpdateIssue ?? (async () => {})}
      onIssueClick={onIssueClick}
      selectedIds={selectedIds}
      onCheckboxClick={onCheckboxClick}
      onContextMenu={onContextMenu}
    />
  );
}
