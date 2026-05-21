/**
 * ProjectContextSidebar - Sidebar for viewing documents in project context
 *
 * Shows a tree view of project-related documents when viewing weekly plans/retros
 * that belong to a project. Helps users understand the context and navigate
 * between related documents.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/cn';

interface ProjectContextSidebarProps {
  projectId: string;
  activeDocumentId?: string;
}

interface ProjectData {
  id: string;
  title: string;
  color: string;
}

interface ProjectIssue {
  id: string;
  title: string;
  state: string;
  ticket_number?: number;
}

interface AllocationGridResponse {
  project: { id: string; title: string };
  people: Array<{
    id: string;
    name: string;
    weeks: Array<{
      week_number: number;
      plan?: { id: string; status: string };
      retro?: { id: string; status: string };
    }>;
  }>;
  weeks: number[];
}

// Icons
function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={cn('h-3.5 w-3.5 text-muted transition-transform', expanded && 'rotate-90')}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function IssueIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function RetroIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-3.5 w-3.5', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

// Status color mapping
const statusColors: Record<string, string> = {
  done: 'bg-green-500',
  due: 'bg-yellow-500',
  late: 'bg-red-500',
  future: 'bg-gray-400',
};

export function ProjectContextSidebar({ projectId, activeDocumentId }: ProjectContextSidebarProps) {
  const [projectExpanded, setProjectExpanded] = useState(true);
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  const [showIssues, setShowIssues] = useState(false);

  // Fetch project details
  const { data: project, isLoading: projectLoading } = useQuery<ProjectData>({
    queryKey: ['document', projectId],
    queryFn: async () => {
      const res = await apiGet(`/api/documents/${projectId}`);
      if (!res.ok) throw new Error('Failed to fetch project');
      return res.json();
    },
    enabled: !!projectId,
  });

  // Fetch allocation grid data (includes weekly plans/retros)
  const { data: gridData, isLoading: gridLoading } = useQuery<AllocationGridResponse>({
    queryKey: ['project-allocation-grid', projectId],
    queryFn: async () => {
      const res = await apiGet(`/api/weekly-plans/project-allocation-grid/${projectId}`);
      if (!res.ok) throw new Error('Failed to fetch allocation grid');
      return res.json();
    },
    enabled: !!projectId,
  });

  // Fetch project issues
  const { data: issues = [], isLoading: issuesLoading } = useQuery<ProjectIssue[]>({
    queryKey: ['project-issues', projectId],
    queryFn: async () => {
      const res = await apiGet(`/api/issues?project_id=${projectId}`);
      if (!res.ok) throw new Error('Failed to fetch issues');
      return res.json();
    },
    enabled: !!projectId && showIssues,
  });

  const togglePerson = (personId: string) => {
    setExpandedPeople(prev => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  };

  const isLoading = projectLoading || gridLoading;

  if (isLoading) {
    return (
      <div className="px-3 py-2 text-sm text-muted">
        Loading project context...
      </div>
    );
  }

  if (!project || !gridData) {
    return (
      <div className="px-3 py-2 text-sm text-muted">
        Project not found
      </div>
    );
  }

  const hasPeople = gridData.people && gridData.people.length > 0;

  return (
    <div className="space-y-1" data-testid="project-context-sidebar">
      {/* Project tree with expandable tabs */}
      <ul className="space-y-0.5 px-2 py-2" role="tree">
        {/* Project root node */}
        <li role="treeitem">
          <button
            onClick={() => setProjectExpanded(prev => !prev)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-foreground hover:bg-border/30 transition-colors"
          >
            <ChevronIcon expanded={projectExpanded} />
            <span
              className="h-3 w-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: project.color || '#6366f1' }}
            />
            <span className="truncate">{project.title || 'Untitled'}</span>
          </button>

          {/* Project tabs */}
          {projectExpanded && (
            <ul className="ml-4 space-y-0.5 mt-0.5" role="group">
              {/* Details tab */}
              <li role="treeitem">
                <Link
                  to={`/documents/${projectId}`}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                    'text-muted hover:bg-border/30 hover:text-foreground'
                  )}
                >
                  <DocumentIcon className="text-muted" />
                  <span>Details</span>
                </Link>
              </li>

              {/* Weeks tab */}
              <li role="treeitem">
                <Link
                  to={`/documents/${projectId}/weeks`}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                    'text-muted hover:bg-border/30 hover:text-foreground'
                  )}
                >
                  <CalendarIcon className="text-muted" />
                  <span>Weeks</span>
                </Link>
              </li>

              {/* Issues tab */}
              <li role="treeitem">
                <Link
                  to={`/documents/${projectId}/issues`}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                    'text-muted hover:bg-border/30 hover:text-foreground'
                  )}
                >
                  <IssueIcon className="text-muted" />
                  <span>Issues</span>
                </Link>
              </li>

              {/* Retro tab */}
              <li role="treeitem">
                <Link
                  to={`/documents/${projectId}/retro`}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                    'text-muted hover:bg-border/30 hover:text-foreground'
                  )}
                >
                  <RetroIcon className="text-muted" />
                  <span>Retro</span>
                </Link>
              </li>
            </ul>
          )}
        </li>
      </ul>

      {/* Separator */}
      <div className="border-t border-border mx-2" />

      {/* Weekly accountability section */}
      <div className="pt-1">
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
          <DocumentIcon className="text-muted" />
          Weekly Docs
        </div>

        {!hasPeople ? (
          <div className="px-3 py-2 text-xs text-muted">
            No team members allocated
          </div>
        ) : (
          <ul className="space-y-0.5 px-2" role="tree">
            {gridData.people.map(person => {
              const isExpanded = expandedPeople.has(person.id);
              const hasWeeks = person.weeks && person.weeks.length > 0;

              return (
                <li key={person.id} role="treeitem">
                  {/* Person row */}
                  <button
                    onClick={() => togglePerson(person.id)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors text-left',
                      'text-muted hover:bg-border/30 hover:text-foreground'
                    )}
                  >
                    {hasWeeks && <ChevronIcon expanded={isExpanded} />}
                    {!hasWeeks && <PersonIcon className="text-muted" />}
                    <span className="truncate flex-1">{person.name}</span>
                    {hasWeeks && (
                      <span className="text-xs text-muted">
                        {person.weeks.length}w
                      </span>
                    )}
                  </button>

                  {/* Weeks for this person */}
                  {isExpanded && hasWeeks && (
                    <ul className="ml-4 space-y-0.5" role="group">
                      {person.weeks.map(week => (
                        <li key={week.week_number} className="space-y-0.5">
                          <div className="px-2 py-1 text-xs font-medium text-muted">
                            Week {week.week_number}
                          </div>

                          {/* Plan link */}
                          {week.plan && (
                            <Link
                              to={`/documents/${week.plan.id}`}
                              className={cn(
                                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ml-2',
                                activeDocumentId === week.plan.id
                                  ? 'bg-border/50 text-foreground'
                                  : 'text-muted hover:bg-border/30 hover:text-foreground'
                              )}
                            >
                              <span className={cn('h-2 w-2 rounded-full', statusColors[week.plan.status] || 'bg-gray-400')} />
                              <span>Plan</span>
                            </Link>
                          )}

                          {/* Retro link */}
                          {week.retro && (
                            <Link
                              to={`/documents/${week.retro.id}`}
                              className={cn(
                                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ml-2',
                                activeDocumentId === week.retro.id
                                  ? 'bg-border/50 text-foreground'
                                  : 'text-muted hover:bg-border/30 hover:text-foreground'
                              )}
                            >
                              <span className={cn('h-2 w-2 rounded-full', statusColors[week.retro.status] || 'bg-gray-400')} />
                              <span>Retro</span>
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Separator */}
      <div className="border-t border-border mx-2 my-2" />

      {/* Issues section (expandable) */}
      <div>
        <button
          onClick={() => setShowIssues(prev => !prev)}
          className="flex w-full items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider hover:text-foreground transition-colors"
        >
          <ChevronIcon expanded={showIssues} />
          <IssueIcon className="text-muted" />
          Issues
        </button>

        {showIssues && (
          <ul className="space-y-0.5 px-2 mt-1">
            {issuesLoading ? (
              <li className="px-2 py-1 text-xs text-muted">Loading...</li>
            ) : issues.length === 0 ? (
              <li className="px-2 py-1 text-xs text-muted">No issues</li>
            ) : (
              issues.map(issue => (
                <li key={issue.id}>
                  <Link
                    to={`/documents/${issue.id}`}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                      activeDocumentId === issue.id
                        ? 'bg-border/50 text-foreground'
                        : 'text-muted hover:bg-border/30 hover:text-foreground'
                    )}
                  >
                    <IssueIcon className="flex-shrink-0 text-muted" />
                    <span className="truncate">
                      {issue.ticket_number ? `#${issue.ticket_number} ` : ''}
                      {issue.title || 'Untitled'}
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
