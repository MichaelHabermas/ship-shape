import { useState } from 'react';
import { api, type ApiToken, type ApiTokenCreateResponse } from '@/lib/api';
import { cn } from '@/lib/cn';

export function ApiTokensTab({
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
                'px-3 py-2 rounded-md text-sm transition-colors',
                copied
                  ? 'bg-green-500/20 text-green-500'
                  : 'bg-border/50 text-foreground hover:bg-border'
              )}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={handleDismissToken}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            I&apos;ve saved the token, dismiss this
          </button>
        </div>
      )}

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
