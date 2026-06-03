import { cn } from '@/lib/cn';
import { formatDateRange } from '@/lib/date-utils';
import { REVIEW_COLORS, REVIEW_STATUS_TEXT, type ReviewsData, type SelectedCell, type BatchMode } from './reviews-types.js';
import { getPlanStatus, getRetroStatus } from './reviews-status.js';
import { ReviewPanel } from './ReviewPanel.js';

export type ReviewsPageLayoutProps = {
  data: ReviewsData;
  hasDirectReports: boolean;
  filterMode: 'my-team' | 'everyone' | null;
  setFilterMode: (mode: 'my-team' | 'everyone') => void;
  rowStructure: Array<{ type: 'program' | 'person'; id: string; name: string; color?: string | null; personId?: string; peopleCount?: number }>;
  collapsedPrograms: Set<string>;
  toggleProgram: (programId: string | null) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  weeksDescending: ReviewsData['weeks'];
  weekReviewCounts: Record<number, { plans: number; retros: number }>;
  effectivePlanWeek: number;
  effectiveRetroWeek: number;
  selectedPlanPendingCount: number;
  selectedRetroPendingCount: number;
  selectedPlanWeekLabel: string;
  selectedRetroWeekLabel: string;
  setSelectedPlanWeek: (n: number) => void;
  setSelectedRetroWeek: (n: number) => void;
  startBatchReview: (type: 'plans' | 'retros', weekNumber: number) => void;
  selectedCell: SelectedCell | null;
  batchMode: BatchMode | null;
  navigate: ReturnType<typeof import('react-router-dom').useNavigate>;
  setSelectedCell: React.Dispatch<React.SetStateAction<SelectedCell | null>>;
  exitBatchMode: () => void;
  advanceBatch: () => void;
  approvePlan: (personId: string, weekNumber: number, sprintId: string, comment?: string) => void;
  rateRetro: (personId: string, weekNumber: number, sprintId: string, rating: number, comment?: string) => void;
  requestChanges: (personId: string, weekNumber: number, sprintId: string, type: 'plan' | 'retro', feedback: string) => void;
};

export function ReviewsPageLayout(props: ReviewsPageLayoutProps) {
  const {
    data, hasDirectReports, filterMode, setFilterMode, rowStructure, collapsedPrograms, toggleProgram,
    scrollContainerRef, weeksDescending, weekReviewCounts, effectivePlanWeek, effectiveRetroWeek,
    selectedPlanPendingCount, selectedRetroPendingCount, selectedPlanWeekLabel, selectedRetroWeekLabel,
    setSelectedPlanWeek, setSelectedRetroWeek, startBatchReview, selectedCell, batchMode, navigate,
    setSelectedCell, exitBatchMode, advanceBatch, approvePlan, rateRetro, requestChanges,
  } = props;

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
