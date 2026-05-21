import { useState, useEffect, useMemo, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useFocusOnNavigate } from '@/hooks/useFocusOnNavigate';
import { useRealtimeEvent } from '@/hooks/useRealtimeEvents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { ArchiveIcon } from '@/components/icons/ArchiveIcon';
import { useDocuments, WikiDocument } from '@/contexts/DocumentsContext';
import { usePrograms, Program } from '@/contexts/ProgramsContext';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { useCurrentDocument } from '@/contexts/CurrentDocumentContext';
import { useStandupStatusQuery } from '@/hooks/useStandupStatusQuery';
import { useActionItemsQuery, actionItemsKeys } from '@/hooks/useActionItemsQuery';
import { useTeamMembersQuery } from '@/hooks/useTeamMembersQuery';
import { cn, getContrastTextColor } from '@/lib/cn';
import { buildDocumentTree, DocumentTreeNode } from '@/lib/documentTree';
import { CommandPalette } from '@/components/CommandPalette';
import { SessionTimeoutModal } from '@/components/SessionTimeoutModal';
import { UploadNavigationWarning } from '@/components/UploadNavigationWarning';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { CacheCorruptionAlert } from '@/components/CacheCorruptionAlert';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { useToast } from '@/components/ui/Toast';
import { Tooltip, TooltipProvider } from '@/components/ui/Tooltip';
import { VISIBILITY_OPTIONS } from '@/lib/contextMenuActions';
import { DashboardSidebar } from '@/components/DashboardSidebar';
import { ContextTreeNav } from '@/components/ContextTreeNav';
import { ProjectSetupWizard, ProjectSetupData } from '@/components/ProjectSetupWizard';
import { SelectionPersistenceProvider } from '@/contexts/SelectionPersistenceContext';
import { ActionItemsModal } from '@/components/ActionItemsModal';
import { AccountabilityBanner } from '@/components/AccountabilityBanner';
import { ProjectContextSidebar } from '@/components/sidebars/ProjectContextSidebar';

type Mode = 'docs' | 'issues' | 'projects' | 'programs' | 'sprints' | 'team' | 'settings' | 'dashboard' | 'project-context';

