// Public SDK client wraps Ship OAuth tokens, /api/v1 resources, and webhook verification.
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type {
  CursorPage as Page,
  OAuthDeviceAuthorizationResponse,
  OAuthErrorResponse,
  OAuthTokenResponse,
  PublicApiError,
  PublicDocument,
  PublicDocumentCreateInput as DocumentCreateInput,
  PublicDocumentListParams as DocumentListParams,
  PublicMe,
  PublicWebhookDelivery as WebhookDelivery,
  PublicWebhookListParams as WebhookListParams,
  PublicWebhookSubscription as WebhookSubscription,
  PublicWebhookSubscriptionCreated as WebhookSubscriptionCreated,
  WebhookEventType,
} from '@ship/shared';
import { ShipError } from './errors.js';
export type { ShipErrorData, ShipErrorKind } from './errors.js';
export { ShipError } from './errors.js';
export type {
  CursorPage as Page,
  PublicDocument,
  PublicDocumentCreateInput as DocumentCreateInput,
  PublicDocumentListParams as DocumentListParams,
  PublicMe,
  PublicWebhookDelivery as WebhookDelivery,
  PublicWebhookListParams as WebhookListParams,
  PublicWebhookSubscription as WebhookSubscription,
  PublicWebhookSubscriptionCreated as WebhookSubscriptionCreated,
  WebhookEventType,
} from '@ship/shared';

const DEFAULT_PUBLIC_API_BASE_PATH = '/api/v1';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
const AUTH_CODE_GRANT_TYPE = 'authorization_code';
const PKCE_CODE_CHALLENGE_METHOD = 'S256';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ShipTokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: number;
  scope?: string;
};

export interface ITokenStore {
  get(): ShipTokenSet | null | Promise<ShipTokenSet | null>;
  set(tokens: ShipTokenSet): void | Promise<void>;
  clear(): void | Promise<void>;
}

export class MemoryTokenStore implements ITokenStore {
  private tokens: ShipTokenSet | null;

  constructor(initialTokens: ShipTokenSet | null = null) {
    this.tokens = initialTokens;
  }

  get(): ShipTokenSet | null {
    return this.tokens;
  }

  set(tokens: ShipTokenSet): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}

export class BrowserTokenStore implements ITokenStore {
  constructor(private readonly key = 'ship.tokens') {}

  get(): ShipTokenSet | null {
    const storage = browserStorage();
    const raw = storage?.getItem(this.key);
    if (!raw) return null;
    return parseTokenSet(raw);
  }

  set(tokens: ShipTokenSet): void {
    const storage = browserStorage();
    if (!storage) throw new ShipError({ kind: 'auth', message: 'localStorage is unavailable' });
    storage.setItem(this.key, JSON.stringify(tokens));
  }

  clear(): void {
    browserStorage()?.removeItem(this.key);
  }
}

export class FileTokenStore implements ITokenStore {
  constructor(private readonly path: string) {}

  async get(): Promise<ShipTokenSet | null> {
    try {
      const fs = await import('node:fs/promises');
      return parseTokenSet(await fs.readFile(this.path, 'utf8'));
    } catch (error) {
      if (isNodeFileNotFound(error)) return null;
      throw error;
    }
  }

  async set(tokens: ShipTokenSet): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.path, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(this.path);
    } catch (error) {
      if (!isNodeFileNotFound(error)) throw error;
    }
  }
}

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

