import { useCallback } from 'react';
import type { IssueListItem } from '@/api/schemas';
import { SelectableList, type RowRenderProps, type UseSelectionReturn } from '@/components/SelectableList';
import type { ColumnDefinition } from '@/hooks/useColumnVisibility';
import { IssueRowContent } from '@/components/issues/IssueRowContent';

export interface IssuesTableViewProps {
  issues: IssueListItem[];
  columns: ColumnDefinition[];
  visibleColumns: Set<string>;
  emptyState: React.ReactNode;
  initialSelectedIds: Set<string>;
  onItemClick: (issue: IssueListItem) => void;
  onSelectionChange: (selectedIds: Set<string>, selection: UseSelectionReturn) => void;
  onContextMenu: (e: React.MouseEvent, item: IssueListItem, selection: UseSelectionReturn) => void;
  enableInlineSprintAssignment: boolean;
  availableSprints: { id: string; name: string }[];
  onInlineSprintChange: (issueId: string, sprintId: string | null) => void;
  allowShowAllIssues: boolean;
  showAllIssues: boolean;
  inContextIds: Set<string>;
  onAddIssueToContext: (issue: IssueListItem) => void;
}

export function IssuesTableView({
  issues,
  columns,
  visibleColumns,
  emptyState,
  initialSelectedIds,
  onItemClick,
  onSelectionChange,
  onContextMenu,
  enableInlineSprintAssignment,
  availableSprints,
  onInlineSprintChange,
  allowShowAllIssues,
  showAllIssues,
  inContextIds,
  onAddIssueToContext,
}: IssuesTableViewProps) {
  const renderIssueRow = useCallback((issue: IssueListItem, _row: RowRenderProps) => {
    const isOutOfContext = allowShowAllIssues && showAllIssues && !inContextIds.has(issue.id);
    return (
      <IssueRowContent
        issue={issue}
        visibleColumns={visibleColumns}
        sprints={enableInlineSprintAssignment ? availableSprints : undefined}
        onSprintChange={enableInlineSprintAssignment ? onInlineSprintChange : undefined}
        isOutOfContext={isOutOfContext}
        onAddToContext={isOutOfContext ? () => onAddIssueToContext(issue) : undefined}
      />
    );
  }, [
    visibleColumns,
    enableInlineSprintAssignment,
    availableSprints,
    onInlineSprintChange,
    allowShowAllIssues,
    showAllIssues,
    inContextIds,
    onAddIssueToContext,
  ]);

  return (
    <div className="flex-1 overflow-auto pb-20">
      <SelectableList
        items={issues}
        renderRow={renderIssueRow}
        columns={columns}
        emptyState={emptyState}
        onItemClick={onItemClick}
        onSelectionChange={onSelectionChange}
        onContextMenu={onContextMenu}
        ariaLabel="Issues list"
        initialSelectedIds={initialSelectedIds}
      />
    </div>
  );
}
