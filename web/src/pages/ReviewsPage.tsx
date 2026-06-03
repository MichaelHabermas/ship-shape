import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost, apiGet, readJson } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useReviewQueue } from '@/contexts/ReviewQueueContext';
import type { QueueItem } from '@/contexts/ReviewQueueContext';
import {
  type ReviewsData,
  type ProgramGroup,
  type SelectedCell,
  type BatchMode,
} from './reviews/reviews-types.js';
import { needsPlanReview, needsRetroReview } from './reviews/reviews-status.js';
import { ReviewsPageLayout } from './reviews/ReviewsPageLayout.js';

export function ReviewsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const reviewQueue = useReviewQueue();
  const [data, setData] = useState<ReviewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'my-team' | 'everyone' | null>(null);
  const [collapsedPrograms, setCollapsedPrograms] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [batchMode, setBatchMode] = useState<BatchMode | null>(null);
  const [selectedPlanWeek, setSelectedPlanWeek] = useState<number | null>(null);
  const [selectedRetroWeek, setSelectedRetroWeek] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  // Smart default: if user has direct reports, default to "my-team"
  const hasDirectReports = useMemo(() => {
    if (!data || !user?.id) return false;
    return data.people.some(p => p.reportsTo === user.id);
  }, [data, user?.id]);

  useEffect(() => {
    if (data && filterMode === null) {
      setFilterMode(hasDirectReports ? 'my-team' : 'everyone');
    }
  }, [data, filterMode, hasDirectReports]);

  // Filter people based on filter mode
  const filteredPeople = useMemo(() => {
    if (!data) return [];
    if (filterMode === 'my-team' && user?.id) {
      return data.people.filter(p => p.reportsTo === user.id);
    }
    return data.people;
  }, [data, filterMode, user?.id]);

  // Recalculate manager action defaults when switching review scope.
  useEffect(() => {
    setSelectedPlanWeek(null);
    setSelectedRetroWeek(null);
  }, [filterMode]);

  useEffect(() => {
    fetchReviews();
  }, []);

  // Approve a plan optimistically
  const approvePlan = useCallback(async (personId: string, weekNumber: number, sprintId: string, comment?: string) => {
    if (!data) return;

    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, reviews: { ...prev.reviews } };
      updated.reviews[personId] = { ...updated.reviews[personId] };
      updated.reviews[personId][weekNumber] = {
        ...updated.reviews[personId][weekNumber],
        planApproval: {
          state: 'approved',
          approved_by: null,
          approved_at: new Date().toISOString(),
          comment: comment?.trim() || null,
        },
      };
      return updated;
    });

    try {
      const res = await apiPost(`/api/weeks/${sprintId}/approve-plan`, { comment });
      if (!res.ok) throw new Error('Failed to approve plan');
    } catch {
      // Revert on error
      fetchReviews();
    }
  }, [data]);

  // Request changes on a plan or retro
  const requestChanges = useCallback(async (personId: string, weekNumber: number, sprintId: string, type: 'plan' | 'retro', feedback: string) => {
    if (!data) return;

    const endpoint = type === 'plan' ? 'request-plan-changes' : 'request-retro-changes';
    const approvalField = type === 'plan' ? 'planApproval' : 'reviewApproval';

    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, reviews: { ...prev.reviews } };
      updated.reviews[personId] = { ...updated.reviews[personId] };
      updated.reviews[personId][weekNumber] = {
        ...updated.reviews[personId][weekNumber],
        [approvalField]: { state: 'changes_requested', approved_by: null, approved_at: new Date().toISOString(), feedback },
      };
      return updated;
    });

    try {
      const res = await apiPost(`/api/weeks/${sprintId}/${endpoint}`, { feedback });
      if (!res.ok) throw new Error('Failed to request changes');
    } catch {
      // Revert on error
      fetchReviews();
    }
  }, [data]);

  // Rate a retro (also approves it)
  const rateRetro = useCallback(async (personId: string, weekNumber: number, sprintId: string, rating: number, comment?: string) => {
    if (!data) return;

    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, reviews: { ...prev.reviews } };
      updated.reviews[personId] = { ...updated.reviews[personId] };
      updated.reviews[personId][weekNumber] = {
        ...updated.reviews[personId][weekNumber],
        reviewApproval: {
          state: 'approved',
          approved_by: null,
          approved_at: new Date().toISOString(),
          comment: comment?.trim() || null,
        },
        reviewRating: { value: rating, rated_by: '', rated_at: new Date().toISOString() },
      };
      return updated;
    });

    try {
      const res = await apiPost(`/api/weeks/${sprintId}/approve-review`, { rating, comment });
      if (!res.ok) throw new Error('Failed to rate retro');
    } catch {
      // Revert on error
      fetchReviews();
    }
  }, [data]);

  async function fetchReviews() {
    try {
      setLoading(true);
      const res = await apiGet(`/api/team/reviews?sprint_count=8`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const json = await readJson<ReviewsData>(res);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }

  // Group people by program
  const programGroups = useMemo((): ProgramGroup[] => {
    if (!data) return [];

    const groups = new Map<string, ProgramGroup>();
    const UNASSIGNED_KEY = '__unassigned__';

    for (const person of filteredPeople) {
      const groupKey = person.programId || UNASSIGNED_KEY;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          programId: person.programId,
          programName: person.programName || 'No Program',
          programColor: person.programColor,
          people: [],
        });
      }

      const group = groups.get(groupKey);
      if (group) {
        group.people.push(person);
      }
    }

    const sorted = Array.from(groups.values()).sort((a, b) => {
      if (a.programId === null) return 1;
      if (b.programId === null) return -1;
      return a.programName.localeCompare(b.programName);
    });

    for (const group of sorted) {
      group.people.sort((a, b) => a.name.localeCompare(b.name));
    }

    return sorted;
  }, [data, filteredPeople]);

  // Build row structure for synchronized scrolling
  const rowStructure = useMemo(() => {
    const rows: Array<{
      type: 'program' | 'person';
      id: string;
      name: string;
      color?: string | null;
      personId?: string;
      peopleCount?: number;
    }> = [];

    for (const group of programGroups) {
      const groupKey = group.programId || '__unassigned__';
      const isCollapsed = collapsedPrograms.has(groupKey);

      rows.push({
        type: 'program',
        id: groupKey,
        name: group.programName,
        color: group.programColor,
        peopleCount: group.people.length,
      });

      if (!isCollapsed) {
        for (const person of group.people) {
          rows.push({
            type: 'person',
            id: `${person.personId}`,
            name: person.name,
            personId: person.personId,
          });
        }
      }
    }

    return rows;
  }, [programGroups, collapsedPrograms]);

  // Per-week actionable review counts for manager actions
  const weekReviewCounts = useMemo((): Record<number, { plans: number; retros: number }> => {
    const counts: Record<number, { plans: number; retros: number }> = {};
    if (!data) return counts;

    for (const week of data.weeks) {
      counts[week.number] = { plans: 0, retros: 0 };
    }

    for (const person of filteredPeople) {
      for (const week of data.weeks) {
        const cell = data.reviews[person.personId]?.[week.number];
        if (needsPlanReview(cell)) counts[week.number].plans += 1;
        if (needsRetroReview(cell)) counts[week.number].retros += 1;
      }
    }

    return counts;
  }, [data, filteredPeople]);

  const weeksDescending = useMemo(() => {
    if (!data) return [];
    return [...data.weeks].sort((a, b) => b.number - a.number);
  }, [data]);

  const defaultPlanWeek = useMemo(() => {
    if (!data) return null;

    const currentWeekNumber = data.currentSprintNumber;
    if ((weekReviewCounts[currentWeekNumber]?.plans ?? 0) > 0) {
      return currentWeekNumber;
    }

    const latestWithPendingPlans = weeksDescending.find(week => (weekReviewCounts[week.number]?.plans ?? 0) > 0);
    return latestWithPendingPlans?.number ?? currentWeekNumber;
  }, [data, weekReviewCounts, weeksDescending]);

  const defaultRetroWeek = useMemo(() => {
    if (!data) return null;

    const currentWeekNumber = data.currentSprintNumber;
    const previousWeekNumber = currentWeekNumber - 1;
    const isMonday = new Date().getDay() === 1;

    if (isMonday && previousWeekNumber >= 1 && (weekReviewCounts[previousWeekNumber]?.retros ?? 0) > 0) {
      return previousWeekNumber;
    }

    const latestWithPendingRetros = weeksDescending.find(week => (weekReviewCounts[week.number]?.retros ?? 0) > 0);
    if (latestWithPendingRetros) {
      return latestWithPendingRetros.number;
    }

    if (previousWeekNumber >= 1 && data.weeks.some(week => week.number === previousWeekNumber)) {
      return previousWeekNumber;
    }

    return currentWeekNumber;
  }, [data, weekReviewCounts, weeksDescending]);

  useEffect(() => {
    if (!data || defaultPlanWeek === null) return;
    const selectedExists = selectedPlanWeek !== null && data.weeks.some(week => week.number === selectedPlanWeek);
    if (!selectedExists) {
      setSelectedPlanWeek(defaultPlanWeek);
    }
  }, [data, defaultPlanWeek, selectedPlanWeek]);

  useEffect(() => {
    if (!data || defaultRetroWeek === null) return;
    const selectedExists = selectedRetroWeek !== null && data.weeks.some(week => week.number === selectedRetroWeek);
    if (!selectedExists) {
      setSelectedRetroWeek(defaultRetroWeek);
    }
  }, [data, defaultRetroWeek, selectedRetroWeek]);

  const effectivePlanWeek = selectedPlanWeek ?? defaultPlanWeek ?? data?.currentSprintNumber ?? 1;
  const effectiveRetroWeek = selectedRetroWeek ?? defaultRetroWeek ?? data?.currentSprintNumber ?? 1;
  const selectedPlanPendingCount = weekReviewCounts[effectivePlanWeek]?.plans ?? 0;
  const selectedRetroPendingCount = weekReviewCounts[effectiveRetroWeek]?.retros ?? 0;
  const selectedPlanWeekLabel = data?.weeks.find(week => week.number === effectivePlanWeek)?.name ?? `Week ${effectivePlanWeek}`;
  const selectedRetroWeekLabel = data?.weeks.find(week => week.number === effectiveRetroWeek)?.name ?? `Week ${effectiveRetroWeek}`;

  // Build batch review queue for selected week data
  const buildBatchQueue = useCallback((type: 'plans' | 'retros', weekNumber: number): SelectedCell[] => {
    if (!data) return [];
    const selectedWeek = data.weeks.find(w => w.number === weekNumber);
    if (!selectedWeek) return [];

    const queue: SelectedCell[] = [];
    for (const group of programGroups) {
      for (const person of group.people) {
        const cell = data.reviews[person.personId]?.[selectedWeek.number];
        if (!cell?.sprintId) continue;

        if (type === 'plans' && needsPlanReview(cell)) {
          queue.push({
            personId: person.personId,
            personName: person.name,
            weekNumber: selectedWeek.number,
            weekName: selectedWeek.name,
            type: 'plan',
            sprintId: cell.sprintId,
            cell,
          });
        }
        if (type === 'retros' && needsRetroReview(cell)) {
          queue.push({
            personId: person.personId,
            personName: person.name,
            weekNumber: selectedWeek.number,
            weekName: selectedWeek.name,
            type: 'retro',
            sprintId: cell.sprintId,
            cell,
          });
        }
      }
    }
    return queue;
  }, [data, programGroups]);

  // Start batch review via queue context (navigates to documents)
  function startBatchReview(type: 'plans' | 'retros', weekNumber: number) {
    if (!reviewQueue || !data) return;
    const selectedCells = buildBatchQueue(type, weekNumber);
    if (selectedCells.length === 0) return;

    const queueItems: QueueItem[] = selectedCells
      .map(sc => {
        const docId = sc.type === 'plan' ? sc.cell.planDocId : sc.cell.retroDocId;
        if (!docId) return null;
        return {
          personId: sc.personId,
          personName: sc.personName,
          weekNumber: sc.weekNumber,
          weekName: sc.weekName,
          type: sc.type,
          sprintId: sc.sprintId,
          docId,
        };
      })
      .filter((item): item is QueueItem => item !== null);

    if (queueItems.length > 0) {
      reviewQueue.start(queueItems);
    }
  }

  // Advance to next item in batch mode
  function advanceBatch() {
    if (!batchMode) return;
    const nextIndex = batchMode.currentIndex + 1;
    if (nextIndex >= batchMode.queue.length) {
      // All done
      setBatchMode({ ...batchMode, currentIndex: nextIndex });
      setSelectedCell(null);
    } else {
      // Refresh the cell data from the latest state
      const nextItem = batchMode.queue[nextIndex];
      const freshCell = data?.reviews[nextItem.personId]?.[nextItem.weekNumber];
      const updatedItem = freshCell ? { ...nextItem, cell: freshCell } : nextItem;
      setBatchMode({ ...batchMode, currentIndex: nextIndex });
      setSelectedCell(updatedItem);
    }
  }

  // Exit batch mode
  function exitBatchMode() {
    setBatchMode(null);
    setSelectedCell(null);
  }

  // Scroll to current week on first render
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentWeekIndex = data.weeks.findIndex(w => w.isCurrent);
      if (currentWeekIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 100;
            const scrollPosition = Math.max(0, (currentWeekIndex - 2) * columnWidth);
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [data]);

  // Handle Escape to close panel / exit batch mode (must be before ALL early returns)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (batchMode) {
          exitBatchMode();
        } else if (selectedCell) {
          setSelectedCell(null);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, batchMode]);

  function toggleProgram(programId: string | null) {
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
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-red-500">{error}</span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <ReviewsPageLayout
      data={data}
      hasDirectReports={hasDirectReports}
      filterMode={filterMode}
      setFilterMode={setFilterMode}
      rowStructure={rowStructure}
      collapsedPrograms={collapsedPrograms}
      toggleProgram={toggleProgram}
      scrollContainerRef={scrollContainerRef}
      weeksDescending={weeksDescending}
      weekReviewCounts={weekReviewCounts}
      effectivePlanWeek={effectivePlanWeek}
      effectiveRetroWeek={effectiveRetroWeek}
      selectedPlanPendingCount={selectedPlanPendingCount}
      selectedRetroPendingCount={selectedRetroPendingCount}
      selectedPlanWeekLabel={selectedPlanWeekLabel}
      selectedRetroWeekLabel={selectedRetroWeekLabel}
      setSelectedPlanWeek={setSelectedPlanWeek}
      setSelectedRetroWeek={setSelectedRetroWeek}
      startBatchReview={startBatchReview}
      selectedCell={selectedCell}
      batchMode={batchMode}
      navigate={navigate}
      setSelectedCell={setSelectedCell}
      exitBatchMode={exitBatchMode}
      advanceBatch={advanceBatch}
      approvePlan={approvePlan}
      rateRetro={rateRetro}
      requestChanges={requestChanges}
    />
  );
}

export default ReviewsPage;
