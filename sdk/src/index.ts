// Public SDK client wraps Ship OAuth tokens, /api/v1 resources, and webhook verification.
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { PUBLIC_API_RELATIVE_PATHS, type PublicMe } from '@ship/shared';
import { ShipError } from './errors.js';
import {
  absoluteOrRelativeUrl,
  baseOrigin,
  delay,
  type FetchLike,
  globalFetch,
  normalizeBasePath,
  oauthShipError,
  parseApiResponse,
  parseDeviceCodeResponse,
  parseOAuthError,
  parseOAuthTokenResponse,
  trimTrailingSlash,
} from './http.js';
import {
  DocumentsClient,
  FleetgraphClient,
  IssuesClient,
  SprintsClient,
  WebhooksClient,
} from './resources.js';
import {
  BrowserTokenStore,
  MemoryTokenStore,
  type ITokenStore,
  type ShipTokenSet,
} from './token-store.js';
export type { ShipErrorData, ShipErrorKind } from './errors.js';
export { ShipError } from './errors.js';
export type { FetchLike } from './http.js';
export {
  DocumentsClient,
  FleetGraphAttentionContextsClient,
  FleetgraphClient,
  IssuesClient,
  SprintsClient,
  WebhooksClient,
} from './resources.js';
export {
  BrowserTokenStore,
  FileTokenStore,
  MemoryTokenStore,
} from './token-store.js';
export type { ITokenStore, ShipTokenSet } from './token-store.js';
export { verifyWebhook } from './webhook.js';
export type {
  CursorPage as Page,
  PublicDocument,
  PublicDocumentCreateInput as DocumentCreateInput,
  PublicDocumentListParams as DocumentListParams,
  PublicFleetGraphAttentionContext,
  PublicFleetGraphAttentionContextListParams as FleetGraphAttentionContextListParams,
  PublicFleetGraphAttentionContextsListResponse,
  PublicIssue,
  PublicIssueCreateInput as IssueCreateInput,
  PublicIssueListParams as IssueListParams,
  PublicIssueUpdateInput as IssueUpdateInput,
  PublicMe,
  PublicSprint,
  PublicSprintIssueListParams as SprintIssueListParams,
  PublicSprintListParams as SprintListParams,
  PublicWebhookDelivery as WebhookDelivery,
  PublicWebhookListParams as WebhookListParams,
  PublicWebhookSubscription as WebhookSubscription,
  PublicWebhookSubscriptionCreated as WebhookSubscriptionCreated,
  WebhookEventType,
} from '@ship/shared';

const DEFAULT_PUBLIC_API_BASE_PATH = '/api/v1';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const AUTH_CODE_GRANT_TYPE = 'authorization_code';
const PKCE_CODE_CHALLENGE_METHOD = 'S256';

export type ShipClientOptions = {
  token?: string;
  tokenStore?: ITokenStore;
  baseUrl?: string;
  apiBasePath?: string;
  clientId?: string;
  fetch?: FetchLike;
};

export type DeviceLoginOptions = {
  baseUrl: string;
  clientId: string;
  scope?: string | string[];
  tokenStore?: ITokenStore;
  fetch?: FetchLike;
  signal?: AbortSignal;
  onUserCode: (
    code: string,
    verificationUrl: string,
    verificationUrlComplete: string
  ) => void | Promise<void>;
};

export type AuthorizationCodeFlowOptions = {
  baseUrl: string;
  clientId: string;
  redirectUri?: string;
  scope?: string | string[];
  tokenStore?: ITokenStore;
  fetch?: FetchLike;
  signal?: AbortSignal;
  currentUrl?: string;
  storage?: BrowserSessionStorage;
  onAuthorizeUrl?: (authorizationUrl: string) => void | Promise<void>;
};

type BrowserSessionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export class ShipClient {
  readonly documents: DocumentsClient;
  readonly fleetgraph: FleetgraphClient;
  readonly issues: IssuesClient;
  readonly sprints: SprintsClient;
  readonly webhooks: WebhooksClient;

  private readonly baseUrl: string;
  private readonly apiBasePath: string;
  private readonly fetchImpl: FetchLike;
  private readonly tokenStore: ITokenStore;
  private readonly clientId?: string;
  private refreshPromise: Promise<ShipTokenSet> | null = null;

  constructor(opts: ShipClientOptions) {
    this.baseUrl = trimTrailingSlash(opts.baseUrl ?? '');
    this.apiBasePath = normalizeBasePath(opts.apiBasePath ?? DEFAULT_PUBLIC_API_BASE_PATH, DEFAULT_PUBLIC_API_BASE_PATH);
    this.fetchImpl = opts.fetch ?? globalFetch();
    this.clientId = opts.clientId;
    this.tokenStore = opts.tokenStore ?? new MemoryTokenStore(
      opts.token ? { accessToken: opts.token } : null
    );
    this.documents = new DocumentsClient(this);
    this.fleetgraph = new FleetgraphClient(this);
    this.issues = new IssuesClient(this);
    this.sprints = new SprintsClient(this);
    this.webhooks = new WebhooksClient(this);
  }

  async me(): Promise<PublicMe> {
    return this.request<PublicMe>('GET', PUBLIC_API_RELATIVE_PATHS.me);
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: {
      query?: Record<string, string | number | boolean | null | undefined>;
      body?: unknown;
      retryOnUnauthorized?: boolean;
    } = {}
  ): Promise<T> {
    const retryOnUnauthorized = options.retryOnUnauthorized ?? true;
    const response = await this.fetchImpl(this.apiUrl(path, options.query), {
      method,
      headers: await this.requestHeaders(options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.status === 401 && retryOnUnauthorized && await this.canRefresh()) {
      await this.refreshTokens();
      return this.request<T>(method, path, { ...options, retryOnUnauthorized: false });
    }

    return parseApiResponse<T>(response);
  }

  private async requestHeaders(hasJsonBody: boolean): Promise<Record<string, string>> {
    const tokens = await this.tokenStore.get();
    if (!tokens?.accessToken) {
      throw new ShipError({ kind: 'auth', message: 'No Ship access token is configured' });
    }

    return {
      Accept: 'application/json',
      ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${tokens.accessToken}`,
    };
  }

  private apiUrl(path: string, query?: Record<string, string | number | boolean | null | undefined>): string {
    const url = new URL(`${this.apiBasePath}${path.startsWith('/') ? path : `/${path}`}`, baseOrigin(this.baseUrl));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
    return absoluteOrRelativeUrl(this.baseUrl, url);
  }

  private oauthUrl(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private async canRefresh(): Promise<boolean> {
    const tokens = await this.tokenStore.get();
    return Boolean(this.clientId && tokens?.refreshToken);
  }

  private async refreshTokens(): Promise<ShipTokenSet> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refreshTokensOnce().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refreshTokensOnce(): Promise<ShipTokenSet> {
    const tokens = await this.tokenStore.get();
    if (!this.clientId || !tokens?.refreshToken) {
      throw new ShipError({ kind: 'auth', message: 'No Ship refresh token is configured' });
    }

    const response = await this.fetchImpl(this.oauthUrl('/oauth/token'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        refresh_token: tokens.refreshToken,
      }),
    });
    const refreshed = await parseOAuthTokenResponse(response);
    await this.tokenStore.set(refreshed);
    return refreshed;
  }

  static async deviceLogin(opts: DeviceLoginOptions): Promise<ShipClient> {
    const fetchImpl = opts.fetch ?? globalFetch();
    const tokenStore = opts.tokenStore ?? new MemoryTokenStore();
    const baseUrl = trimTrailingSlash(opts.baseUrl);
    const scope = Array.isArray(opts.scope)
      ? opts.scope.join(' ')
      : opts.scope ?? 'documents:read documents:write webhooks:manage';

    const codeResponse = await fetchImpl(`${baseUrl}/oauth/device/code`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: opts.clientId,
        scope,
      }),
      signal: opts.signal,
    });
    const code = await parseDeviceCodeResponse(codeResponse);
    await opts.onUserCode(code.user_code, code.verification_uri, code.verification_uri_complete);

    let intervalSeconds = code.interval;
    const expiresAt = Date.now() + code.expires_in * 1000;
    while (Date.now() < expiresAt) {
      await delay(intervalSeconds * 1000, opts.signal);
      const tokenResponse = await fetchImpl(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: DEVICE_GRANT_TYPE,
          client_id: opts.clientId,
          device_code: code.device_code,
        }),
        signal: opts.signal,
      });

      if (tokenResponse.ok) {
        const tokens = await parseOAuthTokenResponse(tokenResponse);
        await tokenStore.set(tokens);
        return new ShipClient({
          baseUrl,
          clientId: opts.clientId,
          tokenStore,
          fetch: fetchImpl,
        });
      }

      const error = await parseOAuthError(tokenResponse);
      if (error.error === 'authorization_pending') continue;
      if (error.error === 'slow_down') {
        intervalSeconds += 5;
        continue;
      }
      throw oauthShipError(tokenResponse.status, error);
    }

    throw new ShipError({
      kind: 'auth',
      code: 'expired_token',
      message: 'Device authorization expired',
      status: 400,
    });
  }

  static async authorizationCodeFlow(opts: AuthorizationCodeFlowOptions): Promise<ShipClient> {
    const fetchImpl = opts.fetch ?? globalFetch();
    const tokenStore = opts.tokenStore ?? new BrowserTokenStore();
    const storage = opts.storage ?? browserSessionStorage();
    const baseUrl = trimTrailingSlash(opts.baseUrl);
    const currentUrl = new URL(opts.currentUrl ?? currentBrowserUrl());
    const redirectUri = opts.redirectUri ?? `${currentUrl.origin}${currentUrl.pathname}`;

    const error = currentUrl.searchParams.get('error');
    if (error) {
      throw new ShipError({
        kind: 'auth',
        code: error,
        message: currentUrl.searchParams.get('error_description') ?? error,
      });
    }

    const code = currentUrl.searchParams.get('code');
    if (code) {
      const expectedState = storage.getItem(pkceStorageKey(opts.clientId, 'state'));
      const actualState = currentUrl.searchParams.get('state');
      const codeVerifier = storage.getItem(pkceStorageKey(opts.clientId, 'verifier'));
      if (!expectedState || expectedState !== actualState || !codeVerifier) {
        throw new ShipError({ kind: 'auth', message: 'OAuth authorization state is invalid or expired' });
      }

      const tokenResponse = await fetchImpl(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: AUTH_CODE_GRANT_TYPE,
          client_id: opts.clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
        signal: opts.signal,
      });
      const tokens = await parseOAuthTokenResponse(tokenResponse);
      await tokenStore.set(tokens);
      storage.removeItem(pkceStorageKey(opts.clientId, 'state'));
      storage.removeItem(pkceStorageKey(opts.clientId, 'verifier'));
      return new ShipClient({
        baseUrl,
        clientId: opts.clientId,
        tokenStore,
        fetch: fetchImpl,
      });
    }

    const state = randomBase64Url(32);
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = await pkceChallenge(codeVerifier);
    storage.setItem(pkceStorageKey(opts.clientId, 'state'), state);
    storage.setItem(pkceStorageKey(opts.clientId, 'verifier'), codeVerifier);

    const scope = Array.isArray(opts.scope)
      ? opts.scope.join(' ')
      : opts.scope ?? 'documents:read documents:write webhooks:manage';
    const authorizationUrl = new URL(`${baseUrl}/oauth/authorize`);
    authorizationUrl.searchParams.set('client_id', opts.clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('scope', scope);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', PKCE_CODE_CHALLENGE_METHOD);
    authorizationUrl.searchParams.set('state', state);

    if (opts.onAuthorizeUrl) {
      await opts.onAuthorizeUrl(authorizationUrl.toString());
    } else {
      redirectBrowser(authorizationUrl.toString());
    }
    return new Promise<ShipClient>(() => {});
  }
}

function browserSessionStorage(): BrowserSessionStorage {
  const candidate = (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
  if (!candidate || typeof candidate !== 'object') {
    throw new ShipError({ kind: 'auth', message: 'sessionStorage is unavailable' });
  }
  return candidate as BrowserSessionStorage;
}

function currentBrowserUrl(): string {
  const location = (globalThis as unknown as { location?: { href?: unknown } }).location;
  if (typeof location?.href !== 'string') {
    throw new ShipError({ kind: 'auth', message: 'Current browser URL is unavailable' });
  }
  return location.href;
}

function redirectBrowser(url: string): void {
  const location = (globalThis as unknown as {
    location?: { href?: string; assign?: (target: string) => void };
  }).location;
  if (!location) {
    throw new ShipError({ kind: 'auth', message: 'Browser location is unavailable' });
  }
  if (typeof location.assign === 'function') {
    location.assign(url);
    return;
  }
  location.href = url;
}

function pkceStorageKey(clientId: string, key: 'state' | 'verifier'): string {
  return `ship.oauth.pkce.${clientId}.${key}`;
}

async function pkceChallenge(codeVerifier: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ShipError({ kind: 'auth', message: 'crypto.subtle is unavailable' });
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', utf8ToBytes(codeVerifier));
  return base64Url(new Uint8Array(digest));
}

function randomBase64Url(byteLength: number): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new ShipError({ kind: 'auth', message: 'crypto.getRandomValues is unavailable' });
  }
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
