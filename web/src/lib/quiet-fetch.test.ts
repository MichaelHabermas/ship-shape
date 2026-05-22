import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getQuietCsrfToken, quietPost, resetQuietCsrfTokenForTests } from './quiet-fetch';

describe('quiet-fetch', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    resetQuietCsrfTokenForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = realFetch;
    resetQuietCsrfTokenForTests();
  });

  it('attaches CSRF token on POST after preflight', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) {
        return new Response(JSON.stringify({ token: 'csrf-test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    global.fetch = fetchMock;

    await quietPost('/api/ai/analyze-plan', { content: {} });

    const postCall = fetchMock.mock.calls.find(([url, init]) => {
      const resolved = typeof url === 'string' ? url : url.toString();
      return resolved.includes('/api/ai/analyze-plan') && init?.method === 'POST';
    });
    expect(postCall).toBeDefined();
    expect((postCall?.[1]?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-test');
  });

  it('caches CSRF token across calls', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/csrf-token')) {
        return new Response(JSON.stringify({ token: 'cached-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    });
    global.fetch = fetchMock;

    await getQuietCsrfToken();
    await getQuietCsrfToken();

    const csrfCalls = fetchMock.mock.calls.filter(([url]) => {
      const resolved = typeof url === 'string' ? url : url.toString();
      return resolved.endsWith('/api/csrf-token');
    });
    expect(csrfCalls).toHaveLength(1);
  });
});