export function AppLayout() {
  const { user, logout, isSuperAdmin, impersonating, endImpersonation } = useAuth();
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const { documents, createDocument } = useDocuments();
  const { programs, updateProgram } = usePrograms();
  const { issues, createIssue, updateIssue } = useIssues();
  const { projects, createProject, updateProject } = useProjects();
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ship:leftSidebarCollapsed') === 'true';
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const [projectSetupWizardOpen, setProjectSetupWizardOpen] = useState(false);
  const [actionItemsModalOpen, setActionItemsModalOpen] = useState(false);
  const [actionItemsModalShownOnLoad, setActionItemsModalShownOnLoad] = useState(false);

  // Session timeout handling
  const handleSessionTimeout = useCallback(() => {
    // Redirect to login with expired flag and returnTo URL
    const returnTo = encodeURIComponent(location.pathname + location.search + location.hash);
    window.location.href = `/login?expired=true&returnTo=${returnTo}`;
  }, [location]);

  const {
    showWarning: showTimeoutWarning,
    timeRemaining,
    warningType,
    resetTimer: resetSessionTimer,
  } = useSessionTimeout(handleSessionTimeout);

  // Check if user needs to post a standup today
  const { data: standupStatus } = useStandupStatusQuery();
  const standupDue = standupStatus?.due ?? false;

  // Check if user has pending action items (accountability tasks)
  const { data: actionItemsData } = useActionItemsQuery();
  const hasActionItems = (actionItemsData?.items?.length ?? 0) > 0;
  const queryClient = useQueryClient();

  // Celebration state for when user completes an accountability item
  const [isCelebrating, setIsCelebrating] = useState(false);
  const celebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for realtime accountability updates
  const handleAccountabilityUpdate = useCallback(() => {
    // Show celebration banner
    setIsCelebrating(true);

    // Clear any existing timeout
    if (celebrationTimeoutRef.current) {
      clearTimeout(celebrationTimeoutRef.current);
    }

    // After 4 seconds, invalidate query and hide celebration
    celebrationTimeoutRef.current = setTimeout(() => {
      // Invalidate action items to refetch
      queryClient.invalidateQueries({ queryKey: actionItemsKeys.all });
      setIsCelebrating(false);
      celebrationTimeoutRef.current = null;
    }, 4000);
  }, [queryClient]);

  useRealtimeEvent('accountability:updated', handleAccountabilityUpdate);

  // Cleanup celebration timeout on unmount
  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current) {
        clearTimeout(celebrationTimeoutRef.current);
      }
    };
  }, []);

  // Show action items modal on initial load if there are pending items
  // Disabled when localStorage flag is set (used by E2E tests to avoid blocking interactions)
  useEffect(() => {
    if (localStorage.getItem('ship:disableActionItemsModal') === 'true') return;
    if (!actionItemsModalShownOnLoad && hasActionItems && actionItemsData?.items) {
      setActionItemsModalOpen(true);
      setActionItemsModalShownOnLoad(true);
    }
  }, [actionItemsModalShownOnLoad, hasActionItems, actionItemsData?.items]);

  // Accessibility: focus management on navigation
  useFocusOnNavigate();

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('ship:leftSidebarCollapsed', String(leftSidebarCollapsed));
  }, [leftSidebarCollapsed]);

  // Global Cmd+K keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(open => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Get current document type and ID for /documents/:id routes
  const { currentDocumentType, currentDocumentId: _currentDocumentId, currentDocumentProjectId } = useCurrentDocument();

  // Determine active mode from path or document type
  const getActiveMode = (): Mode => {
    if (location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/my-week')) return 'dashboard';
    // For /documents/:id routes, use document type from context
    if (location.pathname.startsWith('/documents/')) {
      if (currentDocumentType === 'wiki') return 'docs';
      if (currentDocumentType === 'issue') return 'issues';
      if (currentDocumentType === 'project') return 'projects';
      if (currentDocumentType === 'program') return 'programs';
      if (currentDocumentType === 'sprint') return 'docs'; // Sprint documents open without special sidebar
      if (currentDocumentType === 'person') return 'team';
      // Weekly docs with a project_id stay in projects mode (sidebar shows position)
      if ((currentDocumentType === 'weekly_plan' || currentDocumentType === 'weekly_retro') && currentDocumentProjectId) {
        return 'projects';
      }
      // Default to docs while loading or for unknown types
      return 'docs';
    }
    if (location.pathname.startsWith('/docs')) return 'docs';
    if (location.pathname.startsWith('/issues')) return 'issues';
    if (location.pathname.startsWith('/projects')) return 'projects';
    // Sprints mode: /sprints/* or /programs/*/sprints/* paths
    if (location.pathname.startsWith('/sprints')) return 'sprints';
    if (location.pathname.match(/^\/programs\/[^/]+\/sprints/)) return 'sprints';
    if (location.pathname.startsWith('/programs') || location.pathname.startsWith('/feedback')) return 'programs';
    if (location.pathname.startsWith('/team')) return 'team';
    if (location.pathname.startsWith('/settings')) return 'settings';
    return 'dashboard';
  };

  const activeMode = getActiveMode();
  const isMyWeekPage = location.pathname.startsWith('/my-week');
  const isWeeklyDoc = currentDocumentType === 'weekly_plan' || currentDocumentType === 'weekly_retro';
  const isStandup = currentDocumentType === 'standup';
  const hideLeftSidebar = isMyWeekPage || isWeeklyDoc || isStandup;

  // Get the active document ID from URL - works for /documents/:id and legacy routes
  const getActiveDocumentId = (): string | undefined => {
    // For unified /documents/:id route
    if (location.pathname.startsWith('/documents/')) {
      const parts = location.pathname.split('/documents/')[1];
      return parts?.split('/')[0]; // Handle /documents/:id/:tab
    }
    // Legacy routes
    if (location.pathname.startsWith('/docs/')) return location.pathname.split('/docs/')[1];
    if (location.pathname.startsWith('/issues/')) return location.pathname.split('/issues/')[1];
    if (location.pathname.startsWith('/projects/')) return location.pathname.split('/projects/')[1];
    if (location.pathname.startsWith('/programs/')) return location.pathname.split('/programs/')[1]?.split('/')[0];
    return undefined;
  };

  const activeDocumentId = getActiveDocumentId();

  const handleModeClick = (mode: Mode) => {
    switch (mode) {
      case 'dashboard': navigate('/my-week'); break;
      case 'docs': navigate('/docs'); break;
      case 'issues': navigate('/issues'); break;
      case 'projects': navigate('/projects'); break;
      case 'programs': navigate('/programs'); break;
      case 'sprints': navigate('/sprints'); break;
      case 'team': navigate('/team'); break;
      case 'settings': navigate('/settings'); break;
    }
  };

  const handleCreateIssue = async () => {
    const issue = await createIssue();
    if (issue) {
      navigate(`/documents/${issue.id}`);
    }
  };

  const handleCreateDocument = async () => {
    const doc = await createDocument();
    if (doc) {
      navigate(`/documents/${doc.id}`);
    }
  };

  const handleCreateProject = () => {
    // Open the project setup wizard instead of immediately creating
    setProjectSetupWizardOpen(true);
  };

  const handleProjectSetupSubmit = async (data: ProjectSetupData) => {
    if (!user?.id) return;
    const project = await createProject({
      owner_id: user.id,
      title: data.title,
      program_id: data.program_id,
      plan: data.plan,
      target_date: data.target_date ? new Date(data.target_date).toISOString() : undefined,
    });
    if (project) {
      setProjectSetupWizardOpen(false);
      navigate(`/documents/${project.id}`);
    }
  };

  const handleSwitchWorkspace = async (workspaceId: string) => {
    const success = await switchWorkspace(workspaceId);
    if (success) {
      setWorkspaceSwitcherOpen(false);
      // Refresh the page to reload all data for new workspace
      window.location.href = '/docs';
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
    <SelectionPersistenceProvider>
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Skip link for keyboard/screen reader users - Section 508 compliance */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-md focus:outline-none focus:ring-2 focus:ring-accent-foreground"
      >
        Skip to main content
      </a>

      {/* Cache corruption alert */}
      <CacheCorruptionAlert />

      {/* Impersonation banner */}
      {impersonating && (
        <div className="flex h-8 items-center justify-between bg-yellow-500 px-4 text-black">
          <span className="text-sm">
            Impersonating <strong>{impersonating.userName}</strong>
          </span>
          <button
            onClick={endImpersonation}
            className="rounded bg-yellow-700 px-2 py-0.5 text-xs text-white hover:bg-yellow-800 transition-colors"
          >
            End Session
          </button>
        </div>
      )}

      {/* Accountability banner - persistent until all items complete */}
      <AccountabilityBanner
        itemCount={actionItemsData?.items?.length ?? 0}
        onBannerClick={() => setActionItemsModalOpen(true)}
        isCelebrating={isCelebrating}
        urgency={actionItemsData?.has_overdue ? 'overdue' : 'due_today'}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Icon Rail - Navigation landmark */}
        <nav className="flex w-12 flex-col items-center border-r border-border bg-background py-3" role="navigation" aria-label="Primary navigation">
          {/* Workspace switcher */}
          <div className="relative mb-4">
            <button
              onClick={() => setWorkspaceSwitcherOpen(!workspaceSwitcherOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
              title={currentWorkspace?.name || 'Select workspace'}
            >
              {currentWorkspace?.name?.charAt(0).toUpperCase() || 'W'}
            </button>
            {/* Workspace dropdown */}
            {workspaceSwitcherOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setWorkspaceSwitcherOpen(false)}
                />
                <div className="absolute left-full top-0 z-50 ml-2 w-56 rounded-lg border border-border bg-background shadow-lg">
                  <div className="p-2">
                    <div className="px-2 py-1 text-xs font-medium text-muted">Workspaces</div>
                    {workspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => handleSwitchWorkspace(ws.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                          ws.id === currentWorkspace?.id
                            ? 'bg-accent/10 text-accent'
                            : 'text-foreground hover:bg-border/30'
                        )}
                      >
                        <span className="truncate">{ws.name}</span>
                        <span className="text-xs text-muted capitalize">{ws.role}</span>
                      </button>
                    ))}
                  </div>
                  {isSuperAdmin && (
                    <div className="border-t border-border p-2">
                      <button
                        onClick={() => {
                          setWorkspaceSwitcherOpen(false);
                          navigate('/admin');
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-border/30 hover:text-foreground transition-colors"
                      >
                        <AdminIcon />
                        Admin Dashboard
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Mode icons - ordered by hierarchy: Dashboard → Docs → Programs → Projects → Issues → Teams */}
          <div className="flex flex-1 flex-col items-center gap-1">
            <RailIcon
              icon={<DashboardIcon />}
              label="Dashboard"
              active={activeMode === 'dashboard'}
              onClick={() => handleModeClick('dashboard')}
            />
            <RailIcon
              icon={<DocsIcon />}
              label="Docs"
              active={activeMode === 'docs'}
              onClick={() => handleModeClick('docs')}
            />
            <RailIcon
              icon={<ProgramsIcon />}
              label="Programs"
              active={activeMode === 'programs'}
              onClick={() => handleModeClick('programs')}
            />
            <RailIcon
              icon={<ProjectsIcon />}
              label="Projects"
              active={activeMode === 'projects'}
              onClick={() => handleModeClick('projects')}
            />
            <RailIcon
              icon={<TeamIcon />}
              label={standupDue ? "Teams (standup due)" : "Teams"}
              active={activeMode === 'team'}
              onClick={() => handleModeClick('team')}
              showBadge={standupDue}
            />
          </div>

          {/* Expand sidebar button (shows when collapsed) */}
          {leftSidebarCollapsed && !hideLeftSidebar && (
            <Tooltip content="Expand sidebar" side="right">
              <button
                onClick={() => setLeftSidebarCollapsed(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-border/50 hover:text-foreground transition-colors"
                aria-label="Expand sidebar"
              >
                <ExpandRightIcon />
              </button>
            </Tooltip>
          )}

          {/* User avatar & settings at bottom */}
          <div className="flex flex-col items-center gap-2">
            <RailIcon
              icon={<SettingsIcon />}
              label="Settings"
              active={activeMode === 'settings'}
              onClick={() => handleModeClick('settings')}
            />
            <button
              onClick={logout}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white hover:bg-accent transition-colors"
              title={`${user?.name} - Click to logout`}
            >
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </button>
          </div>
        </nav>

        {/* Contextual Sidebar - Complementary landmark */}
        <aside
          className={cn(
            'flex flex-col border-r border-border transition-all duration-200 overflow-hidden select-none',
            (leftSidebarCollapsed || hideLeftSidebar) ? 'w-0 border-r-0' : 'w-56'
          )}
          aria-label="Document list"
        >
          <div className="flex w-56 flex-col h-full">
            {/* Sidebar header */}
            <div className="flex h-10 items-center justify-between border-b border-border px-3">
              <h2 className="text-sm font-medium text-foreground m-0">
                {activeMode === 'dashboard' && 'Dashboard'}
                {activeMode === 'docs' && 'Docs'}
                {activeMode === 'issues' && 'Issues'}
                {activeMode === 'projects' && 'Projects'}
                {activeMode === 'programs' && 'Programs'}
                {activeMode === 'sprints' && 'Weeks'}
                {activeMode === 'team' && 'Teams'}
                {activeMode === 'settings' && 'Settings'}
                {activeMode === 'project-context' && 'Project'}
              </h2>
              <div className="flex items-center gap-1">
                {activeMode === 'docs' && (
                  <Tooltip content="New document">
                    <button
                      onClick={handleCreateDocument}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                      aria-label="New document"
                    >
                      <PlusIcon />
                    </button>
                  </Tooltip>
                )}
                {activeMode === 'issues' && (
                  <Tooltip content="New issue">
                    <button
                      onClick={handleCreateIssue}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                      aria-label="New issue"
                    >
                      <PlusIcon />
                    </button>
                  </Tooltip>
                )}
                {activeMode === 'projects' && (
                  <Tooltip content="New project">
                    <button
                      onClick={handleCreateProject}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                      aria-label="New project"
                    >
                      <PlusIcon />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="Collapse sidebar">
                  <button
                    onClick={() => setLeftSidebarCollapsed(true)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                    aria-label="Collapse sidebar"
                  >
                    <CollapseLeftIcon />
                  </button>
                </Tooltip>
              </div>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-auto py-2">
              {activeMode === 'docs' && (
                <DocumentsTree
                  documents={documents}
                  activeId={activeDocumentId}
                  onSelect={(id) => navigate(`/documents/${id}`)}
                />
              )}
              {activeMode === 'issues' && (
                <IssuesSidebar
                  issues={issues}
                  activeId={activeDocumentId}
                  onUpdateIssue={updateIssue}
                />
              )}
              {activeMode === 'projects' && (
                <ProjectsList
                  projects={projects}
                  activeId={activeDocumentId}
                  currentProjectId={currentDocumentProjectId}
                  onUpdateProject={updateProject}
                />
              )}
              {activeMode === 'programs' && (
                <ProgramsList
                  programs={programs}
                  activeId={activeDocumentId}
                  onSelect={(id) => navigate(`/documents/${id}`)}
                  onUpdateProgram={updateProgram}
                />
              )}
              {activeMode === 'team' && (
                <TeamSidebar />
              )}
              {activeMode === 'settings' && (
                <div className="px-3 py-2 text-sm text-muted">Settings</div>
              )}
              {activeMode === 'dashboard' && (
                <DashboardSidebar />
              )}
              {activeMode === 'project-context' && currentDocumentProjectId && (
                <ProjectContextSidebar
                  projectId={currentDocumentProjectId}
                  activeDocumentId={activeDocumentId}
                />
              )}
            </div>

          </div>
        </aside>

        {/* Main content */}
        <main id="main-content" className="flex flex-1 flex-col overflow-hidden" role="main" tabIndex={-1}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>

        {/* Properties sidebar landmark - always present for proper accessibility structure */}
        {/* Portal content from Editor will be rendered here via React Portal */}
        <aside id="properties-portal" aria-label="Document properties" className="flex flex-col" />
      </div>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      {/* Project Setup Wizard */}
      <ProjectSetupWizard
        open={projectSetupWizardOpen}
        onCancel={() => setProjectSetupWizardOpen(false)}
        onSubmit={handleProjectSetupSubmit}
      />

      {/* Session Timeout Warning Modal */}
      <SessionTimeoutModal
        open={showTimeoutWarning}
        timeRemaining={timeRemaining}
        warningType={warningType}
        onStayLoggedIn={resetSessionTimer}
      />

      {/* Upload Navigation Warning Modal */}
      <UploadNavigationWarning />

      {/* Action Items Modal - shows on login when user has pending accountability tasks */}
      <ActionItemsModal
        open={actionItemsModalOpen}
        onClose={() => setActionItemsModalOpen(false)}
      />
    </div>
    </SelectionPersistenceProvider>
    </TooltipProvider>
  );
}

function RailIcon({ icon, label, active, onClick, showBadge }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; showBadge?: boolean }) {
  return (
    <Tooltip content={label} side="right">
      <button
        onClick={onClick}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
          active ? 'bg-border text-foreground' : 'text-muted hover:bg-border/50 hover:text-foreground'
        )}
        aria-label={label}
      >
        {icon}
        {showBadge && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-orange-500" />
        )}
      </button>
    </Tooltip>
  );
}

const SIDEBAR_ITEM_LIMIT = 10;

function DocumentsTree({ documents, activeId, onSelect }: { documents: WikiDocument[]; activeId?: string; onSelect: (id: string) => void }) {
  // Split documents by visibility and build separate trees
  const { privateTree, workspaceTree } = useMemo(() => {
    // Group documents by visibility (root documents determine the section)
    const privateDocs = documents.filter(d => d.visibility === 'private');
    const workspaceDocs = documents.filter(d => d.visibility !== 'private');
    return {
      privateTree: buildDocumentTree(privateDocs),
      workspaceTree: buildDocumentTree(workspaceDocs),
    };
  }, [documents]);

  if (documents.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No documents yet</div>;
  }

  // Limit items shown
  const workspaceToShow = workspaceTree.slice(0, SIDEBAR_ITEM_LIMIT);
  const workspaceHiddenCount = workspaceTree.length - SIDEBAR_ITEM_LIMIT;

  const privateToShow = privateTree.slice(0, SIDEBAR_ITEM_LIMIT);
  const privateHiddenCount = privateTree.length - SIDEBAR_ITEM_LIMIT;

  return (
    <div className="space-y-2" data-testid="document-list">
      {/* Workspace section */}
      <div>
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
          <GlobeIcon className="h-3 w-3" />
          Workspace
        </div>
        <ul role="tree" aria-label="Workspace documents" aria-live="polite" className="space-y-0.5 px-2">
          {workspaceToShow.length > 0 ? (
            workspaceToShow.map((doc) => (
              <DocumentTreeItem
                key={doc.id}
                document={doc}
                activeId={activeId}
                onSelect={onSelect}
                depth={0}
              />
            ))
          ) : (
            <li role="none">
              <div role="treeitem" className="px-2 py-1 text-sm text-muted">No workspace documents</div>
            </li>
          )}
          {workspaceHiddenCount > 0 && (
            <li role="none">
              <Link
                to="/docs?filter=workspace"
                role="treeitem"
                className="block px-2 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/30 rounded-md transition-colors"
              >
                {workspaceHiddenCount} more...
              </Link>
            </li>
          )}
        </ul>
      </div>
      {/* Private section - only show if user has private docs */}
      {privateTree.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
            <LockIcon className="h-3 w-3" />
            Private
          </div>
          <ul role="tree" aria-label="Private documents" aria-live="polite" className="space-y-0.5 px-2">
            {privateToShow.map((doc) => (
              <DocumentTreeItem
                key={doc.id}
                document={doc}
                activeId={activeId}
                onSelect={onSelect}
                depth={0}
              />
            ))}
            {privateHiddenCount > 0 && (
              <li role="none">
                <Link
                  to="/docs?filter=private"
                  role="treeitem"
                  className="block px-2 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/30 rounded-md transition-colors"
                >
                  {privateHiddenCount} more...
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// Check if any descendant node matches the activeId
function hasActiveDescendant(node: DocumentTreeNode, activeId?: string): boolean {
  if (!activeId) return false;
  for (const child of node.children) {
    if (child.id === activeId || hasActiveDescendant(child, activeId)) {
      return true;
    }
  }
  return false;
}

function getVisibleTreeItems(tree: Element): HTMLElement[] {
  return Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter((item) => {
    return item.offsetParent !== null;
  });
}

function focusTreeItem(item: HTMLElement | null) {
  item?.focus();
  item?.scrollIntoView({ block: 'nearest' });
}

function handleDocumentTreeItemKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  options: {
    hasChildren: boolean;
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
  }
) {
  const tree = event.currentTarget.closest('[role="tree"]');
  if (!tree) return;

  const items = getVisibleTreeItems(tree);
  const currentIndex = items.indexOf(event.currentTarget);
  if (currentIndex === -1) return;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusTreeItem(items[Math.min(currentIndex + 1, items.length - 1)]);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusTreeItem(items[Math.max(currentIndex - 1, 0)]);
      break;
    case 'Home':
      event.preventDefault();
      focusTreeItem(items[0]);
      break;
    case 'End':
      event.preventDefault();
      focusTreeItem(items[items.length - 1]);
      break;
    case 'ArrowRight':
      if (!options.hasChildren) return;
      event.preventDefault();
      if (!options.isOpen) {
        options.setIsOpen(true);
      } else {
        focusTreeItem(items[Math.min(currentIndex + 1, items.length - 1)]);
      }
      break;
    case 'ArrowLeft':
      event.preventDefault();
      if (options.hasChildren && options.isOpen) {
        options.setIsOpen(false);
        return;
      }
      focusTreeItem(
        event.currentTarget
          .closest('ul[role="group"]')
          ?.closest('li[data-tree-item]')
          ?.querySelector<HTMLElement>(':scope > [role="treeitem"]') ?? null
      );
      break;
    case 'Enter':
    case ' ':
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      event.currentTarget.querySelector<HTMLAnchorElement>('a[href]')?.click();
      break;
  }
}

function DocumentTreeItem({
  document,
  activeId,
  onSelect,
  depth
}: {
  document: DocumentTreeNode;
  activeId?: string;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const { createDocument, updateDocument, deleteDocument } = useDocuments();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Auto-expand if this node or any descendant is active
  const shouldAutoExpand = hasActiveDescendant(document, activeId);
  const [isOpen, setIsOpen] = useState(shouldAutoExpand);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Update isOpen when activeId changes (for navigation)
  useEffect(() => {
    if (shouldAutoExpand && !isOpen) {
      setIsOpen(true);
    }
  }, [shouldAutoExpand, isOpen]);

  const isActive = activeId === document.id;
  const hasChildren = document.children.length > 0;

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMenuButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect();
      setContextMenu({ x: rect.right - 180, y: rect.bottom + 4 });
    }
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Action handlers
  const handleCreateSubdocument = useCallback(async () => {
    closeContextMenu();
    const newDoc = await createDocument(document.id);
    if (newDoc) {
      navigate(`/documents/${newDoc.id}`);
    }
  }, [createDocument, document.id, navigate, closeContextMenu]);

  const handleRename = useCallback(() => {
    closeContextMenu();
    // Navigate to document and focus title (the title becomes editable when you click it)
    navigate(`/documents/${document.id}`);
  }, [document.id, navigate, closeContextMenu]);

  const handleChangeVisibility = useCallback(async (visibility: string) => {
    closeContextMenu();
    await updateDocument(document.id, { visibility: visibility as 'private' | 'workspace' });
    showToast(`Visibility changed to ${visibility}`, 'success');
  }, [document.id, updateDocument, showToast, closeContextMenu]);

  const handleDelete = useCallback(async () => {
    closeContextMenu();
    const docTitle = document.title || 'Untitled';
    const childCount = document.children.length;

    // Store document data for undo
    const docData = {
      id: document.id,
      title: document.title,
      visibility: document.visibility,
      parent_id: document.parent_id,
    };

    const success = await deleteDocument(document.id);
    if (success) {
      const message = childCount > 0
        ? `Deleted "${docTitle}" and ${childCount} child document${childCount > 1 ? 's' : ''}`
        : `Deleted "${docTitle}"`;

      showToast(message, 'info', 5000, {
        label: 'Undo',
        onClick: async () => {
          // Recreate the document (undo)
          const restored = await createDocument(docData.parent_id || undefined);
          if (restored) {
            await updateDocument(restored.id, {
              title: docData.title,
              visibility: docData.visibility,
            });
            showToast('Document restored', 'success');
          }
        },
      });
    }
  }, [document, deleteDocument, createDocument, updateDocument, showToast, closeContextMenu]);

  return (
    <li
      role="none"
      data-tree-item
      data-testid="doc-item"
    >
      <div
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-selected={isActive}
        tabIndex={0}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors group',
          isActive
            ? 'bg-border/50 text-foreground'
            : 'text-muted hover:bg-border/30 hover:text-foreground',
          'focus:bg-border/30 focus:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-within:bg-border/30 focus-within:text-foreground'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onContextMenu={handleContextMenu}
        onKeyDown={(event) => handleDocumentTreeItemKeyDown(event, { hasChildren, isOpen, setIsOpen })}
      >
        {/* Expand/collapse button - always visible for accessibility */}
        {hasChildren ? (
          <button
            type="button"
            className="h-6 w-6 flex-shrink-0 flex items-center justify-center p-0 rounded hover:bg-border/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setIsOpen(!isOpen)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronIcon isOpen={isOpen} />
          </button>
        ) : (
          <div className="h-6 w-6 flex-shrink-0 flex items-center justify-center">
            <DocIcon />
          </div>
        )}
        {/* Main navigation link */}
        <Link
          to={`/documents/${document.id}`}
          className="flex-1 truncate text-left cursor-pointer flex items-center gap-1"
          aria-current={isActive ? 'page' : undefined}
        >
          <span className="truncate">{document.title || 'Untitled'}</span>
          {document.visibility === 'private' && (
            <LockIcon className="h-3 w-3 flex-shrink-0 text-muted" />
          )}
        </Link>
        {/* Three-dot menu button - visible on hover */}
        <button
          ref={menuButtonRef}
          type="button"
          onClick={handleMenuButtonClick}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-border/50 opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Document actions"
          aria-haspopup="menu"
          aria-expanded={contextMenu !== null}
        >
          <MoreHorizontalIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={closeContextMenu}>
          <ContextMenuItem onClick={handleCreateSubdocument}>
            Create sub-document
          </ContextMenuItem>
          <ContextMenuItem onClick={handleRename}>
            Rename
          </ContextMenuItem>
          <ContextMenuSubmenu label="Change visibility">
            {VISIBILITY_OPTIONS.map((opt) => (
              <ContextMenuItem
                key={opt.value}
                onClick={() => handleChangeVisibility(opt.value)}
              >
                {opt.value === 'private' && <LockIcon className="h-3.5 w-3.5 mr-2" />}
                {opt.value === 'workspace' && <GlobeIcon className="h-3.5 w-3.5 mr-2" />}
                {opt.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubmenu>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDelete} destructive>
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}

      {/* Children (collapsible) */}
      {hasChildren && isOpen && (
        <ul role="group" className="space-y-0.5">
          {document.children.map((child) => (
            <DocumentTreeItem
              key={child.id}
              document={child}
              activeId={activeId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      className={cn(
        'h-4 w-4 text-muted transition-transform',
        isOpen && 'rotate-90'
      )}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5l7 7-7 7"
      />
    </svg>
  );
}

// Wrapper that shows ContextTreeNav when viewing a specific issue
function IssuesSidebar({
  issues,
  activeId,
  onUpdateIssue,
}: {
  issues: Issue[];
  activeId?: string;
  onUpdateIssue: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
}) {
  // Show context tree when viewing a specific issue
  const showContext = !!activeId;

  return (
    <div className="space-y-2">
      {showContext && (
        <ContextTreeNav documentId={activeId} documentType="issue" />
      )}

      {/* Separator between context and list */}
      {showContext && (
        <div className="border-t border-border mx-2" />
      )}

      {/* All Issues header */}
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        All Issues
      </div>

      <IssuesList
        issues={issues}
        activeId={activeId}
        onUpdateIssue={onUpdateIssue}
      />
    </div>
  );
}

function IssuesList({
  issues,
  activeId,
  onUpdateIssue,
}: {
  issues: Issue[];
  activeId?: string;
  onUpdateIssue: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
}) {
  const { showToast } = useToast();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; issue: Issue } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, issue: Issue) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, issue });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, issue: Issue) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, issue });
  }, []);

  const handleChangeStatus = useCallback(async (issue: Issue, state: string) => {
    await onUpdateIssue(issue.id, { state });
    showToast(`Status changed to ${state.replace('_', ' ')}`, 'success');
    setContextMenu(null);
  }, [onUpdateIssue, showToast]);

  const handleArchive = useCallback(async (issue: Issue) => {
    await onUpdateIssue(issue.id, { state: 'cancelled' });
    showToast('Issue archived', 'success');
    setContextMenu(null);
  }, [onUpdateIssue, showToast]);

  if (issues.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No issues yet</div>;
  }

  const stateColors: Record<string, string> = {
    backlog: 'bg-gray-500',
    todo: 'bg-blue-500',
    in_progress: 'bg-yellow-500',
    done: 'bg-green-500',
    cancelled: 'bg-red-500',
  };

  return (
    <>
      <ul className="space-y-0.5 px-2" data-testid="issues-list">
        {issues.map((issue) => (
          <li key={issue.id} data-testid="issue-item" className="group relative">
            <Link
              to={`/documents/${issue.id}`}
              onContextMenu={(e) => handleContextMenu(e, issue)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                activeId === issue.id
                  ? 'bg-border/50 text-foreground'
                  : 'text-muted hover:bg-border/30 hover:text-foreground'
              )}
            >
              <span className={cn('h-2 w-2 rounded-full flex-shrink-0', stateColors[issue.state] || stateColors.backlog)} />
              <span className="flex-1 truncate">{issue.title || 'Untitled'}</span>
            </Link>
            {/* Three-dot menu button */}
            <button
              type="button"
              onClick={(e) => handleMenuClick(e, issue)}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-border/50 text-muted hover:text-foreground transition-opacity"
              aria-label={`Actions for ${issue.title || 'Untitled'}`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuSubmenu label="Change Status">
            <ContextMenuItem onClick={() => handleChangeStatus(contextMenu.issue, 'backlog')}>
              <IssueStatusIcon state="backlog" />
              Backlog
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleChangeStatus(contextMenu.issue, 'todo')}>
              <IssueStatusIcon state="todo" />
              Todo
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleChangeStatus(contextMenu.issue, 'in_progress')}>
              <IssueStatusIcon state="in_progress" />
              In Progress
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleChangeStatus(contextMenu.issue, 'done')}>
              <IssueStatusIcon state="done" />
              Done
            </ContextMenuItem>
          </ContextMenuSubmenu>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handleArchive(contextMenu.issue)}>
            <ArchiveIcon className="h-4 w-4" />
            Archive
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}

function IssueStatusIcon({ state }: { state: string }) {
  const colors: Record<string, string> = {
    backlog: 'text-gray-400',
    todo: 'text-blue-400',
    in_progress: 'text-yellow-400',
    done: 'text-green-400',
    cancelled: 'text-red-400',
  };
  return (
    <span className={cn('h-2 w-2 rounded-full inline-block mr-2', colors[state]?.replace('text-', 'bg-') || 'bg-gray-400')} />
  );
}

function ProjectsList({
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

function CalendarIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function IssueIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function RetroIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
    </svg>
  );
}

const PROGRAM_COLORS = [
  { value: '#EF4444', label: 'Red' },
  { value: '#F97316', label: 'Orange' },
  { value: '#EAB308', label: 'Yellow' },
  { value: '#22C55E', label: 'Green' },
  { value: '#06B6D4', label: 'Cyan' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#8B5CF6', label: 'Purple' },
  { value: '#EC4899', label: 'Pink' },
  { value: '#6B7280', label: 'Gray' },
];

function ProgramsList({
  programs,
  activeId,
  onSelect,
  onUpdateProgram,
}: {
  programs: Program[];
  activeId?: string;
  onSelect: (id: string) => void;
  onUpdateProgram: (id: string, updates: Partial<Program>) => Promise<Program | null>;
}) {
  const { showToast } = useToast();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; programId: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, programId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, programId });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, programId: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, programId });
  }, []);

  const handleRename = useCallback((program: Program) => {
    setContextMenu(null);
    setEditingId(program.id);
    setEditingName(program.name);
    // Focus input after render
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleRenameSubmit = useCallback(async (programId: string) => {
    if (editingName.trim()) {
      await onUpdateProgram(programId, { name: editingName.trim() });
      showToast('Program renamed', 'success');
    }
    setEditingId(null);
    setEditingName('');
  }, [editingName, onUpdateProgram, showToast]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, programId: string) => {
    if (e.key === 'Enter') {
      handleRenameSubmit(programId);
    } else if (e.key === 'Escape') {
      setEditingId(null);
      setEditingName('');
    }
  }, [handleRenameSubmit]);

  const handleChangeColor = useCallback(async (programId: string, color: string) => {
    setContextMenu(null);
    await onUpdateProgram(programId, { color });
    showToast('Color updated', 'success');
  }, [onUpdateProgram, showToast]);

  const handleArchive = useCallback(async (program: Program) => {
    setContextMenu(null);
    const originalArchivedAt = program.archived_at;
    await onUpdateProgram(program.id, { archived_at: new Date().toISOString() });
    showToast('Program archived', 'success', 5000, {
      label: 'Undo',
      onClick: async () => {
        await onUpdateProgram(program.id, { archived_at: originalArchivedAt });
        showToast('Archive undone', 'info');
      },
    });
  }, [onUpdateProgram, showToast]);

  if (programs.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No programs yet</div>;
  }

  const contextMenuProgram = contextMenu ? programs.find(p => p.id === contextMenu.programId) : null;

  return (
    <>
      <ul className="space-y-0.5 px-2" data-testid="programs-list">
        {programs.map((program) => (
          <li key={program.id} data-testid="program-item">
            <div
              className="group relative"
              onContextMenu={(e) => handleContextMenu(e, program.id)}
            >
              {editingId === program.id ? (
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span
                    className="h-4 w-4 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                    style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
                  >
                    {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => handleRenameSubmit(program.id)}
                    onKeyDown={(e) => handleRenameKeyDown(e, program.id)}
                    className="flex-1 bg-transparent border-none outline-none text-sm text-foreground"
                  />
                </div>
              ) : (
                <button
                  onClick={() => onSelect(program.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    activeId === program.id
                      ? 'bg-border/50 text-foreground'
                      : 'text-muted hover:bg-border/30 hover:text-foreground'
                  )}
                >
                  <span
                    className="h-4 w-4 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                    style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
                  >
                    {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
                  </span>
                  <span className="flex-1 truncate">{program.name}</span>
                </button>
              )}
              {/* Three-dot menu button */}
              {editingId !== program.id && (
                <button
                  type="button"
                  onClick={(e) => handleMenuClick(e, program.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-border/50 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`Actions for ${program.name}`}
                >
                  <MoreHorizontalIcon />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Context Menu */}
      {contextMenu && contextMenuProgram && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={() => handleRename(contextMenuProgram)}>
            <EditIcon className="h-4 w-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuSubmenu label="Change Color">
            {PROGRAM_COLORS.map((color) => (
              <ContextMenuItem
                key={color.value}
                onClick={() => handleChangeColor(contextMenuProgram.id, color.value)}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: color.value }}
                />
                {color.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubmenu>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handleArchive(contextMenuProgram)}>
            <ArchiveIcon className="h-4 w-4" />
            Archive
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function TeamSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentDocumentType } = useCurrentDocument();
  const { id: personIdFromUrl } = useParams<{ id: string }>();

  // Check if we're viewing a person profile (at /team/:personId)
  const isViewingPerson = location.pathname.startsWith('/team/') &&
    location.pathname !== '/team/allocation' &&
    location.pathname !== '/team/directory' &&
    location.pathname !== '/team/status' &&
    location.pathname !== '/team/reviews' &&
    location.pathname !== '/team/org-chart';

  const isAllocation = location.pathname === '/team/allocation' || location.pathname === '/team';
  // Directory is active when on /team/directory OR viewing a person document
  const isDirectory = location.pathname === '/team/directory' ||
    isViewingPerson ||
    (location.pathname.startsWith('/documents/') && currentDocumentType === 'person');
  const isStatusOverview = location.pathname === '/team/status';
  const isReviews = location.pathname === '/team/reviews';
  const isOrgChart = location.pathname === '/team/org-chart';

  // Fetch people for the sidebar list when viewing a person
  const { data: people = [] } = useTeamMembersQuery();

  // Filter out pending users for the sidebar list
  const activePeople = people.filter(p => !p.isPending);

  return (
    <div className="space-y-3 px-2">
      {/* Navigation buttons */}
      <ul className="space-y-0.5">
        <li>
          <button
            onClick={() => navigate('/team/allocation')}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              isAllocation
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <GridIcon />
            <span>Allocation</span>
          </button>
        </li>
        <li>
          <button
            onClick={() => navigate('/team/directory')}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              isDirectory
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <PeopleIcon />
            <span>Directory</span>
          </button>
        </li>
        <li>
          <button
            onClick={() => navigate('/team/status')}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              isStatusOverview
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <ActivityIcon />
            <span>Status Overview</span>
          </button>
        </li>
        <li>
          <button
            onClick={() => navigate('/team/reviews')}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              isReviews
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <ReviewsIcon />
            <span>Reviews</span>
          </button>
        </li>
        <li>
          <button
            onClick={() => navigate('/team/org-chart')}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              isOrgChart
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <OrgChartIcon />
            <span>Org Chart</span>
          </button>
        </li>
      </ul>

      {/* People list when viewing a person */}
      {isViewingPerson && activePeople.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
            Team Members
          </div>
          <ul className="space-y-0.5">
            {activePeople.map(person => (
              <li key={person.id}>
                <button
                  onClick={() => navigate(`/team/${person.id}`)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    personIdFromUrl === person.id
                      ? 'bg-border/50 text-foreground'
                      : 'text-muted hover:bg-border/30 hover:text-foreground'
                  )}
                >
                  <div className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white',
                    personIdFromUrl === person.id ? 'bg-accent' : 'bg-accent/60'
                  )}>
                    {person.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate">{person.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GridIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function ReviewsIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function OrgChartIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v4m0 0a2 2 0 100 4 2 2 0 000-4zm-6 8a2 2 0 100 4 2 2 0 000-4zm0 0V12m12 4a2 2 0 100 4 2 2 0 000-4zm0 0V12m-6 0h6m-12 0h6" />
    </svg>
  );
}

// Icons
function DashboardIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
    </svg>
  );
}

function DocsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  );
}

function ProgramsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function CollapseLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14V5" />
    </svg>
  );
}

function ExpandRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M4 5v14" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "h-4 w-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "h-4 w-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  );
}
