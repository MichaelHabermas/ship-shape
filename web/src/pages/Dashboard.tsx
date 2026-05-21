import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useActiveWeeksQuery, ActiveWeek } from '@/hooks/useWeeksQuery';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { useDashboardActionItems } from '@/hooks/useDashboardActionItems';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/date-utils';
import { DashboardVariantC } from '@/components/dashboard/DashboardVariantC';

type DashboardView = 'my-work' | 'overview';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface Standup {
  id: string;
  sprint_id: string;
  title: string;
  content: unknown;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
  created_at: string;
  updated_at: string;
  sprint_title?: string;
  program_name?: string;
}

// Helper to extract text from TipTap content
function extractTextFromContent(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const doc = content as { content?: Array<{ content?: Array<{ text?: string }> }> };
  if (!doc.content) return '';

  const texts: string[] = [];
  for (const block of doc.content) {
    if (block.content) {
      for (const inline of block.content) {
        if (inline.text) texts.push(inline.text);
      }
    }
  }
  return texts.join(' ').slice(0, 200) + (texts.join(' ').length > 200 ? '...' : '');
}

export function DashboardPage() {
  const [searchParams] = useSearchParams();
  const currentView: DashboardView = (searchParams.get('view') as DashboardView) || 'my-work';

  const { data: weeksData, isLoading: weeksLoading } = useActiveWeeksQuery();
  const { projects, loading: projectsLoading } = useProjects();
  const { data: actionItemsData } = useDashboardActionItems();
  const [recentStandups, setRecentStandups] = useState<Standup[]>([]);
  const [standupsLoading, setStandupsLoading] = useState(true);

  const activeWeeks = weeksData?.weeks || [];
  const actionItems = actionItemsData?.action_items || [];

  // Fetch recent standups from all active sprints
  useEffect(() => {
    async function fetchStandups() {
      if (activeWeeks.length === 0) {
        setStandupsLoading(false);
        return;
      }

      try {
        const allStandups: Standup[] = [];

        const responses = await Promise.all(
          activeWeeks.map(async (sprint) => {
            const res = await fetch(`${API_URL}/api/weeks/${sprint.id}/standups`, {
              credentials: 'include',
            });
            if (res.ok) {
              const standups: Standup[] = await res.json();
              return standups.map(s => ({
                ...s,
                sprint_id: sprint.id,
                sprint_title: sprint.name,
                program_name: sprint.program_name,
              }));
            }
            return [];
          })
        );

        responses.forEach(standups => allStandups.push(...standups));
        allStandups.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        setRecentStandups(allStandups.slice(0, 10));
      } catch (err) {
        console.error('Failed to fetch standups:', err);
      } finally {
        setStandupsLoading(false);
      }
    }

    if (!weeksLoading) {
      fetchStandups();
    }
  }, [activeWeeks, weeksLoading]);

  const projectSummary = {
    active: projects.filter(p => !p.archived_at).length,
    archived: projects.filter(p => p.archived_at).length,
    total: projects.length,
  };

  const topProjects = [...projects]
    .filter(p => !p.archived_at)
    .sort((a, b) => (b.ice_score || 0) - (a.ice_score || 0))
    .slice(0, 5);

  const loading = weeksLoading || projectsLoading;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading dashboard...</div>
      </div>
    );
  }

  // Filter overdue items for blocking banner
  const overdueItems = actionItems.filter(item => item.urgency === 'overdue');

  return (
    <div className="h-full overflow-auto pb-20">
      {/* Blocking Banner for Overdue Items */}
      {overdueItems.length > 0 && (
        <div className="bg-red-600 text-white px-6 py-3">
          <div className="mx-auto max-w-6xl">
            {overdueItems.length === 1 ? (
              <Link
                to={`/documents/${overdueItems[0].sprint_id}`}
                className="flex items-center gap-2 hover:underline"
              >
                <span className="font-medium">
                  {overdueItems[0].program_name} Week {overdueItems[0].sprint_number} is missing a {overdueItems[0].type}
                </span>
                <span className="text-red-200">&rarr; Write now</span>
              </Link>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">
                  {overdueItems.length} overdue weekly documents need your attention:
                </div>
                <div className="flex flex-wrap gap-3">
                  {overdueItems.map(item => (
                    <Link
                      key={item.id}
                      to={`/documents/${item.sprint_id}`}
                      className="text-sm hover:underline text-red-100"
                    >
                      {item.program_name} Week {item.sprint_number} ({item.type}) &rarr;
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {currentView === 'my-work' ? 'My Work' : 'Dashboard'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {currentView === 'my-work'
                ? 'What you need to do right now'
                : 'Cross-program overview of work transparency'}
            </p>
          </div>

          {currentView === 'my-work' ? (
            <DashboardVariantC />
          ) : (
            /* Overview View - Stats and Lists */
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4">
                <StatCard
                  label="Active Weeks"
                  value={activeWeeks.length}
                  color="text-blue-600"
                />
                <StatCard
                  label="Active Projects"
                  value={projectSummary.active}
                  color="text-green-600"
                />
                <StatCard
                  label="Recent Standups"
                  value={recentStandups.length}
                  color="text-purple-600"
                />
                <StatCard
                  label="Days in Week"
                  value={weeksData?.days_remaining ? `${7 - weeksData.days_remaining}` : '-'}
                  subtitle={weeksData?.days_remaining ? `${weeksData.days_remaining} remaining` : undefined}
                  color="text-orange-600"
                />
              </div>

              {/* Main Content Grid */}
              <div className="grid grid-cols-2 gap-6">
                {/* Active Weeks */}
                <div className="rounded-lg border border-border bg-background p-4">
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    Active Weeks
                  </h2>
                  {activeWeeks.length === 0 ? (
                    <p className="text-sm text-muted">No active weeks</p>
                  ) : (
                    <div className="space-y-3">
                      {activeWeeks.map((sprint) => (
                        <WeekCard key={sprint.id} sprint={sprint} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Top Projects by ICE */}
                <div className="rounded-lg border border-border bg-background p-4">
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    Top Projects by ICE
                  </h2>
                  {topProjects.length === 0 ? (
                    <p className="text-sm text-muted">No active projects</p>
                  ) : (
                    <div className="space-y-3">
                      {topProjects.map((project) => (
                        <ProjectCard key={project.id} project={project} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Standups */}
              <div className="rounded-lg border border-border bg-background p-4">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  Recent Standups
                </h2>
                {standupsLoading ? (
                  <p className="text-sm text-muted">Loading standups...</p>
                ) : recentStandups.length === 0 ? (
                  <p className="text-sm text-muted">No recent standups</p>
                ) : (
                  <div className="space-y-3">
                    {recentStandups.map((standup) => (
                      <StandupCard key={standup.id} standup={standup} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="text-xs font-medium text-muted uppercase tracking-wide">
        {label}
      </div>
      <div className={cn('text-3xl font-bold mt-1', color)}>{value}</div>
      {subtitle && (
        <div className="text-xs text-muted mt-1">{subtitle}</div>
      )}
    </div>
  );
}

function WeekCard({ sprint }: { sprint: ActiveWeek }) {
  const progress = sprint.issue_count > 0
    ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
    : 0;

  return (
    <Link
      to={`/documents/${sprint.id}`}
      className="block rounded-md border border-border bg-background p-3 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {sprint.owner && (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white"
              title={sprint.owner.name}
            >
              {sprint.owner.name?.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="font-medium text-foreground">
            {sprint.program_name}
          </span>
        </div>
        <span className="text-xs text-muted">
          {sprint.completed_count}/{sprint.issue_count} issues
        </span>
      </div>

      <div className="h-2 rounded-full bg-border overflow-hidden">
        <div
          className={cn(
            'h-full transition-all',
            progress >= 100 ? 'bg-green-500' :
            progress >= 50 ? 'bg-yellow-500' : 'bg-blue-500'
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-muted">{progress}% complete</span>
        <span className="text-xs text-muted">{sprint.days_remaining}d remaining</span>
      </div>
    </Link>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/documents/${project.id}`}
      className="flex items-center justify-between rounded-md border border-border bg-background p-3 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium"
          style={{
            backgroundColor: project.color || '#6366f1',
            color: '#fff',
          }}
        >
          {project.emoji || project.title?.[0]?.toUpperCase() || '?'}
        </span>
        <div>
          <div className="font-medium text-foreground">
            {project.title || 'Untitled'}
          </div>
          {project.owner && (
            <div className="text-xs text-muted">
              {project.owner.name}
            </div>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold text-accent tabular-nums">
          {project.ice_score}
        </div>
        <div className="text-xs text-muted">ICE</div>
      </div>
    </Link>
  );
}

function StandupCard({ standup }: { standup: Standup }) {
  const contentPreview = extractTextFromContent(standup.content);
  const authorInitial = standup.author_name?.charAt(0).toUpperCase() || '?';
  const authorDisplay = standup.author_name || 'Unknown';

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white">
            {authorInitial}
          </span>
          <span className="font-medium text-foreground text-sm">
            {authorDisplay}
          </span>
          <span className="text-xs text-muted">
            in {standup.program_name}
          </span>
        </div>
        <span className="text-xs text-muted">
          {formatRelativeTime(standup.created_at)}
        </span>
      </div>
      <p className="text-sm text-muted line-clamp-2">
        {contentPreview || 'No content'}
      </p>
    </div>
  );
}