type OAuthErrorBody = Partial<Record<keyof OAuthErrorResponse, string>>;
type BrowserSessionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export class ShipClient {
  readonly documents: DocumentsClient;
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
    this.apiBasePath = normalizeBasePath(opts.apiBasePath ?? DEFAULT_PUBLIC_API_BASE_PATH);
    this.fetchImpl = opts.fetch ?? globalFetch();
    this.clientId = opts.clientId;
    this.tokenStore = opts.tokenStore ?? new MemoryTokenStore(
      opts.token ? { accessToken: opts.token } : null
    );
    this.documents = new DocumentsClient(this);
    this.issues = {};
    this.sprints = {};
    this.webhooks = new WebhooksClient(this);
  }

  async me(): Promise<PublicMe> {
    return this.request<PublicMe>('GET', '/me');
  }

  async request<T>(
    method: 'GET' | 'POST',
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

export class DocumentsClient {
  constructor(private readonly client: ShipClient) {}

  list(params: DocumentListParams = {}): Promise<Page<PublicDocument>> {
    return this.client.request<Page<PublicDocument>>('GET', '/documents', { query: params });
  }

  get(id: string): Promise<PublicDocument> {
    return this.client.request<PublicDocument>('GET', `/documents/${encodeURIComponent(id)}`);
  }

  create(input: DocumentCreateInput): Promise<PublicDocument> {
    return this.client.request<PublicDocument>('POST', '/documents', { body: input });
  }

  async *iterate(params: Omit<DocumentListParams, 'cursor'> = {}): AsyncIterable<PublicDocument> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...params, cursor });
      for (const document of page.data) yield document;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
}

export class WebhooksClient {
  constructor(private readonly client: ShipClient) {}

  list(params: WebhookListParams = {}): Promise<Page<WebhookSubscription>> {
    return this.client.request<Page<WebhookSubscription>>('GET', '/webhooks', { query: params });
  }

  create(input: { event: WebhookEventType; targetUrl?: string; target_url?: string }): Promise<WebhookSubscriptionCreated> {
    const targetUrl = input.target_url ?? input.targetUrl;
    if (!targetUrl) {
      throw new ShipError({ kind: 'validation', message: 'Webhook targetUrl is required' });
    }
    return this.client.request<WebhookSubscriptionCreated>('POST', '/webhooks', {
      body: {
        event: input.event,
        target_url: targetUrl,
      },
    });
  }

  replay(deliveryId: string): Promise<WebhookDelivery> {
    return this.client.request<WebhookDelivery>(
      'POST',
      `/webhooks/deliveries/${encodeURIComponent(deliveryId)}/replay`
    );
  }

  listDeliveries(params: WebhookListParams = {}): Promise<Page<WebhookDelivery>> {
    return this.client.request<Page<WebhookDelivery>>('GET', '/webhooks/deliveries', { query: params });
  }
}

// Canon SDK namespaces. Leave methodless until matching /api/v1 OpenAPI operations exist.
export type IssuesClient = Record<string, never>;
export type SprintsClient = Record<string, never>;

export function verifyWebhook(
  headers: Record<string, string | string[] | undefined> | Headers,
  rawBody: string,
  secret: string,
  toleranceSec = DEFAULT_WEBHOOK_TOLERANCE_SECONDS
): boolean {
  const header = headerValue(headers, 'ship-signature');
  if (!header) return false;

  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp) > toleranceSec) return false;

  const expected = bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`${parsed.timestamp}.${rawBody}`)));
  return constantTimeEqualHex(expected, parsed.signature);
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return parseJson<T>(response);
  }

  const body = await parseJson<Partial<PublicApiError> | null>(response, null);
  throw new ShipError({
    kind: publicApiErrorKind(body?.code, response.status),
    status: response.status,
    code: body?.code,
    message: body?.message ?? `Ship API request failed with ${response.status}`,
    requestId: body?.request_id,
    details: body?.details,
    retryAfter: retryAfterSeconds(response),
  });
}

async function parseOAuthTokenResponse(response: Response): Promise<ShipTokenSet> {
  const body = await parseJson<Partial<OAuthTokenResponse> | OAuthErrorBody | null>(response, null);
  if (!response.ok) throw oauthShipError(response.status, oauthErrorBody(body));
  if (!body || !('access_token' in body) || !body.access_token) {
    throw new ShipError({ kind: 'auth', status: response.status, message: 'OAuth token response was malformed' });
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    tokenType: body.token_type,
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined,
    scope: body.scope,
  };
}

