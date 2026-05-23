import { useState, useEffect, useRef, useCallback, useMemo, ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ProjectCombobox, Project } from '@/components/ProjectCombobox';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';
import { apiPost, apiGet, apiDelete, readJson } from '@/lib/api';
import { formatDateRange } from '@/lib/date-utils';

interface User {
  personId: string; // Document ID - used for allocations (works for both pending and active)
  id: string | null; // User account ID - null for pending users
  name: string;
  email: string;
  isArchived?: boolean;
  isPending?: boolean;
  reportsTo?: string | null; // user_id of supervisor
}

interface Sprint {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface Assignment {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  programId: string | null;
  programName: string | null;
  emoji?: string | null;
  color: string | null;
}

interface TeamGridData {
  users: User[];
  weeks: Sprint[];
  currentSprintNumber: number;
}

interface AssignmentResponse {
  error?: string;
  issuesOrphaned?: Array<{ id: string; title: string }>;
}

const SPRINTS_PER_LOAD = 5;
const SCROLL_THRESHOLD = 200;

// Program group info for grouping users
interface ProgramGroup {
  programId: string | null;
  programName: string;
  emoji: string | null;
  color: string | null;
  users: User[];
}

export function TeamModePage(): ReactElement {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<TeamGridData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Record<number, Assignment>>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<'left' | 'right' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showPastWeeks, setShowPastWeeks] = useState(() => {
    try {
      return localStorage.getItem('ship:allocation-show-past-weeks') === 'true';
    } catch { return false; }
  });
  const [filterMode, setFilterMode] = useState<'my-team' | 'everyone' | null>(() => {
    try {
      const stored = localStorage.getItem('ship:allocation-filter-mode');
      if (stored === 'my-team' || stored === 'everyone') return stored;
    } catch { /* ignore */ }
    return null;
  });
  const [nameFilter, setNameFilter] = useState('');
  const [sprintRange, setSprintRange] = useState<{ min: number; max: number } | null>(null);
  const [collapsedPrograms, setCollapsedPrograms] = useState<Set<string>>(new Set());
  const [viewAsSprintNumber, setViewAsSprintNumber] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  // Find the current sprint number
  const currentSprintNumber = data?.currentSprintNumber ?? null;

  // Filter weeks to hide past weeks when showPastWeeks is false
  const visibleWeeks = useMemo(() => {
    if (!data) return [];
    if (showPastWeeks || currentSprintNumber === null) return data.weeks;
    return data.weeks.filter(s => s.number >= currentSprintNumber);
  }, [data, showPastWeeks, currentSprintNumber]);

  // Smart default: if user has direct reports, default to "my-team"
  const hasDirectReports = useMemo(() => {
    if (!data || !user?.id) return false;
    return data.users.some(u => u.reportsTo === user.id);
  }, [data, user?.id]);

  // Set smart default when data first loads (only if no stored value)
  useEffect(() => {
    if (data && filterMode === null) {
      setFilterMode(hasDirectReports ? 'my-team' : 'everyone');
    }
  }, [data, filterMode, hasDirectReports]);

  // Persist filter mode and past-weeks visibility to localStorage
  useEffect(() => {
    if (filterMode !== null) {
      localStorage.setItem('ship:allocation-filter-mode', filterMode);
    }
  }, [filterMode]);

  useEffect(() => {
    localStorage.setItem('ship:allocation-show-past-weeks', String(showPastWeeks));
  }, [showPastWeeks]);

  // Filter users based on filter mode and name search
  const filteredUsers = useMemo(() => {
    if (!data) return [];
    let users = data.users;
    if (filterMode === 'my-team' && user?.id) {
      users = users.filter(u => u.reportsTo === user.id);
    }
    if (nameFilter.trim()) {
      const query = nameFilter.trim().toLowerCase();
      users = users.filter(u => u.name.toLowerCase().includes(query));
    }
    return users;
  }, [data, filterMode, user?.id, nameFilter]);

  // Group users by their assignment's program for the viewed sprint
  const groupingSprintNumber = viewAsSprintNumber ?? currentSprintNumber;

