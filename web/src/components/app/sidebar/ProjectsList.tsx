import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import type { Project } from '@/contexts/ProjectsContext';
import { useCurrentDocument } from '@/contexts/CurrentDocumentContext';
import { cn } from '@/lib/cn';
import { ContextMenu, ContextMenuItem } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';
import { CalendarIcon, IssueIcon, RetroIcon, ChevronIcon, DocIcon } from './sidebar-icons.js';

export function ProjectsList({
  projects,
  activeId,
  currentProjectId,
  onUpdateProject,
}: {
  projects: Project[];
  activeId?: string;
  currentProjectId?: string | null;
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<Project | null>;
}) {
  const location = useLocation();
  const { currentDocumentType } = useCurrentDocument();
  const { showToast } = useToast();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null);

  // Determine if we're viewing a project's tab (details/weeks/issues/retro)
  const getActiveProjectTab = (): string | null => {
    const path = location.pathname;
    if (!activeId) return null;
    // Check if viewing any tab of a project that exists in the list
    const projectIds = projects.map(p => p.id);
    if (!projectIds.includes(activeId)) return null;
    if (path === `/documents/${activeId}`) return 'details';
    if (path === `/documents/${activeId}/weeks`) return 'weeks';
    if (path === `/documents/${activeId}/issues`) return 'issues';
    if (path === `/documents/${activeId}/retro`) return 'retro';
    return null;
  };

  const activeProjectTab = getActiveProjectTab();

  // Auto-expand projects that contain the current document
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    // If viewing a weekly doc with a project, auto-expand that project
    if (currentProjectId) {
      return new Set([currentProjectId]);
    }
    // If viewing a project's tab directly, auto-expand that project
    if (activeId && projects.some(p => p.id === activeId)) {
      return new Set([activeId]);
    }
    return new Set();
  });

  // Auto-expand when currentProjectId or activeId changes
  useEffect(() => {
    if (currentProjectId && !expandedProjects.has(currentProjectId)) {
      setExpandedProjects(prev => new Set([...prev, currentProjectId]));
    }
  }, [currentProjectId]);

  // Auto-expand when viewing a project's tab
  useEffect(() => {
    if (activeId && activeProjectTab && !expandedProjects.has(activeId)) {
      setExpandedProjects(prev => new Set([...prev, activeId]));
    }
  }, [activeId, activeProjectTab]);

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  // Determine current tab from URL (weeks, issues, retro, or details)
  const getCurrentTab = (projectId: string): string | null => {
    const path = location.pathname;
    if (path === `/documents/${projectId}`) return 'details';
    if (path === `/documents/${projectId}/weeks`) return 'weeks';
    if (path === `/documents/${projectId}/issues`) return 'issues';
    if (path === `/documents/${projectId}/retro`) return 'retro';
    // If viewing a weekly doc that belongs to this project, highlight "weeks"
    if (currentProjectId === projectId && (currentDocumentType === 'weekly_plan' || currentDocumentType === 'weekly_retro')) {
      return 'weeks';
    }
    return null;
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, project });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, project });
  }, []);

  const handleArchive = useCallback(async (project: Project) => {
    await onUpdateProject(project.id, { archived_at: new Date().toISOString() });
    showToast('Project archived', 'success');
    setContextMenu(null);
  }, [onUpdateProject, showToast]);

  if (projects.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No projects yet</div>;
  }

  return (
    <>
      <ul className="space-y-0.5 px-2" role="tree" data-testid="projects-list">
        {projects.map((project) => {
          const isExpanded = expandedProjects.has(project.id);
          const currentTab = getCurrentTab(project.id);
          return (
            <li key={project.id} data-testid="project-item" role="treeitem" aria-expanded={isExpanded}>
              <div className="group relative">
                <div
                  onContextMenu={(e) => handleContextMenu(e, project)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    activeId === project.id
                      ? 'bg-border/50 text-foreground'
                      : 'text-muted hover:bg-border/30 hover:text-foreground'
                  )}
                >
                  {/* Expand/collapse chevron */}
                  <button
                    type="button"
                    onClick={() => toggleProject(project.id)}
                    className="w-4 h-4 flex-shrink-0 flex items-center justify-center p-0 rounded hover:bg-border/50"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    <ChevronIcon isOpen={isExpanded} />
                  </button>
                  {/* Project color dot */}
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: project.color || '#6366f1' }}
                  />
                  {/* Project link */}
                  <Link
                    to={`/documents/${project.id}`}
                    className="flex-1 truncate"
                  >
                    {project.title || 'Untitled'}
                  </Link>
                  {/* ICE score */}
                  <span className="text-xs text-muted">{project.ice_score}</span>
                </div>
                {/* Three-dot menu button */}
                <button
                  type="button"
                  onClick={(e) => handleMenuClick(e, project)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border/50 text-muted hover:text-foreground transition-opacity"
                  aria-label={`Actions for ${project.title || 'Untitled'}`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
              </div>

              {/* Expanded content - Project tabs */}
              {isExpanded && (
                <ul className="ml-6 space-y-0.5 mt-0.5" role="group">
                  <li role="treeitem">
                    <Link
                      to={`/documents/${project.id}`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                        currentTab === 'details'
                          ? 'bg-border/50 text-foreground'
                          : 'text-muted hover:bg-border/30 hover:text-foreground'
                      )}
                    >
                      <DocIcon />
                      <span>Details</span>
                    </Link>
                  </li>
                  <li role="treeitem">
                    <Link
                      to={`/documents/${project.id}/weeks`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                        currentTab === 'weeks'
                          ? 'bg-border/50 text-foreground'
                          : 'text-muted hover:bg-border/30 hover:text-foreground'
                      )}
                    >
                      <CalendarIcon />
                      <span>Weeks</span>
                    </Link>
                  </li>
                  <li role="treeitem">
                    <Link
                      to={`/documents/${project.id}/issues`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                        currentTab === 'issues'
                          ? 'bg-border/50 text-foreground'
                          : 'text-muted hover:bg-border/30 hover:text-foreground'
                      )}
                    >
                      <IssueIcon />
                      <span>Issues</span>
                    </Link>
                  </li>
                  <li role="treeitem">
                    <Link
                      to={`/documents/${project.id}/retro`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                        currentTab === 'retro'
                          ? 'bg-border/50 text-foreground'
                          : 'text-muted hover:bg-border/30 hover:text-foreground'
                      )}
                    >
                      <RetroIcon />
                      <span>Retro</span>
                    </Link>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={() => handleArchive(contextMenu.project)}>
            <ArchiveIcon className="h-4 w-4" />
            Archive
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}