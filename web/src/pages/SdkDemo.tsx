// Browser SDK demo uses Auth Code PKCE to call public documents and issues through @ship/sdk.
import { useEffect, useMemo, useState } from 'react';
import { BrowserTokenStore, ShipClient, type PublicDocument, type PublicIssue } from '@ship/sdk';
import { cn } from '@/lib/cn';

const apiUrl = envString(import.meta.env.VITE_API_URL).replace(/\/+$/, '');
const defaultClientId = envString(import.meta.env.VITE_SHIP_DEMO_CLIENT_ID);
const tokenStore = new BrowserTokenStore('ship.sdkDemo.tokens');
const demoScope = 'documents:read documents:write issues:read sprints:read';

export function SdkDemoPage() {
  const [clientId, setClientId] = useState<string>(defaultClientId);
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [issues, setIssues] = useState<PublicIssue[]>([]);
  const [title, setTitle] = useState<string>('hello');
  const [status, setStatus] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const client = useMemo(
    () => new ShipClient({ baseUrl: resolveApiBaseUrl(), clientId, tokenStore }),
    [clientId]
  );

  useEffect(() => {
    void finishCallback();
  }, []);

  async function finishCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!code && !error) {
      await loadResources();
      return;
    }

    setIsBusy(true);
    try {
      const authorizedClient = await ShipClient.authorizationCodeFlow({
        baseUrl: resolveApiBaseUrl(),
        clientId: clientId.trim(),
        redirectUri: `${window.location.origin}/sdk-demo`,
        scope: demoScope,
        tokenStore,
        currentUrl: window.location.href,
      });
      window.history.replaceState(null, '', '/sdk-demo');
      setStatus('Connected.');
      await loadResources(authorizedClient);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'OAuth exchange failed.');
    } finally {
      setIsBusy(false);
    }
  }

  async function connect() {
    if (!clientId.trim()) {
      setStatus('Client ID is required.');
      return;
    }
    setIsBusy(true);
    try {
      await ShipClient.authorizationCodeFlow({
        baseUrl: resolveApiBaseUrl(),
        clientId: clientId.trim(),
        redirectUri: `${window.location.origin}/sdk-demo`,
        scope: demoScope,
        tokenStore,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'OAuth start failed.');
      setIsBusy(false);
    }
  }

  async function loadResources(nextClient = client) {
    if (!tokenStore.get()) {
      setStatus('Connect to load public API resources.');
      return;
    }
    setIsBusy(true);
    try {
      const [documentPage, issuePage] = await Promise.all([
        nextClient.documents.list({ limit: 20 }),
        nextClient.issues.list({ limit: 20 }),
      ]);
      setDocuments(documentPage.data);
      setIssues(issuePage.data);
      setStatus(documentPage.data.length || issuePage.data.length ? 'Loaded.' : 'Loaded empty lists.');
    } catch (error) {
      setDocuments([]);
      setIssues([]);
      setStatus(error instanceof Error ? error.message : 'Load failed.');
    } finally {
      setIsBusy(false);
    }
  }

  async function createDocument() {
    setIsBusy(true);
    try {
      const document = await client.documents.create({ title: title.trim() || 'Untitled' });
      setDocuments((current) => [document, ...current]);
      setStatus('Created.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Create failed.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="sdk-client-id" className="text-sm font-medium">Client ID</label>
            <input
              id="sdk-client-id"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
              placeholder="ship_app_..."
            />
          </div>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={isBusy}
            className={primaryButtonClass}
          >
            Connect
          </button>
          <button
            type="button"
            onClick={() => void loadResources()}
            disabled={isBusy}
            className={secondaryButtonClass}
          >
            Refresh
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Document title"
          />
          <button
            type="button"
            onClick={() => void createDocument()}
            disabled={isBusy}
            className={primaryButtonClass}
          >
            Create
          </button>
        </div>

        {status && (
          <div className="rounded-md border border-border bg-muted/10 px-4 py-3 text-sm text-muted">
            {status}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="grid content-start gap-3">
            <h2 className="text-base font-semibold">Documents</h2>
            {documents.map((document) => (
              <article key={document.id} className="rounded-md border border-border p-4">
                <h3 className="text-base font-semibold">{document.title}</h3>
                <p className="mt-1 break-all font-mono text-xs text-muted">{document.id}</p>
                <p className="mt-2 text-xs text-muted">{document.document_type} · {document.updated_at}</p>
              </article>
            ))}
          </section>
          <section className="grid content-start gap-3">
            <h2 className="text-base font-semibold">Issues</h2>
            {issues.map((issue) => (
              <article key={issue.id} className="rounded-md border border-border p-4">
                <h3 className="text-base font-semibold">{issue.display_id} {issue.title}</h3>
                <p className="mt-1 break-all font-mono text-xs text-muted">{issue.id}</p>
                <p className="mt-2 text-xs text-muted">{issue.state} · {issue.priority} · {issue.updated_at}</p>
              </article>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}

const primaryButtonClass = cn(
  'rounded-md bg-accent px-4 py-2 text-sm font-medium text-white',
  'hover:bg-accent-hover disabled:opacity-50'
);

const secondaryButtonClass = cn(
  'rounded-md border border-border px-4 py-2 text-sm font-medium',
  'hover:bg-muted/50 disabled:opacity-50'
);

function envString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function resolveApiBaseUrl(): string {
  return apiUrl || window.location.origin;
}
