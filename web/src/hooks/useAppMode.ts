import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCurrentDocument } from '@/contexts/CurrentDocumentContext';

export type Mode =
  | 'docs'
  | 'issues'
  | 'projects'
  | 'programs'
  | 'sprints'
  | 'team'
  | 'settings'
  | 'dashboard';

function getActiveMode(
  pathname: string,
  currentDocumentType: string | null | undefined,
  currentDocumentProjectId: string | null | undefined
): Mode {
  if (pathname.startsWith('/my-week')) return 'dashboard';
  if (pathname.startsWith('/documents/')) {
    if (currentDocumentType === 'wiki') return 'docs';
    if (currentDocumentType === 'issue') return 'issues';
    if (currentDocumentType === 'project') return 'projects';
    if (currentDocumentType === 'program') return 'programs';
    if (currentDocumentType === 'sprint') return 'docs';
    if (currentDocumentType === 'person') return 'team';
    if (
      (currentDocumentType === 'weekly_plan' || currentDocumentType === 'weekly_retro') &&
      currentDocumentProjectId
    ) {
      return 'projects';
    }
    return 'docs';
  }
  if (pathname.startsWith('/docs')) return 'docs';
  if (pathname.startsWith('/issues')) return 'issues';
  if (pathname.startsWith('/projects')) return 'projects';
  if (pathname.startsWith('/sprints')) return 'sprints';
  if (pathname.match(/^\/programs\/[^/]+\/sprints/)) return 'sprints';
  if (pathname.startsWith('/programs') || pathname.startsWith('/feedback')) return 'programs';
  if (pathname.startsWith('/team')) return 'team';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'dashboard';
}

function getActiveDocumentId(pathname: string): string | undefined {
  if (pathname.startsWith('/documents/')) {
    const parts = pathname.split('/documents/')[1];
    return parts?.split('/')[0];
  }
  if (pathname.startsWith('/docs/')) return pathname.split('/docs/')[1];
  if (pathname.startsWith('/issues/')) return pathname.split('/issues/')[1];
  if (pathname.startsWith('/projects/')) return pathname.split('/projects/')[1];
  if (pathname.startsWith('/programs/')) return pathname.split('/programs/')[1]?.split('/')[0];
  return undefined;
}

export function useAppMode() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentDocumentType, currentDocumentProjectId } = useCurrentDocument();

  const activeMode = useMemo(
    () => getActiveMode(location.pathname, currentDocumentType, currentDocumentProjectId),
    [location.pathname, currentDocumentType, currentDocumentProjectId]
  );

  const activeDocumentId = useMemo(
    () => getActiveDocumentId(location.pathname),
    [location.pathname]
  );

  const hideLeftSidebar = useMemo(() => {
    const isMyWeekPage = location.pathname.startsWith('/my-week');
    const isWeeklyDoc =
      currentDocumentType === 'weekly_plan' || currentDocumentType === 'weekly_retro';
    const isStandup = currentDocumentType === 'standup';
    return isMyWeekPage || isWeeklyDoc || isStandup;
  }, [location.pathname, currentDocumentType]);

  const handleModeClick = useCallback(
    (mode: Mode) => {
      switch (mode) {
        case 'dashboard':
          navigate('/my-week');
          break;
        case 'docs':
          navigate('/docs');
          break;
        case 'issues':
          navigate('/issues');
          break;
        case 'projects':
          navigate('/projects');
          break;
        case 'programs':
          navigate('/programs');
          break;
        case 'sprints':
          navigate('/sprints');
          break;
        case 'team':
          navigate('/team');
          break;
        case 'settings':
          navigate('/settings');
          break;
      }
    },
    [navigate]
  );

  return {
    activeMode,
    activeDocumentId,
    hideLeftSidebar,
    handleModeClick,
  };
}
