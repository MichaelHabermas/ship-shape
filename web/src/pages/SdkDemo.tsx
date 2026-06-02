// Browser SDK demo uses Auth Code PKCE to call /api/v1 documents through @ship/sdk.
import { useEffect, useMemo, useState } from 'react';
import { BrowserTokenStore, ShipClient, type PublicDocument } from '@ship/sdk';
import type { OAuthTokenResponse } from '@ship/shared';
import { cn } from '@/lib/cn';

const apiUrl = envString(import.meta.env.VITE_API_URL).replace(/\/+$/, '');
const defaultClientId = envString(import.meta.env.VITE_SHIP_DEMO_CLIENT_ID);
const tokenStore = new BrowserTokenStore('ship.sdkDemo.tokens');

export function SdkDemoPage() {
  const [clientId, setClientId] = useState<string>(defaultClientId);
  const [documents, setDocuments] = useState<PublicDocument[]>([]);
  const [title, setTitle] = useState<string>('hello');
  const [status, setStatus] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const client = useMemo(() => new ShipClient({ baseUrl: apiUrl, clientId, tokenStore }), [clientId]);

  useEffect(() => {
    void finishCallback();
  }, []);

  async function finishCallback() {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) {
      await loadDocuments();
      return;
    }

    const verifier = window.sessionStorage.getItem('ship.sdkDemo.pkceVerifier');
    const expectedState = window.sessionStorage.getItem('ship.sdkDemo.state');
    if (!verifier || expectedState !== url.searchParams.get('state')) {
      setStatus('OAuth state could not be verified.');
      return;
    }

    setIsBusy(true);
    try {
      const token = await exchangeCode(code, verifier);
      tokenStore.set({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenType: token.token_type,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
        scope: token.scope,
      });
      window.history.replaceState(null, '', '/sdk-demo');
      setStatus('Connected.');
      await loadDocuments();
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
    const verifier = randomBase64Url(64);
    const challenge = await sha256Base64Url(verifier);
    const state = randomBase64Url(24);
    window.sessionStorage.setItem('ship.sdkDemo.pkceVerifier', verifier);
    window.sessionStorage.setItem('ship.sdkDemo.state', state);
    const authorizeUrl = new URL(`${apiUrl}/oauth/authorize`, window.location.origin);
    authorizeUrl.searchParams.set('client_id', clientId.trim());
    authorizeUrl.searchParams.set('redirect_uri', `${window.location.origin}/sdk-demo`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'documents:read documents:write');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    window.location.href = authorizeUrl.toString();
  }

  async function loadDocuments() {
    setIsBusy(true);
    try {
      const page = await client.documents.list({ limit: 20 });
      setDocuments(page.data);
      setStatus(page.data.length ? 'Loaded.' : 'Loaded empty list.');
    } catch (error) {
      setDocuments([]);
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

  async function exchangeCode(code: string, verifier: string): Promise<OAuthTokenResponse> {
    const response = await fetch(`${apiUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId.trim(),
        redirect_uri: `${window.location.origin}/sdk-demo`,
        code,
        code_verifier: verifier,
      }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error(oauthErrorDescription(body) ?? 'OAuth exchange failed.');
    }
    return parseOAuthTokenResponse(body);
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
            onClick={() => void loadDocuments()}
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

        <div className="grid gap-3">
          {documents.map((document) => (
            <article key={document.id} className="rounded-md border border-border p-4">
              <h2 className="text-base font-semibold">{document.title}</h2>
              <p className="mt-1 break-all font-mono text-xs text-muted">{document.id}</p>
              <p className="mt-2 text-xs text-muted">{document.document_type} · {document.updated_at}</p>
            </article>
          ))}
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

function randomBase64Url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function envString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function oauthErrorDescription(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const description = (value as Record<string, unknown>).error_description;
  return typeof description === 'string' ? description : null;
}

function parseOAuthTokenResponse(value: unknown): OAuthTokenResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OAuth token response was malformed.');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.access_token !== 'string' ||
    record.token_type !== 'Bearer' ||
    typeof record.expires_in !== 'number' ||
    typeof record.refresh_token !== 'string' ||
    typeof record.scope !== 'string'
  ) {
    throw new Error('OAuth token response was malformed.');
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    token_type: record.token_type,
    expires_in: record.expires_in,
    scope: record.scope,
  };
}
