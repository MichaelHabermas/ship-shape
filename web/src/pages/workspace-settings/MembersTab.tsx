import type { WorkspaceMemberResponse } from '@ship/shared';
import { cn } from '@/lib/cn';

export function MembersTab({
  members,
  currentUserId,
  showArchived,
  onShowArchivedChange,
  onUpdateRole,
  onArchiveMember,
  onRestoreMember,
}: {
  members: WorkspaceMemberResponse[];
  currentUserId?: string;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  onUpdateRole: (userId: string, role: 'admin' | 'member') => void;
  onArchiveMember: (userId: string) => void;
  onRestoreMember: (userId: string) => void;
}) {
  const activeMembers = members.filter(m => !m.isArchived);
  const adminCount = activeMembers.filter(m => m.role === 'admin').length;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onShowArchivedChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent/50"
          />
          <span className="text-xs text-muted">Show archived</span>
        </label>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-border/30">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted">Name</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted">Email</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted">Role</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted">Joined</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((member) => {
              const isArchived = member.isArchived;
              const isLastAdmin = member.role === 'admin' && adminCount === 1;
              const isSelf = member.userId === currentUserId;

              return (
                <tr key={member.id} className={cn(isArchived && 'opacity-50')}>
                  <td className={cn('px-4 py-3 text-sm font-medium', isArchived ? 'text-muted' : 'text-foreground')}>
                    {member.name}
                    {isArchived && <span className="ml-1 text-xs font-normal">(archived)</span>}
                    {isSelf && !isArchived && <span className="ml-2 text-muted">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">{member.email}</td>
                  <td className="px-4 py-3 text-sm">
                    {isArchived ? (
                      <span className="text-muted">-</span>
                    ) : (
                      <select
                        value={member.role || 'member'}
                        onChange={(e) => onUpdateRole(member.userId, e.target.value as 'admin' | 'member')}
                        disabled={isLastAdmin}
                        className={cn(
                          'px-2 py-1 rounded text-sm bg-background border border-border',
                          isLastAdmin && 'opacity-50 cursor-not-allowed'
                        )}
                        title={isLastAdmin ? 'Workspace must have at least one admin' : undefined}
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isArchived ? (
                      <button
                        type="button"
                        onClick={() => onRestoreMember(member.userId)}
                        className="text-sm text-accent hover:text-accent/80 transition-colors"
                      >
                        Restore
                      </button>
                    ) : (
                      !isSelf && !isLastAdmin && (
                        <button
                          type="button"
                          onClick={() => onArchiveMember(member.userId)}
                          className="text-sm text-red-500 hover:text-red-400 transition-colors"
                        >
                          Archive
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
