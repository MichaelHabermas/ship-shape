import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useStandupStatusQuery } from '@/hooks/useStandupStatusQuery';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import type { Mode } from '@/hooks/useAppMode';

type AppHeaderProps = {
  activeMode: Mode;
  onModeClick: (mode: Mode) => void;
  leftSidebarCollapsed: boolean;
  hideLeftSidebar: boolean;
  onExpandSidebar: () => void;
};

function RailIcon({
  icon,
  label,
  active,
  onClick,
  showBadge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  showBadge?: boolean;
}) {
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

export function AppImpersonationBanner() {
  const { impersonating, endImpersonation } = useAuth();

  if (!impersonating) return null;

  return (
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
  );
}

export function AppHeader({
  activeMode,
  onModeClick,
  leftSidebarCollapsed,
  hideLeftSidebar,
  onExpandSidebar,
}: AppHeaderProps) {
  const { user, logout, isSuperAdmin } = useAuth();
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);
  const { data: standupStatus } = useStandupStatusQuery();
  const standupDue = standupStatus?.due ?? false;

  const handleSwitchWorkspace = async (workspaceId: string) => {
    const success = await switchWorkspace(workspaceId);
    if (success) {
      setWorkspaceSwitcherOpen(false);
      window.location.href = '/docs';
    }
  };

  return (
      <nav
        className="flex w-12 flex-col items-center border-r border-border bg-background py-3"
        role="navigation"
        aria-label="Primary navigation"
      >
        <div className="relative mb-4">
          <button
            onClick={() => setWorkspaceSwitcherOpen(!workspaceSwitcherOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
            title={currentWorkspace?.name || 'Select workspace'}
          >
            {currentWorkspace?.name?.charAt(0).toUpperCase() || 'W'}
          </button>
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

        <div className="flex flex-1 flex-col items-center gap-1">
          <RailIcon
            icon={<DashboardIcon />}
            label="Dashboard"
            active={activeMode === 'dashboard'}
            onClick={() => onModeClick('dashboard')}
          />
          <RailIcon
            icon={<DocsIcon />}
            label="Docs"
            active={activeMode === 'docs'}
            onClick={() => onModeClick('docs')}
          />
          <RailIcon
            icon={<ProgramsIcon />}
            label="Programs"
            active={activeMode === 'programs'}
            onClick={() => onModeClick('programs')}
          />
          <RailIcon
            icon={<ProjectsIcon />}
            label="Projects"
            active={activeMode === 'projects'}
            onClick={() => onModeClick('projects')}
          />
          <RailIcon
            icon={<TeamIcon />}
            label={standupDue ? 'Teams (standup due)' : 'Teams'}
            active={activeMode === 'team'}
            onClick={() => onModeClick('team')}
            showBadge={standupDue}
          />
        </div>

        {leftSidebarCollapsed && !hideLeftSidebar && (
          <Tooltip content="Expand sidebar" side="right">
            <button
              onClick={onExpandSidebar}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-border/50 hover:text-foreground transition-colors"
              aria-label="Expand sidebar"
            >
              <ExpandRightIcon />
            </button>
          </Tooltip>
        )}

        <div className="flex flex-col items-center gap-2">
          <RailIcon
            icon={<SettingsIcon />}
            label="Settings"
            active={activeMode === 'settings'}
            onClick={() => onModeClick('settings')}
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
  );
}

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
