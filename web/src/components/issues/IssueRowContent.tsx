import { formatDate } from '@/lib/date-utils';
import type { IssueListItem } from '@/api/schemas';
import { getProgramTitle, getSprintId, getSprintTitle } from '@/hooks/useIssuesQuery';
import { InlineWeekSelector } from '@/components/InlineWeekSelector';
import { cn } from '@/lib/cn';
import { PriorityBadge, SourceBadge, StatusBadge } from '@/components/issues/issue-badges';

export interface IssueRowContentProps {
  issue: IssueListItem;
  visibleColumns: Set<string>;
  sprints?: { id: string; name: string }[];
  onSprintChange?: (issueId: string, sprintId: string | null) => void;
  isOutOfContext?: boolean;
  onAddToContext?: () => void;
}

export function IssueRowContent({
  issue,
  visibleColumns,
  sprints,
  onSprintChange,
  isOutOfContext,
  onAddToContext,
}: IssueRowContentProps) {
  const cellClass = isOutOfContext ? 'opacity-50' : '';

  return (
    <>
      {visibleColumns.has('id') && (
        <td className={cn('px-4 py-3 text-sm text-muted', cellClass)} role="gridcell">
          {issue.ticket_number ? `#${issue.ticket_number}` : ''}
        </td>
      )}
      {visibleColumns.has('title') && (
        <td className={cn('px-4 py-3 text-sm text-foreground', cellClass)} role="gridcell">
          <div className="flex items-center gap-2">
            <span className="truncate">{issue.title}</span>
            {isOutOfContext && onAddToContext && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToContext();
                }}
                className="flex-shrink-0 p-1 rounded hover:bg-accent/20 text-accent opacity-100 transition-colors"
                title="Add to current context"
                aria-label={`Add "${issue.title}" to context`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
            )}
          </div>
        </td>
      )}
      {visibleColumns.has('status') && (
        <td className={cn('px-4 py-3', cellClass)} role="gridcell">
          <StatusBadge state={issue.state} />
        </td>
      )}
      {visibleColumns.has('source') && (
        <td className={cn('px-4 py-3', cellClass)} role="gridcell">
          <SourceBadge source={issue.source} />
        </td>
      )}
      {visibleColumns.has('program') && (
        <td className={cn('px-4 py-3 text-sm text-muted', cellClass)} role="gridcell">
          {getProgramTitle(issue) || '—'}
        </td>
      )}
      {visibleColumns.has('sprint') && (
        <td className={cn('px-4 py-3 text-sm text-muted', cellClass)} role="gridcell">
          {sprints && onSprintChange ? (
            <InlineWeekSelector
              value={getSprintId(issue)}
              sprints={sprints}
              onChange={(sprintId) => onSprintChange(issue.id, sprintId)}
            />
          ) : (
            getSprintTitle(issue) || '—'
          )}
        </td>
      )}
      {visibleColumns.has('priority') && (
        <td className={cn('px-4 py-3', cellClass)} role="gridcell">
          <PriorityBadge priority={issue.priority} />
        </td>
      )}
      {visibleColumns.has('assignee') && (
        <td className={cn('px-4 py-3 text-sm text-muted', cellClass, issue.assignee_archived && 'opacity-50')} role="gridcell">
          {issue.assignee_name ? (
            <>
              {issue.assignee_name}{issue.assignee_archived && ' (archived)'}
            </>
          ) : 'Unassigned'}
        </td>
      )}
      {visibleColumns.has('updated') && (
        <td className={cn('px-4 py-3 text-sm text-muted', cellClass)} role="gridcell">
          {issue.updated_at ? formatDate(issue.updated_at) : '-'}
        </td>
      )}
    </>
  );
}
