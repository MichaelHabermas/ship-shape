import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { apiPost, apiGet, readJson } from '@/lib/api';
import { formatDateRange } from '@/lib/date-utils';
import { useAuth } from '@/hooks/useAuth';
import { useReviewQueue } from '@/contexts/ReviewQueueContext';
import type { QueueItem } from '@/contexts/ReviewQueueContext';

// OPM 5-level performance rating scale
const OPM_RATINGS = [
  { value: 5, label: 'Outstanding', color: 'text-green-500', bg: 'bg-green-500/10' },
  { value: 4, label: 'Exceeds Expectations', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { value: 3, label: 'Fully Successful', color: 'text-muted', bg: 'bg-border/50' },
  { value: 2, label: 'Minimally Satisfactory', color: 'text-orange-500', bg: 'bg-orange-500/10' },
  { value: 1, label: 'Unacceptable', color: 'text-red-500', bg: 'bg-red-500/10' },
] as const;

// Review status colors — matches StatusOverviewHeatmap's bold style
type ReviewStatus = 'approved' | 'needs_review' | 'late' | 'changed' | 'changes_requested' | 'empty';

const REVIEW_COLORS: Record<ReviewStatus, string> = {
  approved: '#22c55e',           // green — approved or rated
  needs_review: '#eab308',       // yellow — submitted, needs manager action
  late: '#ef4444',               // red — past due, nothing submitted
  changed: '#f97316',            // orange — changed since approved
  changes_requested: '#ea580c',  // orange — manager requested changes
  empty: '#6b7280',              // gray — no allocation or future
};

const REVIEW_STATUS_TEXT: Record<ReviewStatus, string> = {
  approved: 'approved',
  needs_review: 'needs review',
  late: 'late',
  changed: 'changed since approved',
  changes_requested: 'changes requested',
  empty: 'no submission',
};

function needsPlanReview(cell: ReviewCell | undefined): boolean {
  if (!cell?.sprintId || !cell.hasPlan) return false;
  const approvalState = cell.planApproval?.state;
  return approvalState !== 'approved' && approvalState !== 'changes_requested';
}

function needsRetroReview(cell: ReviewCell | undefined): boolean {
  if (!cell?.sprintId || !cell.hasRetro) return false;
  const approvalState = cell.reviewApproval?.state;
  return approvalState !== 'approved' && approvalState !== 'changes_requested';
}

interface Week {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface ReviewPerson {
  personId: string;
  name: string;
  programId: string | null;
  programName: string | null;
  programColor: string | null;
  reportsTo?: string | null;
}

interface ApprovalInfo {
  state: string;
  approved_by?: string | null;
  approved_at?: string | null;
  approved_version_id?: number | null;
  feedback?: string | null;
  comment?: string | null;
}

interface RatingInfo {
  value: number;
  rated_by?: string;
  rated_at?: string;
}

interface ReviewCell {
  planApproval: ApprovalInfo | null;
  reviewApproval: ApprovalInfo | null;
  reviewRating: RatingInfo | null;
  hasPlan: boolean;
  hasRetro: boolean;
  sprintId: string | null;
  planDocId: string | null;
  retroDocId: string | null;
}

interface ReviewsData {
  people: ReviewPerson[];
  weeks: Week[];
  reviews: Record<string, Record<number, ReviewCell>>;
  currentSprintNumber: number;
}

interface ProgramGroup {
  programId: string | null;
  programName: string;
  programColor: string | null;
  people: ReviewPerson[];
}

/** Determine the review status color for a plan cell */
function getPlanStatus(cell: ReviewCell | undefined, weekIsPast: boolean): ReviewStatus {
  if (!cell || !cell.sprintId) return 'empty';
  if (cell.planApproval?.state === 'approved') return 'approved';
  if (cell.planApproval?.state === 'changes_requested') return 'changes_requested';
  if (cell.planApproval?.state === 'changed_since_approved') return 'changed';
  if (cell.hasPlan) return 'needs_review';
  if (weekIsPast) return 'late';
  return 'empty';
}

/** Determine the review status color for a retro cell */
function getRetroStatus(cell: ReviewCell | undefined, weekIsPast: boolean): ReviewStatus {
  if (!cell || !cell.sprintId) return 'empty';
  if (cell.reviewApproval?.state === 'changes_requested') return 'changes_requested';
  if (cell.reviewApproval?.state === 'changed_since_approved') return 'changed';
  if (cell.reviewRating) return 'approved';
  if (cell.reviewApproval?.state === 'approved') return 'approved';
  if (cell.hasRetro) return 'needs_review';
  if (weekIsPast) return 'late';
  return 'empty';
}

// Shape of a fetched weekly plan/retro document
interface WeeklyDoc {
  id: string;
  title: string;
  content: unknown;
  properties: Record<string, unknown>;
  person_name?: string;
  project_name?: string;
}

// Selected cell for the review panel
interface SelectedCell {
  personId: string;
  personName: string;
  weekNumber: number;
  weekName: string;
  type: 'plan' | 'retro';
  sprintId: string;
  cell: ReviewCell;
}

// Batch review mode state
interface BatchMode {
  type: 'plans' | 'retros';
  queue: SelectedCell[];
  currentIndex: number;
}

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
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
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
    <div className="flex h-full">
      {/* Main grid area */}
      <div className={cn('flex flex-col', selectedCell ? 'flex-1 min-w-0' : 'flex-1')}>
      {/* Status legend + filters */}
      <div className="border-b border-border px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
        {/* My Team filter */}
        {hasDirectReports && (
          <>
            <div className="flex rounded-md border border-border">
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
            <div className="h-4 w-px bg-border" />
          </>
        )}
        <span className="text-muted">Review Status:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.approved }} />
          <span>Approved</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.needs_review }} />
          <span>Needs Review</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.late }} />
          <span>Late</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.changed }} />
          <span>Changed</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.changes_requested }} />
          <span>Changes Requested</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.empty }} />
          <span>No Submission</span>
        </div>
        <span className="text-muted">Left = Plan, Right = Retro</span>
        </div>
      </div>

      {/* Manager action bar */}
      <div className="border-b border-border bg-border/10 px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Manager Actions</span>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1">
            <label htmlFor="plans-week-select" className="text-[11px] font-medium text-muted">Plans</label>
            <select
              id="plans-week-select"
              value={String(effectivePlanWeek)}
              onChange={e => setSelectedPlanWeek(Number(e.target.value))}
              className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {weeksDescending.map(week => {
                const count = weekReviewCounts[week.number]?.plans ?? 0;
                return (
                  <option key={`plan-week-${week.number}`} value={week.number}>
                    {week.name} ({count})
                  </option>
                );
              })}
            </select>
            <button
              onClick={() => startBatchReview('plans', effectivePlanWeek)}
              disabled={selectedPlanPendingCount === 0}
              aria-label={`Review Plans for ${selectedPlanWeekLabel} (${selectedPlanPendingCount} pending)`}
              title={`Review Plans for ${selectedPlanWeekLabel} (${selectedPlanPendingCount} pending)`}
              className={cn(
                'h-7 rounded px-2.5 text-xs font-medium transition-colors',
                selectedPlanPendingCount > 0
                  ? 'bg-yellow-600 text-white hover:bg-yellow-500'
                  : 'bg-border/40 text-muted cursor-not-allowed'
              )}
            >
              Review Plans
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1">
            <label htmlFor="retros-week-select" className="text-[11px] font-medium text-muted">Retros</label>
            <select
              id="retros-week-select"
              value={String(effectiveRetroWeek)}
              onChange={e => setSelectedRetroWeek(Number(e.target.value))}
              className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {weeksDescending.map(week => {
                const count = weekReviewCounts[week.number]?.retros ?? 0;
                return (
                  <option key={`retro-week-${week.number}`} value={week.number}>
                    {week.name} ({count})
                  </option>
                );
              })}
            </select>
            <button
              onClick={() => startBatchReview('retros', effectiveRetroWeek)}
              disabled={selectedRetroPendingCount === 0}
              aria-label={`Review Retros for ${selectedRetroWeekLabel} (${selectedRetroPendingCount} pending)`}
              title={`Review Retros for ${selectedRetroWeekLabel} (${selectedRetroPendingCount} pending)`}
              className={cn(
                'h-7 rounded px-2.5 text-xs font-medium transition-colors',
                selectedRetroPendingCount > 0
                  ? 'bg-yellow-600 text-white hover:bg-yellow-500'
                  : 'bg-border/40 text-muted cursor-not-allowed'
              )}
            >
              Review Retros
            </button>
          </div>

          {(selectedPlanPendingCount === 0 && selectedRetroPendingCount === 0) && (
            <span className="text-xs text-muted">No pending reviews in selected weeks.</span>
          )}
        </div>
      </div>

      {/* Grid container */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto pb-20">
        <div className="inline-flex min-w-full">
          {/* Sticky left column - Names */}
          <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
            {/* Header cell */}
            <div className="flex h-10 w-[240px] items-center border-b border-border px-3 sticky top-0 z-30 bg-background">
              <span className="text-xs font-medium text-muted">Program / Person</span>
            </div>

            {/* Rows */}
            {rowStructure.map((row, index) => {
              if (row.type === 'program') {
                return (
                  <button
                    key={`program-${row.id}`}
                    onClick={() => toggleProgram(row.id === '__unassigned__' ? null : row.id)}
                    className="flex h-10 w-[240px] items-center gap-2 border-b border-border bg-border/30 px-3 hover:bg-border/50 text-left"
                  >
                    <svg
                      className={cn('w-3 h-3 transition-transform', !collapsedPrograms.has(row.id) && 'rotate-90')}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    {row.color && (
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                        style={{ backgroundColor: row.color }}
                      >
                        {row.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="truncate text-xs font-medium">{row.name}</span>
                    <span className="ml-auto text-[10px] text-muted">{row.peopleCount}</span>
                  </button>
                );
              }

              // Person row
              return (
                <div
                  key={`person-${row.id}-${index}`}
                  className="flex h-10 w-[240px] items-center gap-2 border-b border-border pl-6 pr-3 bg-background"
                >
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white bg-accent/80">
                    {row.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate text-xs text-foreground">{row.name}</span>
                </div>
              );
            })}
          </div>

          {/* Week columns */}
          <div className="flex">
            {data.weeks.map(week => {
              const weekIsPast = week.number < data.currentSprintNumber;

              return (
                <div key={week.number} className="flex flex-col">
                  {/* Week header */}
                  <div
                    className={cn(
                      'flex h-10 w-[100px] flex-col items-center justify-center border-b border-r border-border px-2 sticky top-0 z-10 bg-background',
                      week.isCurrent && 'ring-1 ring-inset ring-accent/30'
                    )}
                  >
                    <span className={cn('text-xs font-medium', week.isCurrent ? 'text-accent' : 'text-foreground')}>
                      {week.name}
                    </span>
                    <span className="text-[10px] text-muted">
                      {formatDateRange(week.startDate, week.endDate)}
                    </span>
                  </div>

                  {/* Cells for each row */}
                  {rowStructure.map((row, index) => {
                    if (row.type === 'program') {
                      return (
                        <div
                          key={`program-${row.id}-week-${week.number}`}
                          className={cn(
                            'h-10 w-[100px] border-b border-r border-border bg-border/30',
                            week.isCurrent && 'bg-accent/5'
                          )}
                        />
                      );
                    }

                    const cell = row.personId ? data.reviews[row.personId]?.[week.number] : undefined;
                    const planStatus = getPlanStatus(cell, weekIsPast);
                    const retroStatus = getRetroStatus(cell, weekIsPast);

                    // Empty state - no sprint allocation
                    if (!cell || !cell.sprintId) {
                      return (
                        <div
                          key={`person-${row.id}-week-${week.number}-${index}`}
                          className={cn(
                            'flex h-10 w-[100px] items-center justify-center border-b border-r border-border',
                            week.isCurrent && 'bg-accent/5'
                          )}
                        >
                          <span className="text-xs text-muted">-</span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`person-${row.id}-week-${week.number}-${index}`}
                        className={cn(
                          'flex h-10 w-[100px] border-b border-r border-border overflow-hidden',
                          week.isCurrent && 'ring-1 ring-inset ring-accent/20'
                        )}
                      >
                        {/* Plan status (left half) */}
                        <button
                          onClick={() => {
                            if (cell.hasPlan && cell.planDocId) {
                              navigate(`/documents/${cell.planDocId}?review=true&sprintId=${cell.sprintId}`);
                            }
                          }}
                          className={cn(
                            'flex-1 h-full cursor-pointer transition-all hover:brightness-110 border-r border-white/20',
                            selectedCell?.personId === row.personId && selectedCell?.weekNumber === week.number && selectedCell?.type === 'plan' && 'ring-2 ring-inset ring-white/60'
                          )}
                          style={{ backgroundColor: REVIEW_COLORS[planStatus] }}
                          title={`Plan: ${REVIEW_STATUS_TEXT[planStatus]}`}
                          aria-label={`Plan: ${REVIEW_STATUS_TEXT[planStatus]} - ${row.name}`}
                        />
                        {/* Retro status (right half) */}
                        <button
                          onClick={() => {
                            if (cell.hasRetro && cell.retroDocId) {
                              navigate(`/documents/${cell.retroDocId}?review=true&sprintId=${cell.sprintId}`);
                            }
                          }}
                          className={cn(
                            'flex-1 h-full cursor-pointer transition-all hover:brightness-110',
                            selectedCell?.personId === row.personId && selectedCell?.weekNumber === week.number && selectedCell?.type === 'retro' && 'ring-2 ring-inset ring-white/60'
                          )}
                          style={{ backgroundColor: REVIEW_COLORS[retroStatus] }}
                          title={`Retro: ${REVIEW_STATUS_TEXT[retroStatus]}`}
                          aria-label={`Retro: ${REVIEW_STATUS_TEXT[retroStatus]} - ${row.name}`}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </div>

      {/* Review Panel - right side */}
      {selectedCell && (
        <ReviewPanel
          selectedCell={selectedCell}
          batchMode={batchMode}
          onClose={() => batchMode ? exitBatchMode() : setSelectedCell(null)}
          onApprovePlan={(personId, weekNumber, sprintId, comment) => {
            approvePlan(personId, weekNumber, sprintId, comment);
            setSelectedCell(prev => prev ? {
              ...prev,
              cell: {
                ...prev.cell,
                planApproval: {
                  state: 'approved',
                  approved_by: null,
                  approved_at: new Date().toISOString(),
                  comment: comment?.trim() || null,
                },
              },
            } : null);
            // Auto-advance in batch mode
            if (batchMode) setTimeout(advanceBatch, 300);
          }}
          onRateRetro={(personId, weekNumber, sprintId, rating, comment) => {
            rateRetro(personId, weekNumber, sprintId, rating, comment);
            setSelectedCell(prev => prev ? {
              ...prev,
              cell: {
                ...prev.cell,
                reviewApproval: {
                  state: 'approved',
                  approved_by: null,
                  approved_at: new Date().toISOString(),
                  comment: comment?.trim() || null,
                },
                reviewRating: { value: rating, rated_by: '', rated_at: new Date().toISOString() },
              },
            } : null);
            // Auto-advance in batch mode
            if (batchMode) setTimeout(advanceBatch, 300);
          }}
          onRequestChanges={(personId, weekNumber, sprintId, type, feedback) => {
            requestChanges(personId, weekNumber, sprintId, type, feedback);
            const approvalField = type === 'plan' ? 'planApproval' : 'reviewApproval';
            setSelectedCell(prev => prev ? {
              ...prev,
              cell: {
                ...prev.cell,
                [approvalField]: { state: 'changes_requested', approved_by: null, approved_at: new Date().toISOString(), feedback },
              },
            } : null);
            // Auto-advance in batch mode
            if (batchMode) setTimeout(advanceBatch, 300);
          }}
          onSkip={batchMode ? advanceBatch : undefined}
        />
      )}

      {/* Batch mode completion state */}
      {batchMode && batchMode.currentIndex >= batchMode.queue.length && (
        <div className="w-[400px] flex-shrink-0 border-l border-border bg-background flex flex-col items-center justify-center gap-4 p-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
            <svg className="w-8 h-8 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-foreground">
              All {batchMode.type === 'plans' ? 'plans' : 'retros'} reviewed!
            </div>
            <div className="text-xs text-muted mt-1">
              {batchMode.queue.length} item{batchMode.queue.length !== 1 ? 's' : ''} processed
            </div>
          </div>
          <button
            onClick={exitBatchMode}
            className="rounded bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/80"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

/** Panel for reviewing plan/retro content */
function ReviewPanel({
  selectedCell,
  batchMode,
  onClose,
  onApprovePlan,
  onRateRetro,
  onRequestChanges,
  onSkip,
}: {
  selectedCell: SelectedCell;
  batchMode: BatchMode | null;
  onClose: () => void;
  onApprovePlan: (personId: string, weekNumber: number, sprintId: string, comment?: string) => void;
  onRateRetro: (personId: string, weekNumber: number, sprintId: string, rating: number, comment?: string) => void;
  onRequestChanges: (personId: string, weekNumber: number, sprintId: string, type: 'plan' | 'retro', feedback: string) => void;
  onSkip?: () => void;
}) {
  const [planDoc, setPlanDoc] = useState<WeeklyDoc | null>(null);
  const [retroDoc, setRetroDoc] = useState<WeeklyDoc | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  // Fetch plan/retro content when selection changes
  useEffect(() => {
    setLoadingDocs(true);
    setPlanDoc(null);
    setRetroDoc(null);
    setSelectedRating(selectedCell.cell.reviewRating?.value ?? null);
    const existingComment = selectedCell.type === 'retro'
      ? selectedCell.cell.reviewApproval?.comment
      : selectedCell.cell.planApproval?.comment;
    setApprovalComment(existingComment ?? '');
    setShowFeedbackInput(false);
    setFeedbackText('');

    const fetchDocs = async () => {
      try {
        const params = new URLSearchParams({
          person_id: selectedCell.personId,
          week_number: String(selectedCell.weekNumber),
        });

        // Fetch plan and retro in parallel
        const [planRes, retroRes] = await Promise.all([
          apiGet(`/api/weekly-plans?${params}`),
          apiGet(`/api/weekly-retros?${params}`),
        ]);

        if (planRes.ok) {
          const plans = await readJson<WeeklyDoc[]>(planRes);
          if (plans.length > 0) setPlanDoc(plans[0]);
        }
        if (retroRes.ok) {
          const retros = await readJson<WeeklyDoc[]>(retroRes);
          if (retros.length > 0) setRetroDoc(retros[0]);
        }
      } catch (err) {
        console.error('Failed to fetch plan/retro:', err);
      } finally {
        setLoadingDocs(false);
      }
    };

    fetchDocs();
  }, [selectedCell.personId, selectedCell.weekNumber]);

  const isRetroMode = selectedCell.type === 'retro';
  const planApprovalState = selectedCell.cell.planApproval?.state;
  const canApprove = selectedCell.cell.hasPlan;

  return (
    <div className="w-[400px] flex-shrink-0 border-l border-border bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">{selectedCell.personName}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{selectedCell.weekName} &middot; {isRetroMode ? 'Retro' : 'Plan'}</span>
            {batchMode && (
              <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                {batchMode.currentIndex + 1} of {batchMode.queue.length}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onSkip && (
            <button
              onClick={onSkip}
              className="rounded px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-border/50"
            >
              Skip
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-foreground hover:bg-border/50"
            aria-label="Close panel"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loadingDocs ? (
          <div className="flex items-center justify-center py-12 text-muted text-sm">Loading...</div>
        ) : isRetroMode ? (
          /* Retro mode: side-by-side plan vs retro */
          <div className="flex flex-col h-full">
            {/* Plan context (dimmed) */}
            <div className="border-b border-border">
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted bg-border/20">Plan (context)</div>
              <div className="px-4 py-3 opacity-60">
                {planDoc ? (
                  <TipTapContent content={planDoc.content} />
                ) : (
                  <p className="text-sm text-muted italic">No plan submitted for this week</p>
                )}
              </div>
            </div>
            {/* Retro (primary) */}
            <div className="flex-1">
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted bg-border/20">Retro</div>
              <div className="px-4 py-3">
                {retroDoc ? (
                  <TipTapContent content={retroDoc.content} />
                ) : (
                  <p className="text-sm text-muted italic">No retro submitted for this week</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Plan mode: show plan content */
          <div className="px-4 py-3">
            {planDoc ? (
              <TipTapContent content={planDoc.content} />
            ) : (
              <p className="text-sm text-muted italic">No plan submitted for this week</p>
            )}
          </div>
        )}
      </div>

      {/* Previous feedback (when changes were already requested) */}
      {((isRetroMode && selectedCell.cell.reviewApproval?.state === 'changes_requested') ||
        (!isRetroMode && selectedCell.cell.planApproval?.state === 'changes_requested')) && (
        <div className="border-t border-border px-4 py-2 bg-purple-500/5">
          <div className="text-[10px] uppercase tracking-wider text-purple-400 mb-1">Previous Feedback</div>
          <p className="text-xs text-muted">
            {(isRetroMode ? (selectedCell.cell.reviewApproval as { feedback?: string })?.feedback : (selectedCell.cell.planApproval as { feedback?: string })?.feedback) || 'No feedback provided'}
          </p>
        </div>
      )}

      {/* Existing approval note */}
      {((isRetroMode && selectedCell.cell.reviewApproval?.comment) ||
        (!isRetroMode && selectedCell.cell.planApproval?.comment)) && (
        <div className="border-t border-border px-4 py-2 bg-border/20">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Approval Note</div>
          <p className="text-xs text-foreground">
            {isRetroMode ? selectedCell.cell.reviewApproval?.comment : selectedCell.cell.planApproval?.comment}
          </p>
        </div>
      )}

      {/* Action bar */}
      <div className="border-t border-border px-4 py-3">
        {showFeedbackInput ? (
          /* Feedback input for requesting changes */
          <div>
            <div className="text-xs text-muted mb-2">What needs to change?</div>
            <textarea
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              placeholder="Explain what needs to be revised..."
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:ring-1 focus:ring-purple-500"
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  if (feedbackText.trim()) {
                    onRequestChanges(
                      selectedCell.personId,
                      selectedCell.weekNumber,
                      selectedCell.sprintId,
                      selectedCell.type,
                      feedbackText.trim()
                    );
                    setShowFeedbackInput(false);
                    setFeedbackText('');
                  }
                }}
                disabled={!feedbackText.trim()}
                className={cn(
                  'flex-1 rounded py-2 text-sm font-medium transition-colors',
                  feedbackText.trim()
                    ? 'bg-purple-600 text-white hover:bg-purple-500 cursor-pointer'
                    : 'bg-border/30 text-muted cursor-not-allowed'
                )}
              >
                Submit Request
              </button>
              <button
                onClick={() => { setShowFeedbackInput(false); setFeedbackText(''); }}
                className="rounded px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-border/50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : isRetroMode ? (
          /* Rating controls for retro */
          <div>
            <div className="text-xs text-muted mb-2">Performance Rating</div>
            <div className="flex gap-1 mb-3">
              {OPM_RATINGS.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedRating(r.value)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-0.5 rounded py-1.5 text-xs transition-all',
                    selectedRating === r.value
                      ? 'bg-accent/20 ring-1 ring-accent'
                      : 'bg-border/30 hover:bg-border/50'
                  )}
                  title={r.label}
                >
                  <span className={cn('font-bold', r.color)}>{r.value}</span>
                  <span className="text-[9px] text-muted leading-tight">{r.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>
            <label className="text-xs text-muted mb-1 block">Approval Note (optional)</label>
            <textarea
              value={approvalComment}
              onChange={e => setApprovalComment(e.target.value)}
              placeholder="Add context for this decision..."
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (selectedRating) {
                    onRateRetro(
                      selectedCell.personId,
                      selectedCell.weekNumber,
                      selectedCell.sprintId,
                      selectedRating,
                      approvalComment
                    );
                  }
                }}
                disabled={!selectedRating || !retroDoc}
                className={cn(
                  'flex-1 rounded py-2 text-sm font-medium transition-colors',
                  selectedRating && retroDoc
                    ? 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                    : 'bg-border/30 text-muted cursor-not-allowed'
                )}
              >
                {selectedCell.cell.reviewRating ? 'Update Approval' : 'Rate & Approve'}
              </button>
              {retroDoc && (
                <button
                  onClick={() => setShowFeedbackInput(true)}
                  className="rounded px-3 py-2 text-sm font-medium text-purple-400 hover:bg-purple-500/10 transition-colors"
                >
                  Request Changes
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Plan actions: Approve + Request Changes */
          <div>
            <label className="text-xs text-muted mb-1 block">Approval Note (optional)</label>
            <textarea
              value={approvalComment}
              onChange={e => setApprovalComment(e.target.value)}
              placeholder="Add context for this decision..."
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => onApprovePlan(selectedCell.personId, selectedCell.weekNumber, selectedCell.sprintId, approvalComment)}
                disabled={!canApprove}
                className={cn(
                  'flex-1 rounded py-2 text-sm font-medium transition-colors',
                  planApprovalState === 'approved'
                    ? 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                    : canApprove
                      ? planApprovalState === 'changed_since_approved'
                        ? 'bg-orange-600 text-white hover:bg-orange-500 cursor-pointer'
                        : 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                      : 'bg-border/30 text-muted cursor-not-allowed'
                )}
              >
                {planApprovalState === 'approved'
                  ? 'Update Approval'
                  : planApprovalState === 'changed_since_approved'
                    ? 'Re-approve Plan'
                    : 'Approve Plan'}
              </button>
              {canApprove && (
                <button
                  onClick={() => setShowFeedbackInput(true)}
                  className="rounded px-3 py-2 text-sm font-medium text-purple-400 hover:bg-purple-500/10 transition-colors"
                >
                  Request Changes
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders TipTap JSON content as simple HTML */
function TipTapContent({ content }: { content: unknown }) {
  if (!content || typeof content !== 'object') {
    return <p className="text-sm text-muted italic">Empty</p>;
  }

  const doc = content as { type?: string; content?: unknown[] };
  if (!doc.content || !Array.isArray(doc.content)) {
    return <p className="text-sm text-muted italic">Empty</p>;
  }

  return (
    <div className="text-sm text-foreground space-y-2">
      {doc.content.map((node, i) => (
        <TipTapNode key={i} node={node} />
      ))}
    </div>
  );
}

function TipTapNode({ node }: { node: unknown }) {
  if (!node || typeof node !== 'object') return null;
  const n = node as { type?: string; content?: unknown[]; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string }> };

  if (n.type === 'text') {
    let text = <>{n.text}</>;
    if (n.marks) {
      for (const mark of n.marks) {
        if (mark.type === 'bold') text = <strong>{text}</strong>;
        if (mark.type === 'italic') text = <em>{text}</em>;
      }
    }
    return text;
  }

  const children = n.content?.map((child, i) => <TipTapNode key={i} node={child} />) ?? null;

  switch (n.type) {
    case 'heading': {
      const level = (n.attrs?.level as number) || 2;
      if (level === 1) return <h3 className="text-base font-semibold text-foreground">{children}</h3>;
      if (level === 2) return <h4 className="text-sm font-semibold text-foreground">{children}</h4>;
      return <h5 className="text-sm font-medium text-foreground">{children}</h5>;
    }
    case 'paragraph':
      return <p className="text-sm leading-relaxed">{children || '\u00A0'}</p>;
    case 'bulletList':
      return <ul className="list-disc pl-5 space-y-1">{children}</ul>;
    case 'listItem':
      return <li className="text-sm">{children}</li>;
    case 'blockquote':
      return <blockquote className="border-l-2 border-accent/50 pl-3 text-sm italic text-muted">{children}</blockquote>;
    default:
      return <div>{children}</div>;
  }
}

export default ReviewsPage;
