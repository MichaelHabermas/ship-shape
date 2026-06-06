import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clearCsrfToken } from './api';

type FetchCall = {
  input: RequestInfo | URL;
  method: string;
  headers: Headers;
};

describe('api request CSRF retry', () => {
  const realFetch = global.fetch;
  const calls: FetchCall[] = [];
  let csrfRequestCount = 0;

  beforeEach(() => {
    calls.length = 0;
    csrfRequestCount = 0;
    clearCsrfToken();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        input,
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
      });
      const url = String(input);

      if (url.endsWith('/api/csrf-token')) {
        csrfRequestCount += 1;
        const token = csrfRequestCount === 1 ? 'stale-token' : 'fresh-token';
        return jsonResponse({ token });
      }

      if (url.endsWith('/api/platform/apps/app-1/secrets/rotate') && init?.method === 'POST') {
        const token = headerValue(init.headers, 'X-CSRF-Token');
        if (token === 'stale-token') {
          return jsonResponse({ error: 'Invalid or missing CSRF token' }, 403);
        }
        return jsonResponse({
          success: true,
          data: {
            app_id: 'app-1',
            client_secret_id: 'secret-2',
            client_secret: 'ship_secret_new',
            previous_secret_expires_at: null,
            warning: 'Save this client_secret now. It will not be shown again.',
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    clearCsrfToken();
    vi.restoreAllMocks();
  });

  it('refreshes CSRF and retries when the API returns the production CSRF body shape', async () => {
    const response = await api.platformApps.rotateSecret('app-1', {
      revoke_previous_immediately: true,
    });

    expect(response.success).toBe(true);
    expect(response.data?.client_secret).toBe('ship_secret_new');
    expect(csrfFetchCalls()).toBe(2);
    expect(rotateFetchCalls().map(call => call.headers.get('X-CSRF-Token'))).toEqual([
      'stale-token',
      'fresh-token',
    ]);
  });

  function csrfFetchCalls(): number {
    return calls.filter(call => String(call.input).endsWith('/api/csrf-token')).length;
  }

  function rotateFetchCalls(): FetchCall[] {
    return calls.filter(call => String(call.input).endsWith('/api/platform/apps/app-1/secrets/rotate'));
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  const normalized = new Headers(headers);
  return normalized.get(name);
}
