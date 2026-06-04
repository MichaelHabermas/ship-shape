// SDK HTTP helpers normalize URLs, fetch availability, and public API error parsing.
import type {
  OAuthDeviceAuthorizationResponse,
  OAuthErrorResponse,
  OAuthTokenResponse,
  PublicApiError,
} from '@ship/shared';
import { ShipError } from './errors.js';
import type { ShipTokenSet } from './token-store.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type OAuthErrorBody = Partial<Record<keyof OAuthErrorResponse, string>>;

export async function parseApiResponse<T>(response: Response): Promise<T> {
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

export async function parseOAuthTokenResponse(response: Response): Promise<ShipTokenSet> {
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

export async function parseDeviceCodeResponse(response: Response): Promise<OAuthDeviceAuthorizationResponse> {
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

export async function parseOAuthError(response: Response): Promise<OAuthErrorBody> {
  return parseJson<OAuthErrorBody>(response, {});
}

export function oauthShipError(status: number, body: OAuthErrorBody | null): ShipError {
  return new ShipError({
    kind: body?.error === 'slow_down' ? 'rate_limit' : 'auth',
    status,
    code: body?.error,
    message: body?.error_description ?? body?.error ?? `OAuth request failed with ${status}`,
  });
}

export function normalizeBasePath(path: string, fallback: string): string {
  const trimmed = path.trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith('/') ? trimTrailingSlash(trimmed) : `/${trimTrailingSlash(trimmed)}`;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function baseOrigin(baseUrl: string): string {
  return baseUrl ? `${baseUrl}/` : 'http://ship.local/';
}

export function absoluteOrRelativeUrl(baseUrl: string, url: URL): string {
  if (baseUrl) return url.toString();
  return `${url.pathname}${url.search}`;
}

export function globalFetch(): FetchLike {
  if (typeof globalThis.fetch !== 'function') {
    throw new ShipError({ kind: 'network', message: 'fetch is unavailable; pass a fetch implementation' });
  }
  return globalThis.fetch.bind(globalThis) as FetchLike;
}

export async function fetchOrNetworkError(
  fetchImpl: FetchLike,
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch (error) {
    if (error instanceof ShipError) throw error;
    throw new ShipError({
      kind: 'network',
      message: error instanceof Error ? error.message : 'Network request failed',
    });
  }
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(abortError());
    }, { once: true });
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

function abortError(): ShipError {
  return new ShipError({ kind: 'network', message: 'Operation aborted' });
}
