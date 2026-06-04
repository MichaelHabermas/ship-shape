import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Project } from '@/components/ProjectCombobox';
import { useAuth } from '@/hooks/useAuth';
import { apiPost, apiGet, apiDelete, readJson } from '@/lib/api';
import type { TeamAssignment, TeamGridResponse } from '@/api/schemas';
import type {
  AssignmentResponse,
  ProgramGroup,
} from './team-mode-types';

const SPRINTS_PER_LOAD = 5;
const SCROLL_THRESHOLD = 200;

export function useTeamModeGrid() {
  const { user } = useAuth();
  const [data, setData] = useState<TeamGridResponse | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<Record<string, Record<number, TeamAssignment>>>({});
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
      const json = await readJson<TeamGridResponse>(res);

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
        const json = await readJson<Record<string, Record<number, TeamAssignment>>>(res);
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
    currentAssignment: TeamAssignment | null
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
      const newData = await readJson<TeamGridResponse>(res);

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

  return {
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
    currentSprintNumber,
    visibleWeeks,
    hasDirectReports,
    filteredUsers,
    programGroups,
    toggleProgramCollapse,
    handleCellChange,
  };
}
