import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import type { IssueListItem, Issue } from '@/contexts/IssuesContext';
import type { IssueState } from '@ship/shared';
import { cn } from '@/lib/cn';
import { ContextTreeNav } from '@/components/ContextTreeNav';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';

// Wrapper that shows ContextTreeNav when viewing a specific issue
export function IssuesSidebar({
  issues,
  activeId,
  onUpdateIssue,
}: {
  issues: IssueListItem[];
  activeId?: string;
  onUpdateIssue: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
}) {
  // Show context tree when viewing a specific issue
  const showContext = !!activeId;

  return (
    <div className="space-y-2">
      {showContext && (
        <ContextTreeNav documentId={activeId} documentType="issue" />
      )}

      {/* Separator between context and list */}
      {showContext && (
        <div className="border-t border-border mx-2" />
      )}

      {/* All Issues header */}
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        All Issues
      </div>

      <IssuesList
        issues={issues}
        activeId={activeId}
        onUpdateIssue={onUpdateIssue}
      />
    </div>
  );
}

export function IssuesList({
  issues,
  activeId,
  onUpdateIssue,
}: {
  issues: IssueListItem[];
  activeId?: string;
  onUpdateIssue: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
}) {
  const { showToast } = useToast();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; issue: IssueListItem } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, issue: IssueListItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, issue });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, issue: IssueListItem) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, issue });
  }, []);

  const handleChangeStatus = useCallback(async (issue: IssueListItem, state: IssueState) => {
    await onUpdateIssue(issue.id, { state });
    showToast(`Status changed to ${state.replace('_', ' ')}`, 'success');
    setContextMenu(null);
  }, [onUpdateIssue, showToast]);

  const handleArchive = useCallback(async (issue: IssueListItem) => {
    await onUpdateIssue(issue.id, { state: 'cancelled' });
    showToast('Issue archived', 'success');
    setContextMenu(null);
  }, [onUpdateIssue, showToast]);

  if (issues.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No issues yet</div>;
  }

  const stateColors: Record<string, string> = {
    backlog: 'bg-gray-500',
    todo: 'bg-blue-500',
    in_progress: 'bg-yellow-500',
    done: 'bg-green-500',
    cancelled: 'bg-red-500',
  };

  return (
    <>
      <ul className="space-y-0.5 px-2" data-testid="issues-list">
        {issues.map((issue) => (
          <li key={issue.id} data-testid="issue-item" className="group relative">
            <Link
              to={`/documents/${issue.id}`}
              onContextMenu={(e) => handleContextMenu(e, issue)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                activeId === issue.id
                  ? 'bg-border/50 text-foreground'
                  : 'text-muted hover:bg-border/30 hover:text-foreground'
              )}
            >
              <span className={cn('h-2 w-2 rounded-full flex-shrink-0', stateColors[issue.state] || stateColors.backlog)} />
              <span className="flex-1 truncate">{issue.title || 'Untitled'}</span>
            </Link>
            {/* Three-dot menu button */}
            <button
              type="button"
              onClick={(e) => handleMenuClick(e, issue)}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border/50 text-muted hover:text-foreground transition-opacity"
              aria-label={`Actions for ${issue.title || 'Untitled'}`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuSubmenu label="Change Status">
            <ContextMenuItem onClick={() => handleChangeStatus(contextMenu.issue, 'backlog')}>
              <IssueStatusIcon state="backlog" />
              Backlog
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleChangeStatus(contextMenu.issue, 'todo')}>
              <IssueStatusIcon state="todo" />
              Todo
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleChangeStatus(contextMenu.issue, 'in_progress')}>
              <IssueStatusIcon state="in_progress" />
              In Progress
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleChangeStatus(contextMenu.issue, 'done')}>
              <IssueStatusIcon state="done" />
              Done
            </ContextMenuItem>
          </ContextMenuSubmenu>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handleArchive(contextMenu.issue)}>
            <ArchiveIcon className="h-4 w-4" />
            Archive
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}

export function IssueStatusIcon({ state }: { state: string }) {
  const colors: Record<string, string> = {
    backlog: 'text-gray-400',
    todo: 'text-blue-400',
    in_progress: 'text-yellow-400',
    done: 'text-green-400',
    cancelled: 'text-red-400',
  };
  return (
    <span className={cn('h-2 w-2 rounded-full inline-block mr-2', colors[state]?.replace('text-', 'bg-') || 'bg-gray-400')} />
  );
}