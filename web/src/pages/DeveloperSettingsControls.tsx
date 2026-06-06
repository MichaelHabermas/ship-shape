// Developer settings controls render shared forms, tables, and one-time secret surfaces.
import type { FormEvent, ReactNode } from 'react';
import type { OAuthApp } from '@/lib/platform-apps-api';
import { cn } from '@/lib/cn';

export type OneTimeSecret = {
  appName: string;
  secretId: string;
  value: string;
  previousExpiresAt: string | null;
  label?: string;
};

export function OneTimeSecretPanel({
  secret,
  copied,
  onCopy,
  onDismiss,
}: {
  secret: OneTimeSecret;
  copied: boolean;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{secret.label ?? `${secret.appName} client secret`}</div>
          <div className="mt-1 text-xs text-muted">
            ID {secret.secretId.slice(0, 8)}
            {secret.previousExpiresAt ? ` · previous expires ${formatDate(secret.previousExpiresAt)}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-muted hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground">
          {secret.value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            'rounded-md px-3 py-2 text-sm transition-colors',
            copied ? 'bg-green-500/20 text-green-400' : 'bg-border/50 text-foreground hover:bg-border'
          )}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function CreateAppForm({
  name,
  redirectUri,
  scopes,
  scopeOptions,
  busy,
  onNameChange,
  onRedirectUriChange,
  onToggleScope,
  onSubmit,
}: {
  name: string;
  redirectUri: string;
  scopes: string[];
  scopeOptions: readonly string[];
  busy: boolean;
  onNameChange: (value: string) => void;
  onRedirectUriChange: (value: string) => void;
  onToggleScope: (scope: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">Create App</h3>
      <input
        type="text"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="App name"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        required
      />
      <input
        type="url"
        value={redirectUri}
        onChange={(event) => onRedirectUriChange(event.target.value)}
        placeholder="https://example.com/oauth/callback"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        required
      />
      <div className="grid grid-cols-1 gap-1.5">
        {scopeOptions.map(scope => (
          <label key={scope} className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={() => onToggleScope(scope)}
              className="h-3.5 w-3.5 rounded border-border text-accent focus:ring-accent/50"
            />
            <span className="font-mono">{scope}</span>
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={busy || !name.trim() || !redirectUri.trim() || scopes.length === 0}
        className="rounded-md bg-accent px-3 py-2 text-sm text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Creating...' : 'Create App'}
      </button>
    </form>
  );
}

export function AppSelector({
  apps,
  selectedAppId,
  onSelectApp,
}: {
  apps: OAuthApp[];
  selectedAppId: string | null;
  onSelectApp: (appId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Apps</h3>
      {apps.length === 0 ? (
        <div className="text-sm text-muted">No apps</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {apps.map(app => (
            <button
              key={app.id}
              type="button"
              onClick={() => onSelectApp(app.id)}
              className={cn(
                'block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-border/20',
                selectedAppId === app.id && 'bg-border/30'
              )}
            >
              <div className="truncate text-sm font-medium text-foreground">{app.name}</div>
              <div className="truncate font-mono text-xs text-muted">{app.client_id}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SimpleTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="rounded-lg border border-border px-3 py-4 text-sm text-muted">{empty}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px]">
        <thead className="bg-border/30">
          <tr>
            {headers.map(header => (
              <th key={header} className="px-3 py-2 text-left text-xs font-medium text-muted">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top text-xs text-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusPill({ value }: { value: string }) {
  return (
    <span className={cn(
      'rounded px-2 py-0.5 text-xs',
      value === 'active' || value === 'succeeded'
        ? 'bg-green-500/15 text-green-400'
        : value === 'dlq' || value === 'revoked'
          ? 'bg-red-500/15 text-red-400'
          : value === 'retrying' || value === 'grace'
            ? 'bg-yellow-500/15 text-yellow-400'
            : 'bg-border/50 text-muted'
    )}>
      {value}
    </span>
  );
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
