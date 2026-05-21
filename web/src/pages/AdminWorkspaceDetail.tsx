import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/date-utils';

interface Member {
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

interface Invite {
  id: string;
  email: string;
  x509SubjectDn: string | null;
  role: 'admin' | 'member';
  token: string;
  createdAt: string;
}

interface Workspace {
  id: string;
  name: string;
  sprintStartDate: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function AdminWorkspaceDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { isSuperAdmin } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSubjectDn, setInviteSubjectDn] = useState('');
  const [showPivField, setShowPivField] = useState(false);
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add existing user state
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; email: string; name: string }>>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [addUserRole, setAddUserRole] = useState<'admin' | 'member'>('member');
  const [addingUser, setAddingUser] = useState(false);
  const [addUserError, setAddUserError] = useState<string | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) {
      navigate('/docs');
      return;
    }
    if (id) {
      loadData();
    }
  }, [isSuperAdmin, navigate, id]);

  // Debounced user search
  useEffect(() => {
    if (!userSearch || userSearch.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      const res = await api.admin.searchUsers(userSearch, id);
      if (res.success && res.data) {
        setSearchResults(res.data.users);
        setShowSearchResults(true);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [userSearch, id]);

  async function loadData() {
    if (!id) return;
    setLoading(true);
    setError(null);

    const [wsRes, membersRes, invitesRes] = await Promise.all([
      api.admin.getWorkspace(id),
      api.admin.getWorkspaceMembers(id),
      api.admin.getWorkspaceInvites(id),
    ]);

    if (!wsRes.success) {
      setError(wsRes.error?.message || 'Workspace not found');
      setLoading(false);
      return;
    }

    if (wsRes.data) setWorkspace(wsRes.data.workspace);
    if (membersRes.success && membersRes.data) setMembers(membersRes.data.members);
    if (invitesRes.success && invitesRes.data) setInvites(invitesRes.data.invites);
    setLoading(false);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !inviteEmail.trim()) return;

    setInviting(true);
    setInviteError(null);

    const res = await api.admin.createWorkspaceInvite(id, {
      email: inviteEmail.trim(),
      x509SubjectDn: inviteSubjectDn.trim() || undefined,
      role: inviteRole,
    });

    if (res.success && res.data) {
      const { invite } = res.data;
      setInvites(prev => [invite, ...prev]);
      setInviteEmail('');
      setInviteSubjectDn('');
      setShowPivField(false);
      setInviteRole('member');
    } else {
      setInviteError(res.error?.message || 'Failed to create invite');
    }
    setInviting(false);
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!id) return;
    const res = await api.admin.revokeWorkspaceInvite(id, inviteId);
    if (res.success) {
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    }
  }

  async function handleUpdateRole(userId: string, newRole: 'admin' | 'member') {
    if (!id) return;
    const res = await api.admin.updateWorkspaceMember(id, userId, { role: newRole });
    if (res.success) {
      setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role: newRole } : m));
    } else if (res.error?.message) {
      alert(res.error.message);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!id) return;
    if (!confirm('Are you sure you want to remove this member from the workspace?')) return;

    const res = await api.admin.removeWorkspaceMember(id, userId);
    if (res.success) {
      setMembers(prev => prev.filter(m => m.userId !== userId));
    } else if (res.error?.message) {
      alert(res.error.message);
    }
  }

  async function handleAddUser() {
    if (!id || !selectedUser) return;

    setAddingUser(true);
    setAddUserError(null);

    const res = await api.admin.addWorkspaceMember(id, {
      userId: selectedUser.id,
      role: addUserRole,
    });

    if (res.success && res.data) {
      const { member } = res.data;
      setMembers(prev => [...prev, member]);
      setSelectedUser(null);
      setUserSearch('');
      setSearchResults([]);
      setAddUserRole('member');
    } else {
      setAddUserError(res.error?.message || 'Failed to add user');
    }
    setAddingUser(false);
  }

  function copyInviteLink(invite: Invite) {
    const url = `${window.location.origin}/invite/${invite.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  }


  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background gap-4">
        <div className="text-red-500">{error || 'Workspace not found'}</div>
        <button
          onClick={() => navigate('/admin')}
          className="text-accent hover:underline"
        >
          Back to Admin Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 items-center border-b border-border px-6 gap-4">
        <button
          onClick={() => navigate('/admin')}
          className="text-muted hover:text-foreground transition-colors"
        >
          <BackIcon />
        </button>
        <h1 className="text-lg font-semibold text-foreground">
          Workspace: {workspace.name}
        </h1>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6 space-y-8">
        {/* Members Section */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-3">
            Members ({members.length})
          </h2>
          {members.length === 0 ? (
            <div className="text-sm text-muted p-4 border border-border rounded-lg">
              No members in this workspace yet.
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-border/30">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted">Role</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((member) => (
                    <tr key={member.userId}>
                      <td className="px-4 py-3 text-sm text-foreground font-medium">
                        {member.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">{member.email}</td>
                      <td className="px-4 py-3 text-sm">
                        <select
                          value={member.role}
                          onChange={(e) => handleUpdateRole(member.userId, e.target.value as 'admin' | 'member')}
                          className="px-2 py-1 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRemoveMember(member.userId)}
                          className="text-sm text-red-500 hover:text-red-400 transition-colors"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Pending Invites Section */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-3">
            Pending Invites ({invites.length})
          </h2>
          {invites.length === 0 ? (
            <div className="text-sm text-muted p-4 border border-border rounded-lg">
              No pending invites.
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-border/30">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted">PIV Identity</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted">Role</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted">Sent</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invites.map((invite) => (
                    <tr key={invite.id}>
                      <td className="px-4 py-3 text-sm text-foreground">{invite.email}</td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {invite.x509SubjectDn ? (
                          <span className="font-mono text-xs">{invite.x509SubjectDn}</span>
                        ) : (
                          <span className="text-muted/50">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted capitalize">{invite.role}</td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {formatDate(invite.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right space-x-3">
                        <button
                          onClick={() => copyInviteLink(invite)}
                          className={cn(
                            "text-sm transition-colors",
                            copiedId === invite.id
                              ? "text-green-500"
                              : "text-accent hover:text-accent/80"
                          )}
                        >
                          {copiedId === invite.id ? 'Copied!' : 'Copy Link'}
                        </button>
                        <button
                          onClick={() => handleRevokeInvite(invite.id)}
                          className="text-sm text-red-500 hover:text-red-400 transition-colors"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Add Existing User Section */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-3">Add Existing User</h2>
          <div className="flex items-start gap-3 p-4 bg-border/20 rounded-lg">
            <div className="relative flex-1 max-w-sm">
              {selectedUser ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-md">
                  <span className="text-sm text-foreground">{selectedUser.name}</span>
                  <span className="text-sm text-muted">({selectedUser.email})</span>
                  <button
                    onClick={() => {
                      setSelectedUser(null);
                      setUserSearch('');
                    }}
                    className="ml-auto text-muted hover:text-foreground"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setShowSearchResults(true)}
                    onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
                    placeholder="Search by email..."
                    className={cn(
                      "w-full px-3 py-2 bg-background border rounded-md text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent",
                      addUserError ? "border-red-500" : "border-border"
                    )}
                  />
                  {showSearchResults && searchResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-md shadow-lg max-h-48 overflow-auto">
                      {searchResults.map((user) => (
                        <button
                          key={user.id}
                          onClick={() => {
                            setSelectedUser(user);
                            setUserSearch('');
                            setSearchResults([]);
                            setShowSearchResults(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-border/50 transition-colors"
                        >
                          <div className="text-foreground">{user.name}</div>
                          <div className="text-muted text-xs">{user.email}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {showSearchResults && userSearch.length >= 2 && searchResults.length === 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-md shadow-lg p-3 text-sm text-muted">
                      No users found
                    </div>
                  )}
                </>
              )}
            </div>
            <select
              value={addUserRole}
              onChange={(e) => setAddUserRole(e.target.value as 'admin' | 'member')}
              className="px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              onClick={handleAddUser}
              disabled={addingUser || !selectedUser}
              className="px-4 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {addingUser ? 'Adding...' : 'Add User'}
            </button>
          </div>
          {addUserError && (
            <p className="mt-2 text-sm text-red-500">{addUserError}</p>
          )}
        </section>

        {/* Invite Form Section */}
        <section>
          <h2 className="text-sm font-medium text-foreground mb-3">Invite New Member</h2>
          <form onSubmit={handleInvite} className="p-4 bg-border/20 rounded-lg space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                required
                className={cn(
                  "flex-1 max-w-sm px-3 py-2 bg-background border rounded-md text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent",
                  inviteError ? "border-red-500" : "border-border"
                )}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                className="px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                className="px-4 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {inviting ? 'Sending...' : 'Send Invite'}
              </button>
            </div>

            {/* PIV Subject DN field (collapsible) */}
            <div>
              <button
                type="button"
                onClick={() => setShowPivField(!showPivField)}
                className="text-xs text-muted hover:text-foreground transition-colors"
              >
                {showPivField ? '- Hide PIV options' : '+ Add PIV certificate identity'}
              </button>
              {showPivField && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={inviteSubjectDn}
                    onChange={(e) => setInviteSubjectDn(e.target.value)}
                    placeholder="X.509 Subject DN (e.g., CN=LASTNAME.FIRSTNAME.MIDDLE.1234567890)"
                    className="w-full max-w-lg px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent font-mono"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Optional: For PIV users whose certificate may not contain an email address.
                  </p>
                </div>
              )}
            </div>
          </form>
          {inviteError && (
            <p className="mt-2 text-sm text-red-500">{inviteError}</p>
          )}
        </section>
      </main>
    </div>
  );
}

function BackIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}
