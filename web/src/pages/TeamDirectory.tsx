import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/ContextMenu';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { api, apiGetJson } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface Person {
  id: string;       // Document ID (for navigation)
  user_id: string;  // User ID (for backend operations)
  name: string;
  email: string;
  isArchived?: boolean;
}

export function TeamDirectoryPage() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const { showToast } = useToast();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; person: Person } | null>(null);

  const fetchPeople = useCallback(async (includeArchived = false) => {
    try {
      const query = includeArchived ? '?includeArchived=true' : '';
      const data = await apiGetJson<Person[]>(`/api/team/people${query}`, 'Failed to fetch people');
      setPeople(data);
    } catch (error) {
      console.error('Failed to fetch people:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPeople(showArchived);
  }, [fetchPeople, showArchived]);

  const handleContextMenu = useCallback((e: React.MouseEvent, person: Person) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, person });
  }, []);

  const handleViewProfile = useCallback(() => {
    if (contextMenu) {
      navigate(`/team/${contextMenu.person.id}`);
      setContextMenu(null);
    }
  }, [contextMenu, navigate]);

  const handleRemoveMember = useCallback(async () => {
    if (!contextMenu || !currentWorkspace) return;

    const confirmed = window.confirm(`Are you sure you want to remove ${contextMenu.person.name} from this workspace? This action cannot be undone.`);
    if (!confirmed) {
      setContextMenu(null);
      return;
    }

    try {
      const result = await api.workspaces.removeMember(currentWorkspace.id, contextMenu.person.user_id);
      if (result.success) {
        setPeople(prev => prev.filter(p => p.id !== contextMenu.person.id));
        showToast(`${contextMenu.person.name} removed from workspace`, 'success');
      } else {
        showToast('Failed to remove member', 'error');
      }
    } catch (_error) {
      showToast('Failed to remove member', 'error');
    }
    setContextMenu(null);
  }, [contextMenu, currentWorkspace, showToast]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-border px-6">
        <div className="flex items-center">
          <h1 className="text-lg font-medium text-foreground">Team Directory</h1>
          {!loading && <span className="ml-2 text-sm text-muted">({people.length} members)</span>}
        </div>
        <div className="flex items-center gap-3">
          {isSuperAdmin && (
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-border/50 hover:text-foreground transition-colors"
              title="Manage team settings"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Manage
            </button>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent/50"
            />
            <span className="text-xs text-muted">Show archived</span>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <span className="text-muted">Loading...</span>
          </div>
        ) : people.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-center">
            <h2 className="text-xl font-medium text-foreground">No team members</h2>
            <p className="mt-1 text-sm text-muted">Team members will appear here once added</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-background border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Email
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {people.map((person) => (
                <tr
                  key={person.id}
                  onClick={() => navigate(`/team/${person.id}`)}
                  onContextMenu={(e) => handleContextMenu(e, person)}
                  className={cn(
                    'cursor-pointer transition-colors hover:bg-border/30',
                    person.isArchived && 'opacity-50'
                  )}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white',
                        person.isArchived ? 'bg-gray-400' : 'bg-accent/80'
                      )}>
                        {person.name.charAt(0).toUpperCase()}
                      </div>
                      <span className={cn(
                        'font-medium',
                        person.isArchived ? 'text-muted' : 'text-foreground'
                      )}>
                        {person.name}
                        {person.isArchived && (
                          <span className="ml-1 text-xs font-normal text-muted">(archived)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-sm text-muted">
                    {person.email}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={handleViewProfile}>
            <UserIcon className="h-4 w-4" />
            View profile
          </ContextMenuItem>
          {isSuperAdmin && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleRemoveMember} destructive>
                <RemoveIcon className="h-4 w-4" />
                Remove from workspace
              </ContextMenuItem>
            </>
          )}
        </ContextMenu>
      )}
    </div>
  );
}

// Icons
function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

function RemoveIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
