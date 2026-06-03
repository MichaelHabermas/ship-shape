// Workspace settings page routes admin tabs for members, invites, tokens, developer ops, and audit.
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';
import { api, WorkspaceMember, WorkspaceInvite, AuditLog, ApiToken } from '@/lib/api';
import { archivedPersonsKey } from '@/contexts/ArchivedPersonsContext';
import { DeveloperSettingsTab } from '@/pages/DeveloperSettingsTab';
import { cn } from '@/lib/cn';
import { TabButton } from '@/pages/workspace-settings/TabButton';
import { MembersTab } from '@/pages/workspace-settings/MembersTab';
import { InvitesTab } from '@/pages/workspace-settings/InvitesTab';
import { ApiTokensTab } from '@/pages/workspace-settings/ApiTokensTab';
import { AuditTab } from '@/pages/workspace-settings/AuditTab';

type Tab = 'members' | 'invites' | 'tokens' | 'developer' | 'audit';

const VALID_TABS: Tab[] = ['members', 'invites', 'tokens', 'developer', 'audit'];

export function WorkspaceSettingsPage() {
  const { currentWorkspace, isWorkspaceAdmin } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

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
      queryClient.invalidateQueries({ queryKey: archivedPersonsKey });
    }
  }

  async function handleRestoreMember(userId: string) {
    if (!currentWorkspace) return;

    const res = await api.workspaces.restoreMember(currentWorkspace.id, userId);
    if (res.success) {
      loadData(showArchived);
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
        <p className="text-muted">You don&apos;t have permission to manage this workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <h1 className="text-lg font-semibold text-foreground">
          Workspace Settings: {currentWorkspace.name}
        </h1>
      </header>

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
