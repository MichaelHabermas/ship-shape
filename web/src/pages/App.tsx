// App layout composes shell chrome, global modals, and FleetGraph assistant surfaces.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useFocusOnNavigate } from '@/hooks/useFocusOnNavigate';
import { useRealtimeEvent } from '@/hooks/useRealtimeEvents';
import { useDocuments } from '@/contexts/DocumentsContext';
import { useIssues } from '@/contexts/IssuesContext';
import { useProjects } from '@/contexts/ProjectsContext';
import { useActionItemsQuery, actionItemsKeys } from '@/hooks/useActionItemsQuery';
import { CommandPalette } from '@/components/CommandPalette';
import { SessionTimeoutModal } from '@/components/SessionTimeoutModal';
import { UploadNavigationWarning } from '@/components/UploadNavigationWarning';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { CacheCorruptionAlert } from '@/components/CacheCorruptionAlert';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ProjectSetupWizard, ProjectSetupData } from '@/components/ProjectSetupWizard';
import { SelectionPersistenceProvider } from '@/contexts/SelectionPersistenceContext';
import { ActionItemsModal } from '@/components/ActionItemsModal';
import { AccountabilityBanner } from '@/components/AccountabilityBanner';
import { useAppMode } from '@/hooks/useAppMode';
import { AppHeader, AppImpersonationBanner } from '@/components/app/AppHeader';
import { AppSidebar } from '@/components/app/AppSidebar';
import type { FleetGraphChatProbeRequest } from '@/components/FleetGraphChatProbe';
import type { FleetGraphNotificationProbeItem } from '@/components/FleetGraphNotificationsProbe';
import { FleetGraphAssistantLayer } from '@/components/FleetGraphAssistantLayer';
import { FleetGraphPageContextProvider } from '@/contexts/FleetGraphPageContext';

export function AppLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { createDocument } = useDocuments();
  const { createIssue } = useIssues();
  const { createProject } = useProjects();
  const { activeMode, activeDocumentId, hideLeftSidebar, handleModeClick } = useAppMode();

  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ship:leftSidebarCollapsed') === 'true';
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [projectSetupWizardOpen, setProjectSetupWizardOpen] = useState(false);
  const [actionItemsModalOpen, setActionItemsModalOpen] = useState(false);
  const [actionItemsModalShownOnLoad, setActionItemsModalShownOnLoad] = useState(false);
  const [chatDiscussRequest, setChatDiscussRequest] = useState<FleetGraphChatProbeRequest | null>(null);

  const handleSessionTimeout = useCallback(async () => {
    const returnTo = encodeURIComponent(location.pathname + location.search + location.hash);
    window.location.href = `/login?expired=true&returnTo=${returnTo}`;
  }, [location]);

  const {
    showWarning: showTimeoutWarning,
    timeRemaining,
    warningType,
    resetTimer: resetSessionTimer,
  } = useSessionTimeout(handleSessionTimeout);

  const { data: actionItemsData } = useActionItemsQuery();
  const hasActionItems = (actionItemsData?.items?.length ?? 0) > 0;
  const queryClient = useQueryClient();

  const [isCelebrating, setIsCelebrating] = useState(false);
  const celebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAccountabilityUpdate = useCallback(() => {
    setIsCelebrating(true);

    if (celebrationTimeoutRef.current) {
      clearTimeout(celebrationTimeoutRef.current);
    }

    celebrationTimeoutRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: actionItemsKeys.all });
      setIsCelebrating(false);
      celebrationTimeoutRef.current = null;
    }, 4000);
  }, [queryClient]);

  useRealtimeEvent('accountability:updated', handleAccountabilityUpdate);

  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current) {
        clearTimeout(celebrationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (localStorage.getItem('ship:disableActionItemsModal') === 'true') return;
    if (!actionItemsModalShownOnLoad && hasActionItems && actionItemsData?.items) {
      setActionItemsModalOpen(true);
      setActionItemsModalShownOnLoad(true);
    }
  }, [actionItemsModalShownOnLoad, hasActionItems, actionItemsData?.items]);

  useFocusOnNavigate();

  useEffect(() => {
    localStorage.setItem('ship:leftSidebarCollapsed', String(leftSidebarCollapsed));
  }, [leftSidebarCollapsed]);

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

  const handleDiscussNotification = (notification: FleetGraphNotificationProbeItem) => {
    setChatDiscussRequest((request) => ({
      id: (request?.id ?? 0) + 1,
      notification,
    }));
  };

  return (
    <TooltipProvider delayDuration={300}>
      <SelectionPersistenceProvider>
        <FleetGraphPageContextProvider>
        <div className="flex h-screen flex-col overflow-hidden bg-background">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-md focus:outline-none focus:ring-2 focus:ring-accent-foreground"
          >
            Skip to main content
          </a>

          <CacheCorruptionAlert />

          <AppImpersonationBanner />

          <AccountabilityBanner
            itemCount={actionItemsData?.items?.length ?? 0}
            onBannerClick={() => setActionItemsModalOpen(true)}
            isCelebrating={isCelebrating}
            urgency={actionItemsData?.has_overdue ? 'overdue' : 'due_today'}
          />

          <div className="flex flex-1 overflow-hidden">
            <AppHeader
              activeMode={activeMode}
              onModeClick={handleModeClick}
              leftSidebarCollapsed={leftSidebarCollapsed}
              hideLeftSidebar={hideLeftSidebar}
              onExpandSidebar={() => setLeftSidebarCollapsed(false)}
            />

            <AppSidebar
              collapsed={leftSidebarCollapsed}
              onCollapse={() => setLeftSidebarCollapsed(true)}
              hidden={hideLeftSidebar}
              activeMode={activeMode}
              activeDocumentId={activeDocumentId}
              onCreateDocument={handleCreateDocument}
              onCreateIssue={handleCreateIssue}
              onCreateProject={handleCreateProject}
            />

            <main id="main-content" className="flex flex-1 flex-col overflow-hidden" role="main" tabIndex={-1}>
              <ErrorBoundary resetKeys={[location.pathname, location.search]}>
                <Outlet />
              </ErrorBoundary>
            </main>

            <aside id="properties-portal" aria-label="Document properties" className="flex flex-col" />
          </div>

          <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

          <ProjectSetupWizard
            open={projectSetupWizardOpen}
            onCancel={() => setProjectSetupWizardOpen(false)}
            onSubmit={handleProjectSetupSubmit}
          />

          <SessionTimeoutModal
            open={showTimeoutWarning}
            timeRemaining={timeRemaining}
            warningType={warningType}
            onStayLoggedIn={resetSessionTimer}
          />

          <UploadNavigationWarning />

          <ActionItemsModal
            open={actionItemsModalOpen}
            onClose={() => setActionItemsModalOpen(false)}
          />

          <FleetGraphAssistantLayer
            chatDiscussRequest={chatDiscussRequest}
            onDiscussNotification={handleDiscussNotification}
          />
        </div>
        </FleetGraphPageContextProvider>
      </SelectionPersistenceProvider>
    </TooltipProvider>
  );
}
