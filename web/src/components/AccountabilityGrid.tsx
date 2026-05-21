import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { readJson } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateRange } from '@/lib/date-utils';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface Sprint {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface ApprovalState {
  state: 'approved' | 'changed_since_approved' | null;
}

interface SprintAccountability {
  id: string;
  title: string;
  hasPlan: boolean;
  planApproval: ApprovalState | null;
  hasReview: boolean;
  reviewApproval: ApprovalState | null;
}

interface ProjectData {
  id: string;
  title: string;
  color: string;
  emoji?: string | null;
  programId?: string | null;
  programName?: string | null;
  programColor?: string | null;
  programEmoji?: string | null;
  hasPlan: boolean;
  planApproval: ApprovalState | null;
  hasRetro: boolean;
  retroApproval: ApprovalState | null;
  allocations: Record<number, number>; // sprintNumber -> personCount
}

interface AccountabilityGridData {
  weeks: Sprint[];
  currentSprintNumber: number;
  sprintAccountability: Record<number, SprintAccountability>;
  projects: ProjectData[];
}

// Group projects by program
interface ProgramGroup {
  programId: string | null;
  programName: string;
  programColor: string | null;
  programEmoji: string | null;
  projects: ProjectData[];
}

interface AccountabilityGridProps {
  showArchived?: boolean;
}

export function AccountabilityGrid({ showArchived = false }: AccountabilityGridProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<AccountabilityGridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const params = new URLSearchParams();
        if (showArchived) params.set('includeArchived', 'true');
        const url = `${API_URL}/api/team/accountability-grid${params.toString() ? `?${params}` : ''}`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
          if (res.status === 403) {
            setError('Admin access required to view accountability grid');
          } else {
            setError('Failed to load accountability data');
          }
          return;
        }
        const json = await readJson<AccountabilityGridData>(res);
        setData(json);
      } catch {
        setError('Failed to load accountability data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [showArchived]);

  // Scroll to current sprint on initial load
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentSprintIndex = data.weeks.findIndex(s => s.isCurrent);
      if (currentSprintIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 140;
            const scrollPosition = Math.max(0, (currentSprintIndex - 1) * columnWidth);
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [data]);

  // Group projects by program
  const programGroups = useMemo((): ProgramGroup[] => {
    if (!data) return [];

    const groups: Map<string, ProgramGroup> = new Map();
    const UNASSIGNED_KEY = '__unassigned__';

    for (const project of data.projects) {
      const groupKey = project.programId || UNASSIGNED_KEY;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          programId: project.programId || null,
          programName: project.programName || 'No Program',
          programColor: project.programColor || null,
          programEmoji: project.programEmoji || null,
          projects: [],
        });
      }

      const group = groups.get(groupKey);
      if (group) {
        group.projects.push(project);
      }
    }

    // Sort groups alphabetically, with "No Program" last
    return Array.from(groups.values()).sort((a, b) => {
      if (a.programId === null) return 1;
      if (b.programId === null) return -1;
      return a.programName.localeCompare(b.programName);
    });
  }, [data]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted">Loading accountability grid...</span>
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
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-auto pb-20"
    >
      <div className="inline-flex min-w-full">
        {/* Sticky left column - Sprint info */}
        <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
          {/* Header cell */}
          <div className="flex h-10 w-[180px] items-center justify-center border-b border-border px-3 sticky top-0 z-30 bg-background">
            <span className="text-xs font-medium text-muted">Week Accountability</span>
          </div>

          {/* Legend row */}
          <div className="flex h-10 w-[180px] items-center gap-2 border-b border-border px-3 bg-border/20">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted">P</span>
              <span className="text-[10px] text-muted">=</span>
              <span className="text-[10px] text-muted">Plan</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted">R</span>
              <span className="text-[10px] text-muted">=</span>
              <span className="text-[10px] text-muted">Review</span>
            </div>
          </div>

          {/* Program group headers with projects */}
          {programGroups.map((group) => (
            <div key={group.programId || '__unassigned__'}>
              {/* Program header */}
              <div className="flex h-8 w-[180px] items-center gap-2 border-b border-border bg-border/30 px-3">
                {group.programId ? (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: group.programColor || '#6b7280' }}
                  >
                    {group.programEmoji || group.programName[0]}
                  </span>
                ) : (
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white bg-gray-500">
                    ?
                  </span>
                )}
                <span className="truncate text-xs font-medium text-foreground">
                  {group.programName}
                </span>
                <span className="ml-auto text-[10px] text-muted">
                  {group.projects.length}
                </span>
              </div>

              {/* Project timeline lines (thin collapsed state) */}
              {group.projects.map((project) => {
                const isExpanded = expandedProjectId === project.id;
                return (
                  <div
                    key={project.id}
                    className={cn(
                      "flex w-[180px] items-center border-b border-border px-3 cursor-pointer transition-all duration-200",
                      isExpanded ? "h-10 bg-background" : "h-2"
                    )}
                    style={{
                      backgroundColor: isExpanded ? undefined : project.color,
                      opacity: isExpanded ? 1 : 0.6,
                    }}
                    onMouseEnter={() => setExpandedProjectId(project.id)}
                    onMouseLeave={() => setExpandedProjectId(null)}
                    onClick={() => navigate(`/documents/${project.id}`)}
                    title={project.title}
                  >
                    {isExpanded && (
                      <div className="flex items-center gap-2 overflow-hidden w-full">
                        <div
                          className="h-3 w-3 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: project.color }}
                        />
                        <span className="truncate text-xs font-medium text-foreground">
                          {project.title}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          {/* Plan status */}
                          <StatusIndicator
                            hasContent={project.hasPlan}
                            approvalState={project.planApproval?.state}
                            label="P"
                          />
                          {/* Retro status */}
                          <StatusIndicator
                            hasContent={project.hasRetro}
                            approvalState={project.retroApproval?.state}
                            label="R"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sprint columns */}
        <div className="flex">
          {data.weeks.map((sprint) => {
            const accountability = data.sprintAccountability[sprint.number];

            return (
              <div key={sprint.number} className="flex flex-col">
                {/* Sprint header */}
                <div
                  className={cn(
                    'flex h-10 w-[140px] flex-col items-center justify-center border-b border-r border-border px-2 sticky top-0 z-10 bg-background',
                    sprint.isCurrent && 'ring-1 ring-inset ring-accent/30'
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
                </div>

                {/* Sprint accountability cell - LEFT half hypothesis, RIGHT half review */}
                <SprintAccountabilityCell
                  accountability={accountability}
                  isCurrent={sprint.isCurrent}
                  onNavigate={(id) => navigate(`/documents/${id}`)}
                />

                {/* Program groups with project allocation cells */}
                {programGroups.map((group) => (
                  <div key={group.programId || '__unassigned__'}>
                    {/* Program header spacer */}
                    <div
                      className={cn(
                        "h-8 w-[140px] border-b border-r border-border bg-border/30",
                        sprint.isCurrent && "bg-accent/5"
                      )}
                    />

                    {/* Project allocation cells */}
                    {group.projects.map((project) => {
                      const isExpanded = expandedProjectId === project.id;
                      const allocationCount = project.allocations[sprint.number] || 0;
                      const hasAllocation = allocationCount > 0;

                      return (
                        <div
                          key={project.id}
                          className={cn(
                            "w-[140px] border-b border-r border-border cursor-pointer transition-all duration-200",
                            isExpanded ? "h-10" : "h-2",
                            sprint.isCurrent && "bg-accent/5"
                          )}
                          style={{
                            backgroundColor: isExpanded
                              ? undefined
                              : hasAllocation
                              ? project.color
                              : 'transparent',
                            opacity: isExpanded ? 1 : hasAllocation ? 0.6 : 1,
                          }}
                          onMouseEnter={() => setExpandedProjectId(project.id)}
                          onMouseLeave={() => setExpandedProjectId(null)}
                          onClick={() => navigate(`/documents/${project.id}`)}
                        >
                          {isExpanded && (
                            <div className="flex items-center justify-center h-full px-2">
                              {hasAllocation ? (
                                <span
                                  className="text-xs font-medium px-2 py-0.5 rounded"
                                  style={{ backgroundColor: project.color, color: 'white' }}
                                >
                                  {allocationCount} {allocationCount === 1 ? 'person' : 'people'}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted">-</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Sprint accountability cell with left/right split for plan/review
function SprintAccountabilityCell({
  accountability,
  isCurrent,
  onNavigate,
}: {
  accountability?: SprintAccountability;
  isCurrent: boolean;
  onNavigate: (id: string) => void;
}) {
  if (!accountability) {
    // No week document for this week number yet
    return (
      <div
        className={cn(
          "flex h-10 w-[140px] items-center justify-center border-b border-r border-border",
          isCurrent && "bg-accent/5"
        )}
      >
        <span className="text-[10px] text-muted">No week</span>
      </div>
    );
  }

  // Determine border color based on approval states
  const planApprovalState = accountability.planApproval?.state;
  const reviewApprovalState = accountability.reviewApproval?.state;

  // Border priority: yellow (changed) > green (approved) > none
  let borderClass = '';
  if (planApprovalState === 'changed_since_approved' || reviewApprovalState === 'changed_since_approved') {
    borderClass = 'ring-2 ring-yellow-500';
  } else if (planApprovalState === 'approved' && reviewApprovalState === 'approved') {
    borderClass = 'ring-2 ring-green-500';
  } else if (planApprovalState === 'approved' || reviewApprovalState === 'approved') {
    borderClass = 'ring-1 ring-green-500/50';
  }

  return (
    <div
      className={cn(
        "flex h-10 w-[140px] items-stretch border-b border-r border-border cursor-pointer hover:bg-border/20",
        isCurrent && "bg-accent/5",
        borderClass
      )}
      onClick={() => onNavigate(accountability.id)}
      title={`${accountability.title}\nClick to open week`}
    >
      {/* Left half - Plan */}
      <div className="flex-1 flex flex-col items-center justify-center border-r border-border/50">
        <span className="text-[9px] text-muted mb-0.5">P</span>
        <StatusIcon
          hasContent={accountability.hasPlan}
          approvalState={planApprovalState}
        />
      </div>

      {/* Right half - Review */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <span className="text-[9px] text-muted mb-0.5">R</span>
        <StatusIcon
          hasContent={accountability.hasReview}
          approvalState={reviewApprovalState}
        />
      </div>
    </div>
  );
}

// Status indicator for expanded project rows
function StatusIndicator({
  hasContent,
  approvalState,
  label,
}: {
  hasContent: boolean;
  approvalState?: 'approved' | 'changed_since_approved' | null;
  label: string;
}) {
  const bgColor = hasContent
    ? approvalState === 'approved'
      ? 'bg-green-500'
      : approvalState === 'changed_since_approved'
      ? 'bg-yellow-500'
      : 'bg-blue-500'
    : 'bg-gray-400';

  return (
    <div
      className={cn(
        "flex items-center justify-center h-4 w-4 rounded text-[8px] font-bold text-white",
        bgColor
      )}
      title={`${label === 'P' ? 'Plan' : label === 'R' ? 'Review/Retro' : label}: ${
        !hasContent ? 'Not written' :
        approvalState === 'approved' ? 'Approved' :
        approvalState === 'changed_since_approved' ? 'Changed since approved' :
        'Written (pending approval)'
      }`}
    >
      {hasContent ? (
        approvalState === 'approved' ? '✓' :
        approvalState === 'changed_since_approved' ? '!' :
        '●'
      ) : (
        '○'
      )}
    </div>
  );
}

// Status icon for sprint cells
function StatusIcon({
  hasContent,
  approvalState,
}: {
  hasContent: boolean;
  approvalState?: 'approved' | 'changed_since_approved' | null;
}) {
  if (!hasContent) {
    return (
      <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" strokeWidth="2" />
      </svg>
    );
  }

  if (approvalState === 'approved') {
    return (
      <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (approvalState === 'changed_since_approved') {
    return (
      <svg className="h-4 w-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
      </svg>
    );
  }

  // Written but not approved
  return (
    <svg className="h-4 w-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export default AccountabilityGrid;
