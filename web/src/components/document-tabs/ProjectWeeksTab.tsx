import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { createOrGetWeeklyDocumentId } from '@/lib/accountability';
import { formatDateRange } from '@/lib/date-utils';
import type { DocumentTabProps } from '@/lib/document-tabs';

const API_URL = import.meta.env.VITE_API_URL ?? '';

type Status = 'done' | 'due' | 'late' | 'future';

interface Week {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface PersonWeekData {
  isAllocated: boolean;
  planId: string | null;
  planStatus: Status;
  retroId: string | null;
  retroStatus: Status;
}

interface Person {
  id: string;
  name: string;
  weeks: Record<number, PersonWeekData>;
}

interface AllocationGridData {
  projectId: string;
  projectTitle: string;
  currentSprintNumber: number;
  weeks: Week[];
  people: Person[];
}

// Status colors
const STATUS_COLORS: Record<Status, string> = {
  done: '#22c55e',   // green
  due: '#eab308',    // yellow
  late: '#ef4444',   // red
  future: '#6b7280', // gray
};

// User-friendly status text for tooltips
const STATUS_TEXT: Record<Status, string> = {
  done: 'done',
  due: 'due this week',
  late: 'late',
  future: 'not yet due',
};

/**
 * StatusCell - Shows Plan/Retro status as two colored squares
 */
function StatusCell({
  planStatus,
  retroStatus,
  onPlanClick,
  onRetroClick,
  isNavigating,
}: {
  planStatus: Status;
  retroStatus: Status;
  onPlanClick?: () => void;
  onRetroClick?: () => void;
  isNavigating?: 'plan' | 'retro' | null;
}) {
  return (
    <div className="flex w-full h-full">
      {/* Plan status (left half) */}
      <button
        onClick={onPlanClick}
        disabled={isNavigating !== null}
        className={cn(
          'flex-1 h-full cursor-pointer transition-all hover:brightness-110 border-r border-white/20',
          isNavigating === 'plan' && 'animate-pulse'
        )}
        style={{ backgroundColor: STATUS_COLORS[planStatus] }}
        title={`Weekly Plan (${STATUS_TEXT[planStatus]})`}
      />
      {/* Retro status (right half) */}
      <button
        onClick={onRetroClick}
        disabled={isNavigating !== null}
        className={cn(
          'flex-1 h-full cursor-pointer transition-all hover:brightness-110',
          isNavigating === 'retro' && 'animate-pulse'
        )}
        style={{ backgroundColor: STATUS_COLORS[retroStatus] }}
        title={`Weekly Retro (${STATUS_TEXT[retroStatus]})`}
      />
    </div>
  );
}

/**
 * ProjectWeeksTab - Shows plan/retro status for team members allocated to this project
 *
 * Each cell shows two colored squares:
 * - Left: Weekly Plan status
 * - Right: Weekly Retro status
 *
 * Colors: green (done), yellow (due), red (late), gray (future)
 */
export default function ProjectWeeksTab({ documentId }: DocumentTabProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<AllocationGridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navigatingCell, setNavigatingCell] = useState<{
    personId: string;
    weekNumber: number;
    type: 'plan' | 'retro';
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  /**
   * Navigate to a weekly plan or retro document.
   * Creates the document if it doesn't exist yet.
   */
  async function handleNavigate(
    personId: string,
    weekNumber: number,
    type: 'plan' | 'retro',
    existingDocId: string | null
  ) {
    // If document already exists, navigate directly
    if (existingDocId) {
      navigate(`/documents/${existingDocId}`);
      return;
    }

    // Create the document first
    setNavigatingCell({ personId, weekNumber, type });
    try {
      const createdDocumentId = await createOrGetWeeklyDocumentId({
        kind: type,
        personId,
        projectId: documentId || undefined,
        weekNumber,
      });
      if (createdDocumentId) {
        navigate(`/documents/${createdDocumentId}`);
      } else {
        console.error(`Failed to create weekly ${type}: request returned no document id`);
      }
    } catch (err) {
      console.error(`Failed to create weekly ${type}:`, err);
    } finally {
      setNavigatingCell(null);
    }
  }

  // Fetch data on mount
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const res = await fetch(
          `${API_URL}/api/weekly-plans/project-allocation-grid/${documentId}`,
          { credentials: 'include' }
        );

        if (!res.ok) {
          throw new Error('Failed to load allocation data');
        }

        const gridData: AllocationGridData = await res.json();
        setData(gridData);
      } catch {
        setError('Failed to load allocation data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [documentId]);

  // Filter to only show weeks where at least one person is allocated
  const visibleWeeks = useMemo(() => {
    if (!data) return [];
    return data.weeks;
  }, [data]);

  // Scroll to current week on initial load
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current && data.people.length > 0) {
      const currentWeekIndex = visibleWeeks.findIndex((w) => w.isCurrent);
      if (currentWeekIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 140;
            const scrollPosition = currentWeekIndex * columnWidth;
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [data, visibleWeeks]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
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

  if (error && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  // Empty state when no allocations
  if (!data || data.people.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted p-8">
        <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
        <p className="text-lg font-medium mb-2">No team allocations</p>
        <p className="text-sm text-center max-w-md">
          Assign team members to this project in Team → Allocation to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs">
        <span className="text-muted">Status:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLORS.done }} />
          <span>Done</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLORS.due }} />
          <span>Due</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLORS.late }} />
          <span>Late</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLORS.future }} />
          <span>Future</span>
        </div>
        <span className="text-muted ml-4">|</span>
        <span className="text-muted">Left = Plan, Right = Retro</span>
      </div>

      {/* Grid container */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto pb-20">
        <div className="inline-flex min-w-full">
          {/* Sticky left column - Team members */}
          <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
            {/* Header cell */}
            <div className="flex h-10 w-[180px] items-center border-b border-border px-3 sticky top-0 z-30 bg-background">
              <span className="text-xs font-medium text-muted">Team Member</span>
            </div>

            {/* Users */}
            {data.people.map((person) => (
              <div
                key={person.id}
                className="flex h-12 w-[180px] items-center border-b border-border px-3 bg-background"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white bg-accent/80">
                    {person.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate text-sm text-foreground">
                    {person.name}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Week columns */}
          <div className="flex">
            {visibleWeeks.map((week) => (
              <div key={week.number} className="flex flex-col">
                {/* Week header */}
                <div
                  className={cn(
                    'flex h-10 w-[140px] flex-col items-center justify-center border-b border-r border-border px-2 sticky top-0 z-10 bg-background',
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

                {/* User cells for this week */}
                {data.people.map((person) => {
                  const weekData = person.weeks[week.number];

                  // If not allocated to this project this week, show empty cell
                  if (!weekData?.isAllocated) {
                    return (
                      <div
                        key={person.id}
                        className={cn(
                          'flex h-12 w-[140px] items-center justify-center border-b border-r border-border',
                          week.isCurrent && 'bg-accent/5'
                        )}
                      >
                        <span className="text-xs text-muted">-</span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={person.id}
                      className={cn(
                        'flex h-12 w-[140px] border-b border-r border-border overflow-hidden',
                        week.isCurrent && 'bg-accent/5'
                      )}
                    >
                      <StatusCell
                        planStatus={weekData.planStatus}
                        retroStatus={weekData.retroStatus}
                        onPlanClick={() =>
                          handleNavigate(person.id, week.number, 'plan', weekData.planId)
                        }
                        onRetroClick={() =>
                          handleNavigate(person.id, week.number, 'retro', weekData.retroId)
                        }
                        isNavigating={
                          navigatingCell?.personId === person.id &&
                          navigatingCell?.weekNumber === week.number
                            ? navigatingCell.type
                            : null
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
