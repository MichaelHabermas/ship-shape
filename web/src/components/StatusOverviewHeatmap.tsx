import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { createOrGetWeeklyDocumentId } from '@/lib/accountability';
import { formatDateRange } from '@/lib/date-utils';

const API_URL = import.meta.env.VITE_API_URL ?? '';

type Status = 'done' | 'due' | 'late' | 'future' | 'changes_requested';

interface Week {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface PersonWeekData {
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  planId: string | null;
  planStatus: Status | null;
  retroId: string | null;
  retroStatus: Status | null;
}

interface Person {
  id: string;
  name: string;
  weeks: Record<number, PersonWeekData>;
}

interface Program {
  id: string;
  name: string;
  color: string;
  people: Person[];
}

interface AccountabilityGridV3Data {
  programs: Program[];
  weeks: Week[];
  currentSprintNumber: number;
}

// Status colors
const STATUS_COLORS: Record<Status, string> = {
  done: '#22c55e',   // green
  due: '#eab308',    // yellow
  late: '#ef4444',   // red
  changes_requested: '#ea580c', // orange
  future: '#6b7280', // gray
};

// User-friendly status text for tooltips
const STATUS_TEXT: Record<Status, string> = {
  done: 'done',
  due: 'due this week',
  late: 'late',
  changes_requested: 'changes requested',
  future: 'not yet due',
};

/**
 * StatusCell - Shows Plan/Retro status as two colored squares
 * For person-centric view: shows status based on allocated project
 */
function StatusCell({
  weekData,
  onPlanClick,
  onRetroClick,
  isNavigating,
}: {
  weekData: PersonWeekData;
  onPlanClick?: () => void;
  onRetroClick?: () => void;
  isNavigating?: 'plan' | 'retro' | null;
}) {
  // If no allocation for this week, show empty state
  if (!weekData.projectId || !weekData.planStatus || !weekData.retroStatus) {
    return (
      <div className="flex w-full h-full items-center justify-center">
        <span className="text-xs text-muted">-</span>
      </div>
    );
  }

  const projectTooltip = weekData.projectName ? ` (${weekData.projectName})` : '';

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
        style={{ backgroundColor: STATUS_COLORS[weekData.planStatus] }}
        title={`Weekly Plan (${STATUS_TEXT[weekData.planStatus]})${projectTooltip}`}
        aria-label={`Weekly Plan (${STATUS_TEXT[weekData.planStatus]})${projectTooltip}`}
      />
      {/* Retro status (right half) */}
      <button
        onClick={onRetroClick}
        disabled={isNavigating !== null}
        className={cn(
          'flex-1 h-full cursor-pointer transition-all hover:brightness-110',
          isNavigating === 'retro' && 'animate-pulse'
        )}
        style={{ backgroundColor: STATUS_COLORS[weekData.retroStatus] }}
        title={`Weekly Retro (${STATUS_TEXT[weekData.retroStatus]})${projectTooltip}`}
        aria-label={`Weekly Retro (${STATUS_TEXT[weekData.retroStatus]})${projectTooltip}`}
      />
    </div>
  );
}

interface StatusOverviewHeatmapProps {
  showArchived?: boolean;
}

