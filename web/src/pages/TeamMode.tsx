import { useState, ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
import { formatDateRange } from '@/lib/date-utils';
import { SprintCell } from './team-mode/TeamModeSprintCell';
import { ChevronIcon, ViewAsIcon } from './team-mode/TeamModeIcons';
import { useTeamModeGrid } from './team-mode/useTeamModeGrid';

export function TeamModePage(): ReactElement {
  const navigate = useNavigate();
  const {
    data,
    projects,
    assignments,
    loading,
    loadingMore,
    error,
    showArchived,
    setShowArchived,
    showPastWeeks,
    setShowPastWeeks,
    filterMode,
    setFilterMode,
    nameFilter,
    setNameFilter,
    collapsedPrograms,
    viewAsSprintNumber,
    setViewAsSprintNumber,
    scrollContainerRef,
    visibleWeeks,
    hasDirectReports,
    filteredUsers,
    programGroups,
    toggleProgramCollapse,
    handleCellChange,
  } = useTeamModeGrid();

  const [lastPersonDialog, setLastPersonDialog] = useState<{
    open: boolean;
    userId: string;
    sprintNumber: number;
    issuesOrphaned: Array<{ id: string; title: string }>;
    onConfirm: () => void;
  } | null>(null);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading team grid...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-500">{error || 'Failed to load data'}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Error toast */}
      {error && (
        <div className="absolute right-4 top-4 z-50 rounded-md bg-red-500/90 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      {/* Header */}
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium text-foreground">Allocation</h1>
          {hasDirectReports && (
            <div className="flex rounded-md border border-border text-xs">
              <button
                type="button"
                onClick={() => setFilterMode('my-team')}
                className={cn(
                  'px-2 py-0.5 transition-colors',
                  filterMode === 'my-team'
                    ? 'bg-accent text-white'
                    : 'text-muted hover:text-foreground'
                )}
              >
                My Team
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('everyone')}
                className={cn(
                  'px-2 py-0.5 transition-colors',
                  filterMode === 'everyone'
                    ? 'bg-accent text-white'
                    : 'text-muted hover:text-foreground'
                )}
              >
                Everyone
              </button>
            </div>
          )}
          <div className="relative">
            <input
              type="text"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="Filter by name..."
              className="h-6 w-36 rounded border border-border bg-transparent px-2 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
            />
            {nameFilter && (
              <button
                type="button"
                onClick={() => setNameFilter('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {viewAsSprintNumber !== null && (
            <div className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs text-accent">
              <span>Viewing as {data.weeks.find(w => w.number === viewAsSprintNumber)?.name ?? `Week ${viewAsSprintNumber}`}</span>
              <button
                type="button"
                onClick={() => setViewAsSprintNumber(null)}
                className="ml-0.5 rounded p-0.5 hover:bg-accent/20"
                title="Return to current week"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowPastWeeks(prev => !prev)}
            className={cn(
              'flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs transition-colors',
              showPastWeeks
                ? 'bg-accent text-white border-accent'
                : 'text-muted hover:text-foreground hover:border-foreground/30'
            )}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {showPastWeeks ? 'Hide' : 'Show'} past weeks
          </button>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent/50"
            />
            <span className="text-xs text-muted">Show archived</span>
          </label>
          <span className="text-xs text-muted">
            {filteredUsers.length} team members &middot; {projects.length} projects
          </span>
        </div>
      </header>

      {/* Assignments Grid - Single scroll container with sticky person column */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto pb-20"
      >
          <div className="inline-flex min-w-full">
            {/* Sticky person column */}
            <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
              {/* Header cell */}
              <div className="flex h-10 w-[180px] items-center justify-center border-b border-border px-3 sticky top-0 z-30 bg-background">
                <span className="text-xs font-medium text-muted">Team Member</span>
              </div>

              {/* Program groups with users */}
              {programGroups.map((group) => {
                const groupKey = group.programId || '__unassigned__';
                const isCollapsed = collapsedPrograms.has(groupKey);

                return (
                  <div key={groupKey}>
                    {/* Program group header */}
                    <button
                      type="button"
                      onClick={() => toggleProgramCollapse(group.programId)}
                      className="flex h-8 w-[180px] items-center gap-2 border-b border-border bg-border/30 px-3 hover:bg-border/50 transition-colors cursor-pointer"
                    >
                      <ChevronIcon
                        className={cn(
                          "h-3 w-3 text-muted transition-transform",
                          isCollapsed && "-rotate-90"
                        )}
                      />
                      {group.programId ? (
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                          style={{ backgroundColor: group.color || '#6b7280' }}
                        >
                          {group.emoji || group.programName[0]}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white bg-gray-500">
                          ?
                        </span>
                      )}
                      <span className="truncate text-xs font-medium text-foreground">
                        {isCollapsed ? `${group.programName} (${group.users.length})` : group.programName}
                      </span>
                      {!isCollapsed && (
                        <span className="ml-auto text-[10px] text-muted">
                          {group.users.length}
                        </span>
                      )}
                    </button>

                    {/* Users in this group */}
                    {!isCollapsed && group.users.map((user, idx) => (
                      <div
                        key={user.id ?? `pending-${idx}`}
                        className={cn(
                          "flex h-12 w-[180px] items-center border-b border-border px-3 bg-background",
                          user.isArchived && "opacity-50",
                          user.isPending && "opacity-70"
                        )}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <div className={cn(
                            "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white",
                            user.isArchived ? "bg-gray-400" : user.isPending ? "bg-gray-400" : "bg-accent/80"
                          )}>
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <span className={cn(
                            "truncate text-sm",
                            user.isArchived ? "text-muted" : user.isPending ? "text-muted italic" : "text-foreground"
                          )}>
                            {user.name}
                            {user.isArchived && <span className="ml-1 text-xs">(archived)</span>}
                            {user.isPending && <span className="ml-1 text-xs font-normal not-italic">(pending)</span>}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Sprint columns */}
            <div className="flex">
              {loadingMore === 'left' && (
                <div className="flex flex-col w-[60px]">
                  <div className="h-10 flex items-center justify-center border-b border-border sticky top-0 bg-background z-10">
                    <span className="text-xs text-muted animate-pulse">...</span>
                  </div>
                </div>
              )}

              {visibleWeeks.map((sprint) => {
                const isActiveViewAs = sprint.number === viewAsSprintNumber;
                const isDefaultCurrent = sprint.isCurrent && viewAsSprintNumber === null;
                const showViewAsButton = !isActiveViewAs && !isDefaultCurrent;

                return (
                <div key={sprint.number} className="flex flex-col">
                  {/* Sprint header */}
                  <div
                    className={cn(
                      'group flex h-10 w-[180px] flex-col items-center justify-center border-b border-r border-border px-2 sticky top-0 z-10 bg-background',
                      sprint.isCurrent && 'ring-1 ring-inset ring-accent/30',
                      isActiveViewAs && 'ring-2 ring-inset ring-accent/50 bg-accent/5'
                    )}
                  >
                    <span className={cn(
                      'text-xs font-medium',
                      sprint.isCurrent ? 'text-accent' : 'text-foreground'
                    )}>
                      {sprint.name}
                    </span>
                    <span className="text-[10px] text-muted">
                      {formatDateRange(sprint.startDate, sprint.endDate)}
                    </span>
                    {showViewAsButton && (
                      <button
                        type="button"
                        onClick={() => setViewAsSprintNumber(sprint.number)}
                        title="View as current week"
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted opacity-0 transition-opacity hover:bg-border/50 hover:text-foreground group-hover:opacity-100"
                      >
                        <ViewAsIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Sprint cells grouped by program */}
                  {programGroups.map((group) => {
                    const groupKey = group.programId || '__unassigned__';
                    const isCollapsed = collapsedPrograms.has(groupKey);

                    return (
                      <div key={groupKey}>
                        {/* Program header spacer row for this sprint column */}
                        <div
                          className={cn(
                            "h-8 w-[180px] border-b border-r border-border bg-border/30",
                            sprint.isCurrent && "bg-accent/5"
                          )}
                        />

                        {/* Cells for users in this group */}
                        {!isCollapsed && group.users.map((user) => {
                          const isPending = user.isPending || !user.id;
                          const assignment = assignments[user.personId]?.[sprint.number];
                          const previousWeekAssignment = assignments[user.personId]?.[sprint.number - 1];
                          const cellKey = `${user.personId}-${sprint.number}`;
                          return (
                            <SprintCell
                              key={cellKey}
                              assignment={assignment}
                              previousWeekAssignment={previousWeekAssignment}
                              projects={projects}
                              isCurrent={sprint.isCurrent}
                              loading={false}
                              isPending={isPending}
                              onChange={(projectId) => {
                                handleCellChange(
                                  user.personId,
                                  user.name,
                                  sprint.number,
                                  sprint.name,
                                  projectId,
                                  assignment || null
                                );
                              }}
                              onNavigate={(projectId) => navigate(`/documents/${projectId}`)}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                );
              })}

              {loadingMore === 'right' && (
                <div className="flex flex-col w-[60px]">
                  <div className="h-10 flex items-center justify-center border-b border-border sticky top-0 bg-background z-10">
                    <span className="text-xs text-muted animate-pulse">...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      {/* Last Person Dialog */}
      <Dialog.Root open={lastPersonDialog?.open || false} onOpenChange={(open: boolean) => !open && setLastPersonDialog(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Remove Last Assignee
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted">
              This is the last person assigned to this sprint. Removing them will delete the sprint document.
            </Dialog.Description>

            {lastPersonDialog?.issuesOrphaned && lastPersonDialog.issuesOrphaned.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-foreground">
                  {lastPersonDialog.issuesOrphaned.length} issues will be moved to backlog:
                </p>
                <ul className="mt-2 max-h-[150px] overflow-auto rounded border border-border p-2">
                  {lastPersonDialog.issuesOrphaned.map((issue) => (
                    <li key={issue.id} className="text-sm text-muted truncate">
                      {issue.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Dialog.Close asChild>
                <button type="button" className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={() => {
                  lastPersonDialog?.onConfirm();
                  setLastPersonDialog(null);
                }}
                className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
              >
                Remove & Delete Week
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
