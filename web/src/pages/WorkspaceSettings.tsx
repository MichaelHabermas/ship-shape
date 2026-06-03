// Workspace settings page routes admin tabs for members, invites, tokens, developer ops, and audit.
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';
import { api, WorkspaceMember, WorkspaceInvite, AuditLog, ApiToken, ApiTokenCreateResponse } from '@/lib/api';
import { archivedPersonsKey } from '@/contexts/ArchivedPersonsContext';
import { DeveloperSettingsTab } from '@/pages/DeveloperSettingsTab';
import { cn } from '@/lib/cn';

type Tab = 'members' | 'invites' | 'tokens' | 'developer' | 'audit';

const VALID_TABS: Tab[] = ['members', 'invites', 'tokens', 'developer', 'audit'];

export function WorkspaceSettingsPage() {
  const { currentWorkspace, isWorkspaceAdmin } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive active tab from URL query params
  const tabParam = searchParams.get('tab') as Tab | null;
  const activeTab: Tab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'members';

  const handleTabChange = useCallback((tab: Tab) => {
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSubjectDn, setInviteSubjectDn] = useState('');
  const [showPivField, setShowPivField] = useState(false);
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!currentWorkspace) return;
    loadData(showArchived);
  }, [currentWorkspace, showArchived]);

  async function loadData(includeArchived = false) {
    if (!currentWorkspace) return;
    setLoading(true);

    const [membersRes, invitesRes, tokensRes, logsRes] = await Promise.all([
      api.workspaces.getMembers(currentWorkspace.id, { includeArchived }),
      api.workspaces.getInvites(currentWorkspace.id),
      api.apiTokens.list(),
      api.workspaces.getAuditLogs(currentWorkspace.id, { limit: 50 }),
    ]);

    if (membersRes.success && membersRes.data) setMembers(membersRes.data.members);
    if (invitesRes.success && invitesRes.data) setInvites(invitesRes.data.invites);
    if (tokensRes.success && tokensRes.data) setApiTokens(tokensRes.data);
    if (logsRes.success && logsRes.data) setAuditLogs(logsRes.data.logs);
    setLoading(false);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!currentWorkspace || !inviteEmail.trim()) return;

    setInviting(true);
    const res = await api.workspaces.createInvite(currentWorkspace.id, {
      email: inviteEmail.trim(),
      x509SubjectDn: inviteSubjectDn.trim() || undefined,
      role: inviteRole,
    });
    if (res.success && res.data) {
      const { invite } = res.data;
      setInvites(prev => [...prev, invite]);
      setInviteEmail('');
      setInviteSubjectDn('');
      setShowPivField(false);
    }
    setInviting(false);
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!currentWorkspace) return;
    const res = await api.workspaces.revokeInvite(currentWorkspace.id, inviteId);
    if (res.success) {
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    }
  }

  async function handleUpdateRole(userId: string, newRole: 'admin' | 'member') {
    if (!currentWorkspace) return;

    // Check if this is the last admin
    const admins = members.filter(m => m.role === 'admin');
    if (admins.length === 1 && admins[0].userId === userId && newRole === 'member') {
      alert('Cannot demote the last admin. Promote another member first.');
      return;
    }

    const res = await api.workspaces.updateMember(currentWorkspace.id, userId, { role: newRole });
    if (res.success) {
      setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role: newRole } : m));
    }
  }

  async function handleArchiveMember(userId: string) {
    if (!currentWorkspace) return;

    // Check if this is the last admin
    const admins = members.filter(m => m.role === 'admin');
    const member = members.find(m => m.userId === userId);
    if (member?.role === 'admin' && admins.length === 1) {
      alert('Cannot archive the last admin. Promote another member first.');
      return;
    }

    if (!confirm(`Archive ${member?.name || 'this member'}? They will lose access immediately.`)) return;

    const res = await api.workspaces.removeMember(currentWorkspace.id, userId);
    if (res.success) {
      setMembers(prev => prev.filter(m => m.userId !== userId));
      // Invalidate archived persons cache so mentions update
      queryClient.invalidateQueries({ queryKey: archivedPersonsKey });
    }
  }

  async function handleRestoreMember(userId: string) {
    if (!currentWorkspace) return;

    const res = await api.workspaces.restoreMember(currentWorkspace.id, userId);
    if (res.success) {
      // Refresh the members list to get updated data
      loadData(showArchived);
      // Invalidate archived persons cache so mentions update
      queryClient.invalidateQueries({ queryKey: archivedPersonsKey });
    }
  }

  if (!currentWorkspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">No workspace selected</div>
      </div>
    );
  }

  if (!isWorkspaceAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h1 className="text-xl font-medium text-foreground">Workspace Settings</h1>
        <p className="text-muted">You don't have permission to manage this workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <h1 className="text-lg font-semibold text-foreground">
          Workspace Settings: {currentWorkspace.name}
        </h1>
      </header>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex px-6">
          <TabButton active={activeTab === 'members'} onClick={() => handleTabChange('members')}>
            Members
          </TabButton>
          <TabButton active={activeTab === 'invites'} onClick={() => handleTabChange('invites')}>
            Pending Invites
          </TabButton>
          <TabButton active={activeTab === 'tokens'} onClick={() => handleTabChange('tokens')}>
            API Tokens
          </TabButton>
          <TabButton active={activeTab === 'developer'} onClick={() => handleTabChange('developer')}>
            Developer
          </TabButton>
          <TabButton active={activeTab === 'audit'} onClick={() => handleTabChange('audit')}>
            Audit Logs
          </TabButton>
          <Link
            to="/settings/conversions"
            className={cn(
              'px-4 py-3 text-sm font-medium border-b-2 border-transparent',
              'text-muted hover:text-foreground hover:border-border/50 transition-colors'
            )}
          >
            Conversions
          </Link>
        </nav>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6 pb-20">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-muted">Loading...</div>
          </div>
        ) : (
          <>
            {activeTab === 'members' && (
              <MembersTab
                members={members}
                currentUserId={user?.id}
                showArchived={showArchived}
                onShowArchivedChange={setShowArchived}
                onUpdateRole={handleUpdateRole}
                onArchiveMember={handleArchiveMember}
                onRestoreMember={handleRestoreMember}
              />
            )}
            {activeTab === 'invites' && (
              <InvitesTab
                invites={invites}
                inviteEmail={inviteEmail}
                setInviteEmail={setInviteEmail}
                inviteSubjectDn={inviteSubjectDn}
                setInviteSubjectDn={setInviteSubjectDn}
                showPivField={showPivField}
                setShowPivField={setShowPivField}
                inviteRole={inviteRole}
                setInviteRole={setInviteRole}
                inviting={inviting}
                onInvite={handleInvite}
                onRevoke={handleRevokeInvite}
              />
            )}
            {activeTab === 'tokens' && (
              <ApiTokensTab
                tokens={apiTokens}
                onTokenCreated={(token) => setApiTokens(prev => [token, ...prev])}
                onTokenRevoked={(tokenId) => setApiTokens(prev => prev.filter(t => t.id !== tokenId))}
              />
            )}
            {activeTab === 'developer' && (
              <DeveloperSettingsTab />
            )}
            {activeTab === 'audit' && (
              <AuditTab auditLogs={auditLogs} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
        active
          ? 'border-accent text-foreground'
          : 'border-transparent text-muted hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function MembersTab({
  members,
  currentUserId,
  showArchived,
  onShowArchivedChange,
  onUpdateRole,
  onArchiveMember,
  onRestoreMember,
}: {
  members: WorkspaceMember[];
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
      {/* Show archived toggle */}
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
                <tr key={member.id} className={cn(isArchived && "opacity-50")}>
                  <td className={cn("px-4 py-3 text-sm font-medium", isArchived ? "text-muted" : "text-foreground")}>
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
                        onClick={() => onRestoreMember(member.userId)}
                        className="text-sm text-accent hover:text-accent/80 transition-colors"
                      >
                        Restore
                      </button>
                    ) : (
                      !isSelf && !isLastAdmin && (
                        <button
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

function InvitesTab({
  invites,
  inviteEmail,
  setInviteEmail,
  inviteSubjectDn,
  setInviteSubjectDn,
  showPivField,
  setShowPivField,
  inviteRole,
  setInviteRole,
  inviting,
  onInvite,
  onRevoke,
}: {
  invites: WorkspaceInvite[];
  inviteEmail: string;
  setInviteEmail: (v: string) => void;
  inviteSubjectDn: string;
  setInviteSubjectDn: (v: string) => void;
  showPivField: boolean;
  setShowPivField: (v: boolean) => void;
  inviteRole: 'admin' | 'member';
  setInviteRole: (v: 'admin' | 'member') => void;
  inviting: boolean;
  onInvite: (e: React.FormEvent) => void;
  onRevoke: (id: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleCopyLink(invite: WorkspaceInvite) {
    const url = `${window.location.origin}/invite/${invite.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <form onSubmit={onInvite} className="space-y-3">
        <div className="flex gap-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Email address"
            className="flex-1 max-w-md px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            required
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
            className="px-3 py-2 bg-background border border-border rounded-md text-foreground"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
            className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {inviting ? 'Inviting...' : 'Send Invite'}
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
                className="w-full max-w-lg px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted">
                Optional: For PIV users whose certificate may not contain an email address.
                The certificate Subject DN will be matched during PIV login.
              </p>
            </div>
          )}
        </div>
      </form>

      {/* Pending invites */}
      {invites.length === 0 ? (
        <div className="text-muted text-sm">No pending invites</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-border/30">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Email</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">PIV Identity</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Role</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Expires</th>
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
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      onClick={() => handleCopyLink(invite)}
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
                      onClick={() => onRevoke(invite.id)}
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
    </div>
  );
}

function ApiTokensTab({
  tokens,
  onTokenCreated,
  onTokenRevoked,
}: {
  tokens: ApiToken[];
  onTokenCreated: (token: ApiToken) => void;
  onTokenRevoked: (tokenId: string) => void;
}) {
  const [tokenName, setTokenName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<string>('90');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<ApiTokenCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenName.trim()) return;

    setCreating(true);
    const res = await api.apiTokens.create({
      name: tokenName.trim(),
      expires_in_days: expiresInDays ? parseInt(expiresInDays, 10) : undefined,
    });
    if (res.success && res.data) {
      setNewToken(res.data);
      onTokenCreated(res.data);
      setTokenName('');
    }
    setCreating(false);
  }

  async function handleRevoke(tokenId: string) {
    if (!confirm('Are you sure you want to revoke this token? This cannot be undone.')) return;

    const res = await api.apiTokens.revoke(tokenId);
    if (res.success) {
      onTokenRevoked(tokenId);
    }
  }

  function handleCopy() {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDismissToken() {
    setNewToken(null);
    setCopied(false);
  }

  return (
    <div className="space-y-6">
      {/* Create token form */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground mb-1">Generate API Token</h3>
          <p className="text-xs text-muted">
            API tokens allow external tools like Claude Code to access Ship on your behalf.
          </p>
        </div>

        <form onSubmit={handleCreate} className="flex gap-3 items-end">
          <div className="flex-1 max-w-xs">
            <label className="block text-xs text-muted mb-1">Token Name</label>
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="e.g., Claude Code"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              required
            />
          </div>
          <div className="w-32">
            <label className="block text-xs text-muted mb-1">Expires</label>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground"
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="">Never</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={creating || !tokenName.trim()}
            className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? 'Creating...' : 'Generate Token'}
          </button>
        </form>
      </div>

      {/* New token display (shown only once after creation) */}
      {newToken && (
        <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-yellow-500 text-lg">!</span>
            <div>
              <p className="text-sm font-medium text-foreground">Copy your new API token</p>
              <p className="text-xs text-muted mt-1">
                This is the only time this token will be shown. Save it somewhere secure.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <code className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm font-mono text-foreground overflow-x-auto">
              {newToken.token}
            </code>
            <button
              onClick={handleCopy}
              className={cn(
                "px-3 py-2 rounded-md text-sm transition-colors",
                copied
                  ? "bg-green-500/20 text-green-500"
                  : "bg-border/50 text-foreground hover:bg-border"
              )}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={handleDismissToken}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            I've saved the token, dismiss this
          </button>
        </div>
      )}

      {/* Token list */}
      {tokens.length === 0 ? (
        <div className="text-muted text-sm">No API tokens yet</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-border/30">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Prefix</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Last Used</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Expires</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tokens.map((token) => (
                <tr key={token.id} className={token.is_active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 text-sm text-foreground font-medium">{token.name}</td>
                  <td className="px-4 py-3 text-sm text-muted font-mono">{token.token_prefix}...</td>
                  <td className="px-4 py-3 text-sm">
                    {token.is_active ? (
                      <span className="text-green-500">Active</span>
                    ) : token.revoked_at ? (
                      <span className="text-red-500">Revoked</span>
                    ) : (
                      <span className="text-yellow-500">Expired</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {token.last_used_at
                      ? new Date(token.last_used_at).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {token.expires_at
                      ? new Date(token.expires_at).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {token.is_active && (
                      <button
                        onClick={() => handleRevoke(token.id)}
                        className="text-sm text-red-500 hover:text-red-400 transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AuditTab({ auditLogs }: { auditLogs: AuditLog[] }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-border/30">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Time</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Actor</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Action</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Resource</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {auditLogs.map((log) => (
            <tr key={log.id}>
              <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">
                {new Date(log.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-sm text-foreground">
                {log.actorName || log.actorEmail}
              </td>
              <td className="px-4 py-3 text-sm text-muted">{log.action}</td>
              <td className="px-4 py-3 text-sm text-muted">
                {log.resourceType ? `${log.resourceType}:${log.resourceId?.slice(0, 8)}...` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
