import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './generated/ship-openapi';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const API_BASE = `${API_URL}/api`;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface CsrfTokenResponse {
  token: string;
}

let csrfToken: string | null = null;

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type');
  return contentType?.includes('application/json') ?? false;
}

function handleSessionExpired(): never {
  if (!navigator.onLine) {
    throw new Error('Network offline - request failed');
  }
  if (window.location.pathname.startsWith('/invite')) {
    throw new Error('Session check failed - continuing on public route');
  }
  if (window.location.pathname !== '/login') {
    const returnTo = encodeURIComponent(
      window.location.pathname + window.location.search + window.location.hash
    );
    window.location.href = `/login?expired=true&returnTo=${returnTo}`;
  }
  throw new Error('Session expired - redirecting to login');
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function ensureCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_BASE}/csrf-token`, {
      credentials: 'include',
    });
    if (!response.ok || !isJsonResponse(response)) {
      if (response.status === 401 || response.status === 403) {
        handleSessionExpired();
      }
      throw new Error('Failed to get CSRF token');
    }
    const data = await readJson<CsrfTokenResponse>(response);
    csrfToken = data.token;
  }

  if (!csrfToken) {
    throw new Error('Failed to get CSRF token');
  }
  return csrfToken;
}

export function clearTypedApiCsrfToken(): void {
  csrfToken = null;
}

function isCsrfFailure(body: unknown): boolean {
  if (!body || typeof body !== 'object' || !('error' in body)) {
    return false;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') {
    return error.toLowerCase().includes('csrf');
  }
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: unknown }).code === 'CSRF_ERROR';
  }
  return false;
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const headers = new Headers(request.headers);
    if (MUTATING_METHODS.has(request.method.toUpperCase())) {
      headers.set('X-CSRF-Token', await ensureCsrfToken());
    }
    return new Request(request, {
      credentials: 'include',
      headers,
    });
  },
  async onResponse({ request, response }) {
    const isJson = isJsonResponse(response);

    if (response.status === 401) {
      handleSessionExpired();
    }

    if (!isJson && response.status !== 204) {
      if (response.status !== 200) {
        handleSessionExpired();
      }
      throw new Error(`API returned HTML instead of JSON for ${request.url}. This may indicate a routing or CDN configuration issue.`);
    }

    return response;
  },
};

export const apiClient = createClient<paths>({
  baseUrl: API_BASE,
  credentials: 'include',
  fetch: async (request) => {
    const firstRequest = request.clone();
    const response = await fetch(request);

    if (!MUTATING_METHODS.has(firstRequest.method.toUpperCase()) || response.status !== 403 || !isJsonResponse(response)) {
      return response;
    }

    const body = await response.clone().json().catch(() => null) as unknown;
    if (!isCsrfFailure(body)) {
      return response;
    }

    clearTypedApiCsrfToken();
    const headers = new Headers(firstRequest.headers);
    headers.set('X-CSRF-Token', await ensureCsrfToken());
    return fetch(new Request(firstRequest, { headers }));
  },
});

apiClient.use(authMiddleware);

function createApiError(result: { error?: unknown; response: Response }, message: string): Error & { status: number; details?: unknown } {
  const error = new Error(message) as Error & { status: number; details?: unknown };
  error.status = result.response.status;
  error.details = result.error;
  return error;
}

export function assertApiData<T>(result: { data?: T; error?: unknown; response: Response }, message: string): T {
  if (result.data !== undefined) {
    return result.data;
  }

  throw createApiError(result, message);
}

export function assertApiSuccess(result: { error?: unknown; response: Response }, message: string): void {
  if (result.response.ok && result.error === undefined) {
    return;
  }

  throw createApiError(result, message);
}

export type ApiPaths = paths;