  const programGroups = useMemo((): ProgramGroup[] => {
    if (!data) return [];

    const groups: Map<string, ProgramGroup> = new Map();
    const UNASSIGNED_KEY = '__unassigned__';

    for (const user of filteredUsers) {
      const currentAssignment = groupingSprintNumber
        ? assignments[user.personId]?.[groupingSprintNumber]
        : null;

      const groupKey = currentAssignment?.programId || UNASSIGNED_KEY;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          programId: currentAssignment?.programId || null,
          programName: currentAssignment?.programName || 'Unassigned',
          emoji: currentAssignment?.emoji || null,
          color: currentAssignment?.color || null,
          users: [],
        });
      }

      const group = groups.get(groupKey);
      if (group) {
        group.users.push(user);
      }
    }

    // Sort groups: alphabetically by name, with Unassigned last
    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      if (a.programId === null) return 1;
      if (b.programId === null) return -1;
      return a.programName.localeCompare(b.programName);
    });

    // Sort users within each group alphabetically
    for (const group of sortedGroups) {
      group.users.sort((a, b) => a.name.localeCompare(b.name));
    }

    return sortedGroups;
  }, [data, filteredUsers, assignments, groupingSprintNumber]);

  // Toggle program group collapse
  const toggleProgramCollapse = useCallback((programId: string | null) => {
    const key = programId || '__unassigned__';
    setCollapsedPrograms(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Dialog states
  const [lastPersonDialog, setLastPersonDialog] = useState<{
    open: boolean;
    userId: string;
    sprintNumber: number;
    issuesOrphaned: Array<{ id: string; title: string }>;
    onConfirm: () => void;
  } | null>(null);

  // Initial load
  useEffect(() => {
    Promise.all([
      fetchTeamGrid(undefined, undefined, showArchived),
      fetchProjects(),
      fetchAssignments(),
    ]).finally(() => setLoading(false));
  }, []);

  // Refetch when showArchived changes
  useEffect(() => {
    // Skip initial render
    if (loading) return;
    fetchTeamGrid(sprintRange?.min, sprintRange?.max, showArchived);
  }, [showArchived]);

  // Scroll to current sprint on initial load (only when past weeks are shown)
  useEffect(() => {
    if (!showPastWeeks) return; // No need to scroll when past weeks are hidden
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentSprintIndex = data.weeks.findIndex(s => s.isCurrent);
      if (currentSprintIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 180; // matches w-[180px] on sprint columns
            const scrollPosition = currentSprintIndex * columnWidth;
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [data, showPastWeeks]);

  async function fetchTeamGrid(fromSprint?: number, toSprint?: number, includeArchived = false) {
    try {
      const params = new URLSearchParams();
      if (fromSprint !== undefined) params.set('fromSprint', String(fromSprint));
      if (toSprint !== undefined) params.set('toSprint', String(toSprint));
      if (includeArchived) params.set('includeArchived', 'true');

      const url = `/api/team/grid${params.toString() ? `?${params}` : ''}`;
      const res = await apiGet(url);
      if (!res.ok) throw new Error('Failed to fetch team grid');
      const json = await readJson<TeamGridData>(res);

      if (json.weeks.length > 0) {
        setSprintRange({
          min: json.weeks[0].number,
          max: json.weeks[json.weeks.length - 1].number,
        });
      }

      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  async function fetchProjects() {
    try {
      const res = await apiGet(`/api/team/projects`);
      if (res.ok) {
        const json = await readJson<Project[]>(res);
        setProjects(json);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  }

  async function fetchAssignments() {
    try {
      const res = await apiGet(`/api/team/assignments`);
      if (res.ok) {
        const json = await readJson<Record<string, Record<number, Assignment>>>(res);
        setAssignments(json);
      }
    } catch (err) {
      console.error('Failed to fetch assignments:', err);
    }
  }

  const handleAssign = async (personId: string, projectId: string, sprintNumber: number) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Optimistic update - update UI immediately
    const previousAssignment = assignments[personId]?.[sprintNumber];
    setAssignments(prev => ({
      ...prev,
      [personId]: {
        ...prev[personId],
        [sprintNumber]: {
          projectId,
          projectName: project.title,
          projectColor: project.color ?? null,
          programId: project.programId,
          programName: project.programName,
          emoji: project.programEmoji ?? null,
          color: project.programColor ?? null,
        },
      },
    }));

    try {
      const res = await apiPost(`/api/team/assign`, { personId, projectId, sprintNumber });

      const json = await readJson<AssignmentResponse>(res);

      if (!res.ok) {
        // Rollback optimistic update
        setAssignments(prev => {
          const newAssignments = { ...prev };
          if (previousAssignment) {
            newAssignments[personId] = { ...newAssignments[personId], [sprintNumber]: previousAssignment };
          } else {
            const { [sprintNumber]: _, ...rest } = newAssignments[personId] || {};
            newAssignments[personId] = rest;
          }
          return newAssignments;
        });
        setError(json.error || 'Failed to assign');
        return;
      }
    } catch {
      // Rollback optimistic update
      setAssignments(prev => {
        const newAssignments = { ...prev };
        if (previousAssignment) {
          newAssignments[personId] = { ...newAssignments[personId], [sprintNumber]: previousAssignment };
        } else {
          const { [sprintNumber]: _, ...rest } = newAssignments[personId] || {};
          newAssignments[personId] = rest;
        }
        return newAssignments;
      });
      setError('Failed to assign user');
    }
  };

  const handleUnassign = async (personId: string, sprintNumber: number, skipConfirmation = false) => {
    // Optimistic update - remove from UI immediately
    const previousAssignment = assignments[personId]?.[sprintNumber];
    setAssignments(prev => {
      const newAssignments = { ...prev };
      if (newAssignments[personId]) {
        const { [sprintNumber]: _, ...rest } = newAssignments[personId];
        newAssignments[personId] = rest;
      }
      return newAssignments;
    });

    try {
      const res = await apiDelete(`/api/team/assign`, { personId, sprintNumber });

      const json = await readJson<AssignmentResponse>(res);

      if (!res.ok) {
        // Rollback optimistic update
        if (previousAssignment) {
          setAssignments(prev => ({
            ...prev,
            [personId]: {
              ...prev[personId],
              [sprintNumber]: previousAssignment,
            },
          }));
        }
        setError(json.error || 'Failed to unassign');
        return;
      }

      // If there were orphaned issues, show them in a dialog (unless skipped)
      if ((json.issuesOrphaned?.length ?? 0) > 0 && !skipConfirmation) {
        // Issues were already moved to backlog
      }
    } catch {
      // Rollback optimistic update
      if (previousAssignment) {
        setAssignments(prev => ({
          ...prev,
          [personId]: {
            ...prev[personId],
            [sprintNumber]: previousAssignment,
          },
        }));
      }
      setError('Failed to unassign user');
    }
  };

  const handleCellChange = useCallback((
    personId: string,
    userName: string,
    sprintNumber: number,
    sprintName: string,
    newProjectId: string | null,
    currentAssignment: Assignment | null
  ) => {
    // Same project - no change
    if (newProjectId === currentAssignment?.projectId) {
      return;
    }

    // Clear assignment
    if (newProjectId === null && currentAssignment) {
      handleUnassign(personId, sprintNumber);
      return;
    }

    // New assignment or adding to existing - both just call handleAssign
    // (multiple people can now be assigned to same project/sprint)
    if (newProjectId) {
      handleAssign(personId, newProjectId, sprintNumber);
    }
  }, [projects]);

  // Fetch more sprints
  const fetchMoreSprints = useCallback(async (direction: 'left' | 'right') => {
    if (!data || !sprintRange || loadingMore) return;

    const fromSprint = direction === 'left'
      ? Math.max(1, sprintRange.min - SPRINTS_PER_LOAD)
      : sprintRange.max + 1;
    const toSprint = direction === 'left'
      ? sprintRange.min - 1
      : sprintRange.max + SPRINTS_PER_LOAD;

    if (direction === 'left' && sprintRange.min <= 1) return;

    setLoadingMore(direction);

    try {
      const params = new URLSearchParams({
        fromSprint: String(fromSprint),
        toSprint: String(toSprint),
      });
      if (showArchived) params.set('includeArchived', 'true');

      const res = await apiGet(`/api/team/grid?${params}`);
      if (!res.ok) throw new Error('Failed to fetch more sprints');
      const newData = await readJson<TeamGridData>(res);

      const scrollContainer = scrollContainerRef.current;
      const prevScrollLeft = scrollContainer?.scrollLeft || 0;
      const prevScrollWidth = scrollContainer?.scrollWidth || 0;

      setData(prev => {
        if (!prev) return newData;
        const mergedSprints = direction === 'left'
          ? [...newData.weeks, ...prev.weeks]
          : [...prev.weeks, ...newData.weeks];
        return { ...prev, weeks: mergedSprints };
      });

      setSprintRange(prev => {
        if (!prev) return { min: fromSprint, max: toSprint };
        return {
          min: direction === 'left' ? fromSprint : prev.min,
          max: direction === 'right' ? toSprint : prev.max,
        };
      });

      if (direction === 'left' && scrollContainer) {
        requestAnimationFrame(() => {
          const newScrollWidth = scrollContainer.scrollWidth;
          const addedWidth = newScrollWidth - prevScrollWidth;
          scrollContainer.scrollLeft = prevScrollLeft + addedWidth;
        });
      }
    } catch (err) {
      console.error('Error loading more sprints:', err);
    } finally {
      setLoadingMore(null);
    }
  }, [data, sprintRange, loadingMore, showArchived]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || loadingMore) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;

    if (showPastWeeks && scrollLeft < SCROLL_THRESHOLD && sprintRange && sprintRange.min > 1) {
      fetchMoreSprints('left');
    }

    if (scrollWidth - scrollLeft - clientWidth < SCROLL_THRESHOLD) {
      fetchMoreSprints('right');
    }
  }, [fetchMoreSprints, loadingMore, sprintRange, showPastWeeks]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Escape key clears view-as mode
  useEffect(() => {
    if (viewAsSprintNumber === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewAsSprintNumber(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [viewAsSprintNumber]);

  // Clear error after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

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
                <button className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border">
                  Cancel
                </button>
              </Dialog.Close>
              <button
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

function SprintCell({
  assignment,
  previousWeekAssignment,
  projects,
  isCurrent,
  loading,
  isPending,
  onChange,
  onNavigate,
}: {
  assignment?: Assignment;
  previousWeekAssignment?: Assignment;
  projects: Project[];
  isCurrent: boolean;
  loading: boolean;
  isPending?: boolean;
  onChange: (projectId: string | null) => void;
  onNavigate: (projectId: string) => void;
}) {
  // Convert previous week assignment to Project format for the quick select
  const previousWeekProject: Project | null =
    previousWeekAssignment?.projectId && previousWeekAssignment?.projectName
      ? {
          id: previousWeekAssignment.projectId,
          title: previousWeekAssignment.projectName,
          color: previousWeekAssignment.projectColor,
          programId: previousWeekAssignment.programId,
          programName: previousWeekAssignment.programName,
          programEmoji: previousWeekAssignment.emoji,
          programColor: previousWeekAssignment.color,
        }
      : null;

  // isPending is only used for visual styling (dashed border), not for blocking assignment
  return (
    <div
      className={cn(
        'flex h-12 w-[180px] items-center justify-start border-b border-r border-border px-1',
        isCurrent && 'bg-accent/5',
        loading && 'animate-pulse',
        isPending && 'border-dashed'
      )}
    >
      <ProjectCombobox
        projects={projects}
        value={assignment?.projectId || null}
        onChange={onChange}
        onNavigate={onNavigate}
        disabled={loading}
        placeholder="+"
        previousWeekProject={previousWeekProject}
        triggerClassName={cn(
          'w-full h-full justify-start',
          !assignment && 'hover:bg-border/30'
        )}
      />
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ViewAsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}
