import { Link } from 'react-router-dom';
import { useDashboardActionItems, ActionItem } from '@/hooks/useDashboardActionItems';
import { useDashboardFocus, ProjectFocus } from '@/hooks/useDashboardFocus';
import { cn } from '@/lib/cn';

export function DashboardVariantC() {
  const { data: actionItemsData, isLoading: actionItemsLoading } = useDashboardActionItems();
  const { data: focusData, isLoading: focusLoading } = useDashboardFocus();

  const actionItems = actionItemsData?.action_items || [];
  const projects = focusData?.projects || [];
  const weekNumber = focusData?.current_week_number || 0;

  const loading = actionItemsLoading || focusLoading;

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  const allComplete = actionItems.length === 0;

  // Build timeline data
  const timelineItems = buildTimeline(actionItems, weekNumber);

  // Sort action items by urgency (overdue first)
  const sortedActions = [...actionItems].sort((a, b) => {
    const order = { overdue: 0, due_today: 1, due_soon: 2, upcoming: 3 };
    return order[a.urgency] - order[b.urgency];
  });

  // Find next upcoming ritual for the "what's next" pill
  const nextRitual = findNextRitual(weekNumber);

  return (
    <div className="space-y-6">
      {/* Week Timeline */}
      <WeekTimeline items={timelineItems} allComplete={allComplete} />

      {/* Prompt Cards or Zen Card */}
      {allComplete ? (
        <div className="rounded-lg border border-green-500/20 bg-background p-6 text-center">
          <div className="text-base font-semibold text-green-400">
            You're in the zone
          </div>
          <div className="text-sm text-muted mt-1">
            All rituals complete. Focus on your plan.
          </div>
          {nextRitual && (
            <div className="flex justify-center mt-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted bg-[#1a1a1a] px-3 py-1.5 rounded">
                <span className="h-1.5 w-1.5 rounded-full bg-muted/50" />
                {nextRitual}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {sortedActions.map((item) => (
            <PromptCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Your Focus */}
      <div>
        <h2 className="text-xs font-semibold text-muted/60 uppercase tracking-wider mb-3">
          Your Focus{allComplete ? ' This Week' : ''}
        </h2>

        {projects.length > 0 ? (
          <div className="space-y-4">
            {projects.map((project) => (
              <FocusCard
                key={project.id}
                project={project}
                weekNumber={weekNumber}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm text-muted">No project allocations found.</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface TimelineDay {
  label: string;
  rituals: Array<{
    label: string;
    status: 'overdue' | 'due' | 'done' | 'future';
    sprintId?: string;
  }>;
}

function buildTimeline(actionItems: ActionItem[], weekNumber: number): TimelineDay[] {
  const days: TimelineDay[] = [
    { label: 'Mon', rituals: [] },
    { label: 'Tue', rituals: [] },
    { label: 'Wed', rituals: [] },
    { label: 'Thu', rituals: [] },
    { label: 'Fri', rituals: [] },
    { label: 'Sat', rituals: [] },
    { label: 'Sun', rituals: [] },
  ];

  // Plans are due Monday
  const planItem = actionItems.find(a => a.type === 'plan' && a.sprint_number === weekNumber);
  if (planItem) {
    days[0].rituals.push({
      label: `Plan W${weekNumber}`,
      status: planItem.urgency === 'overdue' ? 'overdue' : 'due',
      sprintId: planItem.sprint_id,
    });
  } else {
    days[0].rituals.push({
      label: `Plan W${weekNumber}`,
      status: 'done',
    });
  }

  // Retro for previous week is also due Monday
  const retroItem = actionItems.find(a => a.type === 'retro' && a.sprint_number === weekNumber - 1);
  if (retroItem) {
    days[0].rituals.push({
      label: `Retro W${weekNumber - 1}`,
      status: retroItem.urgency === 'overdue' ? 'overdue' : 'due',
      sprintId: retroItem.sprint_id,
    });
  } else {
    days[0].rituals.push({
      label: `Retro W${weekNumber - 1}`,
      status: 'done',
    });
  }

  // Retro for current week is due Thursday
  days[3].rituals.push({
    label: `Retro W${weekNumber}`,
    status: 'future',
  });

  return days;
}

function findNextRitual(weekNumber: number): string | null {
  const today = new Date();
  const dayOfWeek = today.getDay();

  // If before Thursday, next ritual is retro on Thursday
  if (dayOfWeek < 4) {
    return `Retro W${weekNumber} due Thursday`;
  }
  // If Thursday or after, next ritual is plan for next week on Monday
  return `Plan W${weekNumber + 1} due Monday`;
}

function WeekTimeline({ items, allComplete: _allComplete }: { items: TimelineDay[]; allComplete: boolean }) {
  const today = new Date();
  const jsDay = today.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  // Convert to Mon=0 ... Sun=6 to match our items array
  const dayIndex = jsDay === 0 ? 6 : jsDay - 1;

  return (
    <div className="flex rounded-lg border border-border overflow-hidden">
      {items.map((day, i) => {
        const isToday = i === dayIndex;

        return (
          <div
            key={day.label}
            className={cn(
              'flex-1 px-3 py-3 border-r border-border/50 last:border-r-0 relative',
              isToday && 'bg-[#1a1a1a]'
            )}
          >
            {isToday && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
            )}
            <div className={cn(
              'text-[10px] font-semibold uppercase tracking-wider mb-1.5',
              isToday ? 'text-accent' : 'text-muted/50'
            )}>
              {day.label}
            </div>
            {day.rituals.map((ritual, j) => {
              const dotColor = {
                overdue: 'bg-red-500',
                due: 'bg-amber-500',
                done: 'bg-green-500',
                future: 'bg-muted/50',
              };
              const textColor = {
                overdue: 'text-red-300',
                due: 'text-amber-300',
                done: 'text-green-300',
                future: 'text-muted/50',
              };

              const content = (
                <div key={j} className={cn('flex items-center gap-1.5 text-[11px] font-medium mt-1', textColor[ritual.status])}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', dotColor[ritual.status])} />
                  {ritual.label}
                </div>
              );

              if (ritual.sprintId) {
                return (
                  <Link key={j} to={`/documents/${ritual.sprintId}`} className="block hover:opacity-80">
                    {content}
                  </Link>
                );
              }
              return content;
            })}
          </div>
        );
      })}
    </div>
  );
}

function PromptCard({ item }: { item: ActionItem }) {
  const isOverdue = item.urgency === 'overdue';
  const isRetro = item.type === 'retro';

  const description = isRetro
    ? `Reflect on last week's plan for ${item.program_name}. Your retro will auto-populate with your plan items so you can mark what was completed and note what carried over.`
    : `What are you planning to accomplish this week on ${item.program_name}?`;

  return (
    <div className={cn(
      'rounded-lg border bg-background p-6',
      isOverdue ? 'border-red-500/30' : 'border-amber-500/30'
    )}>
      <div className={cn(
        'text-[10px] font-semibold uppercase tracking-wider mb-2',
        isOverdue ? 'text-red-300' : 'text-amber-300'
      )}>
        {isOverdue ? 'Overdue' : 'Due today'}
      </div>
      <div className="text-lg font-semibold text-foreground mb-1.5">
        Write your Week {item.sprint_number} {item.type}
      </div>
      <div className="text-sm text-muted leading-relaxed mb-4">
        {description}
      </div>
      <div className="text-xs text-muted/60 mb-4">
        {item.program_name}
      </div>
      <div className="flex gap-2">
        <Link
          to={`/documents/${item.sprint_id}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
        >
          Write {item.type} &rarr;
        </Link>
        {isRetro && (
          <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground hover:border-muted transition-colors">
            View last week's plan
          </button>
        )}
      </div>
    </div>
  );
}

function FocusCard({
  project,
  weekNumber,
}: {
  project: ProjectFocus;
  weekNumber: number;
}) {
  const plan = project.plan || project.previous_plan;

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-sm bg-accent shrink-0" />
          <span className="text-sm font-semibold text-foreground">{project.title}</span>
        </div>
        <span className="text-xs text-muted">
          Week {plan?.week_number || weekNumber} plan
        </span>
      </div>

      {plan && plan.items.length > 0 ? (
        <div className="space-y-0">
          {plan.items.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1.5">
              <span className="text-[11px] font-semibold text-muted/50 w-4 text-right shrink-0 mt-0.5">
                {i + 1}.
              </span>
              <span className="text-sm text-foreground leading-relaxed">{item.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted">
          No plan written yet &mdash;{' '}
          <Link to={`/documents/${project.id}`} className="text-accent hover:underline">
            Write your plan
          </Link>
        </div>
      )}
    </div>
  );
}
