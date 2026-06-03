import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCurrentDocument } from '@/contexts/CurrentDocumentContext';
import { useTeamMembersQuery } from '@/hooks/useTeamMembersQuery';
import { cn } from '@/lib/cn';
import { GridIcon, PeopleIcon, ActivityIcon, ReviewsIcon, OrgChartIcon } from './sidebar-icons.js';

export function TeamSidebar() {
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