async function parseDeviceCodeResponse(response: Response): Promise<OAuthDeviceAuthorizationResponse> {
  const body = await parseJson<Partial<OAuthDeviceAuthorizationResponse> | OAuthErrorBody | null>(response, null);
  if (!response.ok) throw oauthShipError(response.status, oauthErrorBody(body));
  if (
    !body ||
    !('device_code' in body) ||
    !body.device_code ||
    !body.user_code ||
    !body.verification_uri ||
    !body.verification_uri_complete ||
    typeof body.expires_in !== 'number' ||
    typeof body.interval !== 'number'
  ) {
    throw new ShipError({ kind: 'auth', status: response.status, message: 'Device authorization response was malformed' });
  }
  return {
    device_code: body.device_code,
    user_code: body.user_code,
    verification_uri: body.verification_uri,
    verification_uri_complete: body.verification_uri_complete,
    expires_in: body.expires_in,
    interval: body.interval,
  };
}

async function parseOAuthError(response: Response): Promise<OAuthErrorBody> {
  return parseJson<OAuthErrorBody>(response, {});
}

function oauthShipError(status: number, body: OAuthErrorBody | null): ShipError {
  return new ShipError({
    kind: body?.error === 'slow_down' ? 'rate_limit' : 'auth',
    status,
    code: body?.error,
    message: body?.error_description ?? body?.error ?? `OAuth request failed with ${status}`,
  });
}

function oauthErrorBody(body: unknown): OAuthErrorBody | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  return {
    error: typeof record.error === 'string' ? record.error : undefined,
    error_description: typeof record.error_description === 'string'
      ? record.error_description
      : undefined,
  };
}

async function parseJson<T>(response: Response, fallback?: T): Promise<T> {
  const text = await response.text();
  if (!text) {
    if (arguments.length === 2) return fallback as T;
    throw new ShipError({ kind: 'server', status: response.status, message: 'Expected JSON response body' });
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    if (arguments.length === 2) return fallback as T;
    throw new ShipError({ kind: 'server', status: response.status, message: 'Response body was not valid JSON' });
  }
}

function publicApiErrorKind(code: string | undefined, status: number) {
  if (code === 'rate_limited' || status === 429) return 'rate_limit';
  if (code === 'not_found' || status === 404) return 'not_found';
  if (code === 'validation_failed' || status === 400) return 'validation';
  if (code === 'forbidden' || code === 'unauthorized' || status === 401 || status === 403) return 'auth';
  return 'server';
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeBasePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return DEFAULT_PUBLIC_API_BASE_PATH;
  return trimmed.startsWith('/') ? trimTrailingSlash(trimmed) : `/${trimTrailingSlash(trimmed)}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function baseOrigin(baseUrl: string): string {
  return baseUrl ? `${baseUrl}/` : 'http://ship.local/';
}

function absoluteOrRelativeUrl(baseUrl: string, url: URL): string {
  if (baseUrl) return url.toString();
  return `${url.pathname}${url.search}`;
}

function globalFetch(): FetchLike {
  if (typeof globalThis.fetch !== 'function') {
    throw new ShipError({ kind: 'network', message: 'fetch is unavailable; pass a fetch implementation' });
  }
  return globalThis.fetch.bind(globalThis) as FetchLike;
}

function parseTokenSet(raw: string): ShipTokenSet | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ShipTokenSet>;
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined,
      tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : undefined,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined,
      scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
    };
  } catch {
    return null;
  }
}

function browserStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} | null {
  const candidate = (globalThis as unknown as { localStorage?: unknown }).localStorage;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as ReturnType<typeof browserStorage>;
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

function isNodeFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(abortError());
    }, { once: true });
  });
}

function abortError(): ShipError {
  return new ShipError({ kind: 'network', message: 'Operation aborted' });
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | Headers,
  name: string
): string | null {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
  const record = headers as Record<string, string | string[] | undefined>;
  const entry = Object.entries(record).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = Object.fromEntries(
    header.split(',').map(part => {
      const [key, value] = part.trim().split('=');
      return [key, value];
    })
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isInteger(timestamp) || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  return { timestamp, signature: signature.toLowerCase() };
}

function constantTimeEqualHex(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return diff === 0;
}
