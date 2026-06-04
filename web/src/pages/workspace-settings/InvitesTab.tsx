import { useState } from 'react';
import type { WorkspaceInviteResponse } from '@ship/shared';
import { cn } from '@/lib/cn';

export function InvitesTab({
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
  invites: WorkspaceInviteResponse[];
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

  function handleCopyLink(invite: WorkspaceInviteResponse) {
    const url = `${window.location.origin}/invite/${invite.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-6">
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
                      type="button"
                      onClick={() => handleCopyLink(invite)}
                      className={cn(
                        'text-sm transition-colors',
                        copiedId === invite.id
                          ? 'text-green-500'
                          : 'text-accent hover:text-accent/80'
                      )}
                    >
                      {copiedId === invite.id ? 'Copied!' : 'Copy Link'}
                    </button>
                    <button
                      type="button"
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