export function StatusOverviewHeatmap({ showArchived = false }: StatusOverviewHeatmapProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<AccountabilityGridV3Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [navigatingCell, setNavigatingCell] = useState<{
    personId: string;
    weekNumber: number;
    type: 'plan' | 'retro';
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (showArchived) params.set('showArchived', 'true');
        const url = `${API_URL}/api/team/accountability-grid-v3${params.toString() ? `?${params}` : ''}`;
        const res = await fetch(url, { credentials: 'include' });

        if (!res.ok) {
          if (res.status === 403) {
            setError('Admin access required to view accountability grid');
          } else {
            setError('Failed to load accountability data');
          }
          return;
        }

        const json: AccountabilityGridV3Data = await res.json();
        setData(json);

        // Auto-expand all programs by default
        setExpandedPrograms(new Set(json.programs.map(p => p.id)));
      } catch {
        setError('Failed to load accountability data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [showArchived]);

  // Scroll to current week on initial load
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

  // Navigate to weekly plan or retro
  async function handleNavigate(
    personId: string,
    weekNumber: number,
    type: 'plan' | 'retro',
    existingDocId: string | null,
    projectId: string | null
  ) {
    if (existingDocId) {
      navigate(`/documents/${existingDocId}`);
      return;
    }

    setNavigatingCell({ personId, weekNumber, type });
    try {
      const documentId = await createOrGetWeeklyDocumentId({
        kind: type,
        personId,
        projectId: projectId || undefined,
        weekNumber,
      });
      if (documentId) {
        navigate(`/documents/${documentId}`);
      } else {
        console.error(`Failed to create weekly ${type}: request returned no document id`);
      }
    } catch (err) {
      console.error(`Failed to create weekly ${type}:`, err);
    } finally {
      setNavigatingCell(null);
    }
  }

  function toggleProgram(programId: string) {
    setExpandedPrograms(prev => {
      const next = new Set(prev);
      if (next.has(programId)) {
        next.delete(programId);
      } else {
        next.add(programId);
      }
      return next;
    });
  }

  // Build row structure: Program → Person (no project level)
  const rowStructure = useMemo(() => {
    if (!data) return [];

    const rows: Array<{
      type: 'program' | 'person';
      id: string;
      name: string;
      color?: string;
      depth: number;
      personData?: Person;
    }> = [];

    for (const program of data.programs) {
      rows.push({
        type: 'program',
        id: program.id,
        name: program.name,
        color: program.color,
        depth: 0,
      });

      if (expandedPrograms.has(program.id)) {
        for (const person of program.people) {
          rows.push({
            type: 'person',
            id: person.id,
            name: person.name,
            depth: 1,
            personData: person,
          });
        }
      }
    }

    return rows;
  }, [data, expandedPrograms]);

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

  if (!data || data.programs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted p-8">
        <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
        <p className="text-lg font-medium mb-2">No team members with allocations</p>
        <p className="text-sm text-center max-w-md">
          Assign team members to projects in the Allocation view to see their plan/retro status here.
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
          {/* Sticky left column - Hierarchy */}
          <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
            {/* Header cell */}
            <div className="flex h-10 w-[240px] items-center border-b border-border px-3 sticky top-0 z-30 bg-background">
              <span className="text-xs font-medium text-muted">Program / Person</span>
            </div>

            {/* Hierarchy rows */}
            {rowStructure.map((row, index) => {
              if (row.type === 'program') {
                return (
                  <button
                    key={`program-${row.id}`}
                    onClick={() => toggleProgram(row.id)}
                    className="flex h-10 w-[240px] items-center gap-2 border-b border-border bg-border/30 px-3 hover:bg-border/50 text-left"
                  >
                    <svg
                      className={cn('w-3 h-3 transition-transform', expandedPrograms.has(row.id) && 'rotate-90')}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: row.color || '#6b7280' }}
                    >
                      {row.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate text-xs font-medium">{row.name}</span>
                    <span className="ml-auto text-[10px] text-muted">
                      {data.programs.find(p => p.id === row.id)?.people.length || 0}
                    </span>
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
            {data.weeks.map((week) => (
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
                    // Empty cell for program header row
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

                  // Person cell - get their allocation data for this week
                  const person = row.personData;
                  const weekData = person?.weeks[week.number];

                  if (!weekData) {
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
                      <StatusCell
                        weekData={weekData}
                        onPlanClick={() =>
                          handleNavigate(row.id, week.number, 'plan', weekData.planId, weekData.projectId)
                        }
                        onRetroClick={() =>
                          handleNavigate(row.id, week.number, 'retro', weekData.retroId, weekData.projectId)
                        }
                        isNavigating={
                          navigatingCell?.personId === row.id &&
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

export default StatusOverviewHeatmap;
