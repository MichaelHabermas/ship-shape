// My Week renders the personal weekly work surface and publishes FleetGraph page context.
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useMyWeekQuery } from '@/hooks/useMyWeekQuery';
import type { StandupSlot } from '@/hooks/useMyWeekQuery';
import { apiPost, readJson } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { FleetGraphPageContext } from '@ship/shared';
import { useFleetGraphPageContextRegistration } from '@/contexts/FleetGraphPageContext';

interface CreatedDocumentResponse {
  id: string;
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', yearOpts)}`;
}

function isDateInPast(dateStr: string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const date = new Date(dateStr + 'T00:00:00Z');
  return date < today;
}

function isDateToday(dateStr: string): boolean {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  return dateStr === todayStr;
}

export function MyWeekPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const weekNumberParam = searchParams.get('week_number');
  const weekNumber = weekNumberParam ? parseInt(weekNumberParam, 10) : undefined;

  const { data, isLoading, error } = useMyWeekQuery(weekNumber);
  const [creating, setCreating] = useState<string | null>(null);
  const fleetGraphPageContext = useMemo<FleetGraphPageContext | null>(() => {
    if (!data) return null;
    const visibleItems = [
      ...data.projects.slice(0, 10).map((project) => ({
        kind: 'project' as const,
        id: project.id,
        title: project.title,
        summary: project.program_name ?? undefined,
      })),
      ...(data.plan?.id ? [{
        kind: 'document' as const,
        id: data.plan.id,
        title: `Week ${data.week.week_number} plan`,
        state: data.plan.submitted_at ? 'submitted' : 'open',
      }] : []),
      ...(data.retro?.id ? [{
        kind: 'document' as const,
        id: data.retro.id,
        title: `Week ${data.week.week_number} retro`,
        state: data.retro.submitted_at ? 'submitted' : 'open',
      }] : []),
      ...data.standups.slice(0, 10).map((slot: StandupSlot) => ({
        kind: 'document' as const,
        id: slot.standup?.id,
        title: `Standup ${slot.date}`,
        state: slot.standup ? 'present' : 'missing',
      })),
    ].slice(0, 25);
    return {
      route: `${location.pathname}${location.search}${location.hash}`,
      surface: 'my_week',
      title: `My Week ${data.week.week_number}`,
      filters: { weekNumber: data.week.week_number, current: data.week.is_current },
      counts: {
        projects: data.projects.length,
        standups: data.standups.length,
        visible: visibleItems.length,
      },
      visibleItems,
    };
  }, [data, location.hash, location.pathname, location.search]);

  useFleetGraphPageContextRegistration(fleetGraphPageContext);

  const navigateToWeek = (wn: number) => {
    if (data && wn === data.week.current_week_number) {
      setSearchParams({});
    } else {
      setSearchParams({ week_number: String(wn) });
    }
  };

  const handleCreatePlan = async () => {
    if (!data) return;
    setCreating('plan');
    try {
      const res = await apiPost('/api/weekly-plans', {
        person_id: data.person_id,
        week_number: data.week.week_number,
      });
      if (res.ok) {
        const doc = await readJson<CreatedDocumentResponse>(res);
        navigate(`/documents/${doc.id}`);
      }
    } finally {
      setCreating(null);
    }
  };

  const handleCreateRetro = async (weekNum: number) => {
    if (!data) return;
    setCreating('retro');
    try {
      const res = await apiPost('/api/weekly-retros', {
        person_id: data.person_id,
        week_number: weekNum,
      });
      if (res.ok) {
        const doc = await readJson<CreatedDocumentResponse>(res);
        navigate(`/documents/${doc.id}`);
      }
    } finally {
      setCreating(null);
    }
  };

  const handleCreateStandup = async (date: string) => {
    setCreating(`standup-${date}`);
    try {
      const res = await apiPost('/api/standups', { date });
      if (res.ok) {
        const doc = await readJson<CreatedDocumentResponse>(res);
        navigate(`/documents/${doc.id}`);
      }
    } finally {
      setCreating(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Loading week...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-red-400">Failed to load week data</p>
      </div>
    );
  }

  const { week, plan, retro, previous_retro, standups, projects } = data;
  const showPreviousRetroNudge = week.is_current
    && previous_retro
    && previous_retro.id !== null
    ? !previous_retro.submitted_at
    : week.is_current && previous_retro && previous_retro.id === null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold text-foreground">Week {week.week_number}</h1>
          {week.is_current && (
            <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-white">Current</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateToWeek(week.week_number - 1)}
            className="p-1.5 rounded hover:bg-border/50 text-muted hover:text-foreground transition-colors"
            aria-label="Previous week"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm text-muted px-1.5">{formatDateRange(week.start_date, week.end_date)}</span>
          <button
            onClick={() => navigateToWeek(week.week_number + 1)}
            className="p-1.5 rounded hover:bg-border/50 text-muted hover:text-foreground transition-colors"
            aria-label="Next week"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* Project Assignments */}
        {projects.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Assigned Projects</h2>
            <div className="space-y-1.5">
              {projects.map(project => (
                <Link
                  key={project.id}
                  to={`/documents/${project.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 hover:border-accent/50 transition-colors"
                >
                  <span className="text-sm text-foreground">{project.title}</span>
                  {project.program_name && (
                    <span className="text-xs text-muted">{project.program_name}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Previous Week Retro Nudge */}
        {showPreviousRetroNudge && previous_retro && (
          <div className="mb-6 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-300">Last week's retro is not complete</p>
                <p className="text-xs text-orange-300/70 mt-0.5">Week {previous_retro.week_number} retro needs your input</p>
              </div>
              {previous_retro.id ? (
                <Link
                  to={`/documents/${previous_retro.id}`}
                  className="text-xs font-medium text-orange-300 hover:text-orange-200 underline"
                >
                  Complete retro
                </Link>
              ) : (
                <button
                  onClick={() => handleCreateRetro(previous_retro.week_number)}
                  disabled={creating === 'retro'}
                  className="text-xs font-medium text-orange-300 hover:text-orange-200 underline disabled:opacity-50"
                >
                  {creating === 'retro' ? 'Creating...' : 'Create retro'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Plan & Retro - two column layout */}
        <div className="grid grid-cols-2 gap-8 mb-6">
          <section>
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Weekly Plan</h2>
            {plan ? (
              <Link
                to={`/documents/${plan.id}`}
                className="block rounded-lg border border-border bg-surface p-4 hover:border-accent/50 transition-colors relative"
              >
                {(() => {
                  const isDue = !plan.submitted_at && week.week_number <= week.current_week_number && projects.length > 0;
                  const isSubmitted = !!plan.submitted_at;
                  const hasContent = (plan.items ?? []).length > 0;
                  if (isDue) {
                    return <span className="absolute top-3 right-3 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Due today</span>;
                  }
                  if (isSubmitted) {
                    return <span className="absolute top-3 right-3 text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Submitted</span>;
                  }
                  if (hasContent) {
                    return <span className="absolute top-3 right-3 text-xs bg-border text-muted px-1.5 py-0.5 rounded">Unsubmitted</span>;
                  }
                  return null;
                })()}
                {(plan.items ?? []).length > 0 ? (
                  <div className="space-y-0 max-h-[300px] overflow-hidden">
                    {plan.items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5 py-1.5">
                        <span className="text-[11px] font-semibold text-muted w-4 text-right shrink-0 mt-0.5">
                          {i + 1}.
                        </span>
                        <span className="text-sm text-foreground leading-relaxed">{item.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">+ Create plan for this week</p>
                )}
              </Link>
            ) : (() => {
              const isDue = week.week_number <= week.current_week_number && projects.length > 0;
              return (
                <button
                  onClick={handleCreatePlan}
                  disabled={creating === 'plan'}
                  className={cn(
                    'w-full rounded-lg border border-dashed px-4 py-3 text-sm transition-colors disabled:opacity-50 flex items-center justify-between',
                    isDue
                      ? 'border-red-500/40 text-red-400 font-semibold hover:border-red-500/60'
                      : 'border-border text-muted hover:border-accent/50 hover:text-foreground'
                  )}
                >
                  {isDue && (
                    <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">Due today</span>
                  )}
                  <span>{creating === 'plan' ? 'Creating...' : '+ Create plan for this week'}</span>
                </button>
              );
            })()}
          </section>

          <section>
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Weekly Retro</h2>
            {retro ? (
              <Link
                to={`/documents/${retro.id}`}
                className="block rounded-lg border border-border bg-surface p-4 hover:border-accent/50 transition-colors relative"
              >
                {(() => {
                  const todayDay = new Date().getDay(); // 0=Sun, 5=Fri, 6=Sat
                  const isFridayOrLater = todayDay === 0 || todayDay >= 5;
                  const retroDueForWeek = week.week_number < week.current_week_number || (week.week_number === week.current_week_number && isFridayOrLater);
                  const isDue = !retro.submitted_at && retroDueForWeek && projects.length > 0;
                  const isSubmitted = !!retro.submitted_at;
                  const hasContent = (retro.items ?? []).length > 0;
                  if (isDue) {
                    return <span className="absolute top-3 right-3 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Due today</span>;
                  }
                  if (isSubmitted) {
                    return <span className="absolute top-3 right-3 text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Submitted</span>;
                  }
                  if (hasContent) {
                    return <span className="absolute top-3 right-3 text-xs bg-border text-muted px-1.5 py-0.5 rounded">Unsubmitted</span>;
                  }
                  return null;
                })()}
                {(retro.items ?? []).length > 0 ? (
                  <div className="space-y-0 max-h-[300px] overflow-hidden">
                    {retro.items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5 py-1.5">
                        <span className="text-[11px] font-semibold text-muted w-4 text-right shrink-0 mt-0.5">
                          {i + 1}.
                        </span>
                        <span className="text-sm text-foreground leading-relaxed">{item.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">+ Create retro for this week</p>
                )}
              </Link>
            ) : (() => {
              const todayDay = new Date().getDay();
              const isFridayOrLater = todayDay === 0 || todayDay >= 5;
              const retroDueForWeek = week.week_number < week.current_week_number || (week.week_number === week.current_week_number && isFridayOrLater);
              const isDue = retroDueForWeek && projects.length > 0;
              return (
                <button
                  onClick={() => handleCreateRetro(week.week_number)}
                  disabled={creating === 'retro'}
                  className={cn(
                    'w-full rounded-lg border border-dashed px-4 py-3 text-sm transition-colors disabled:opacity-50 flex items-center justify-between',
                    isDue
                      ? 'border-red-500/40 text-red-400 font-semibold hover:border-red-500/60'
                      : 'border-border text-muted hover:border-accent/50 hover:text-foreground'
                  )}
                >
                  {isDue && (
                    <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">Due today</span>
                  )}
                  <span>{creating === 'retro' ? 'Creating...' : '+ Create retro for this week'}</span>
                </button>
              );
            })()}
          </section>
        </div>

        {/* Daily Updates */}
        <section className="mb-6">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Daily Updates</h2>
          <div className="space-y-1.5">
            {standups.map((slot: StandupSlot) => {
              const isPast = isDateInPast(slot.date);
              const isToday = isDateToday(slot.date);
              const isFuture = !isPast && !isToday;

              const rowClass = cn(
                'flex items-center gap-3 rounded-lg border px-4 py-2.5',
                isToday ? 'border-accent-hover/50 bg-accent/10' : 'border-border bg-surface',
                isFuture && 'border-border/60 bg-border/30',
                !isFuture && 'hover:border-accent/50 transition-colors'
              );

              const dateLabel = (
                <div className="w-20 flex-shrink-0">
                  <span className={cn('text-xs font-medium', isToday ? 'text-[#8fcfff]' : 'text-muted')}>
                    {slot.day.slice(0, 3)}
                  </span>
                  <span className="text-xs text-muted ml-1">
                    {new Date(slot.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
                  </span>
                </div>
              );

              const statusDot = slot.standup
                ? <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                : isPast
                  ? <div className="w-2 h-2 rounded-full bg-border flex-shrink-0" />
                  : null;

              if (slot.standup) {
                return (
                  <Link key={slot.date} to={`/documents/${slot.standup.id}`} className={rowClass}>
                    {dateLabel}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground truncate block">{slot.standup.title}</span>
                    </div>
                    {statusDot}
                  </Link>
                );
              }

              if (isFuture) {
                return (
                  <div key={slot.date} className={rowClass}>
                    {dateLabel}
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-muted italic">Upcoming</span>
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={slot.date}
                  onClick={() => handleCreateStandup(slot.date)}
                  disabled={creating === `standup-${slot.date}`}
                  className={cn(rowClass, 'w-full text-left cursor-pointer disabled:opacity-50')}
                >
                  {dateLabel}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-muted">
                      {creating === `standup-${slot.date}` ? 'Creating...' : '+ Write update'}
                    </span>
                  </div>
                  {statusDot}
                </button>
              );
            })}
          </div>
        </section>

      </div>
      </div>
    </div>
  );
}
