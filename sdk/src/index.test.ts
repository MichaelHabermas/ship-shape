// SDK public work tests assert route helpers, iterators, and refresh coalescing stay callable.
import { describe, expect, it } from 'vitest';
import { MemoryTokenStore, ShipClient, type FetchLike } from './index.js';

type FetchCall = {
  input: string | URL;
  init?: RequestInit;
};

describe('ShipClient public work SDK', () => {
  it('exposes SDK methods named by public route metadata', () => {
    const client = new ShipClient({ token: 'token', fetch: asyncJsonFetch() });

    expect(client.documents).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
      iterate: expect.any(Function),
    });
    expect(client.issues).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      create: expect.any(Function),
      update: expect.any(Function),
      upsertExternalLink: expect.any(Function),
      iterate: expect.any(Function),
    });
    expect(client.sprints).toMatchObject({
      list: expect.any(Function),
      get: expect.any(Function),
      listIssues: expect.any(Function),
      iterate: expect.any(Function),
    });
    expect(client.webhooks).toMatchObject({
      list: expect.any(Function),
      create: expect.any(Function),
      listDeliveries: expect.any(Function),
      replay: expect.any(Function),
    });
  });

  it('calls issue endpoints with the expected methods and paths', async () => {
    const calls: FetchCall[] = [];
    const client = new ShipClient({
      baseUrl: 'https://ship.test',
      token: 'token',
      fetch: asyncJsonFetch(calls),
    });

    await client.issues.list({ limit: 5, state: 'todo,in_progress' });
    await client.issues.get('issue-1');
    await client.issues.create({ title: 'Public issue' });
    await client.issues.update('issue-1', { state: 'done', confirm_orphan_children: true });
    await client.issues.upsertExternalLink('issue-1', {
      provider: 'gitlab',
      external_id: 'merge_request:42',
      kind: 'merge_request',
      url: 'https://gitlab.example.test/group/project/-/merge_requests/42',
      title: 'Ship integration',
      status: 'opened',
    });

    expect(callSummary(calls)).toEqual([
      ['GET', 'https://ship.test/api/v1/issues?limit=5&state=todo%2Cin_progress'],
      ['GET', 'https://ship.test/api/v1/issues/issue-1'],
      ['POST', 'https://ship.test/api/v1/issues'],
      ['PATCH', 'https://ship.test/api/v1/issues/issue-1'],
      ['POST', 'https://ship.test/api/v1/issues/issue-1/external-links'],
    ]);
    expect(jsonBody(calls[2])).toEqual({ title: 'Public issue' });
    expect(jsonBody(calls[3])).toEqual({ state: 'done', confirm_orphan_children: true });
    expect(jsonBody(calls[4])).toEqual({
      provider: 'gitlab',
      external_id: 'merge_request:42',
      kind: 'merge_request',
      url: 'https://gitlab.example.test/group/project/-/merge_requests/42',
      title: 'Ship integration',
      status: 'opened',
    });
  });

  it('calls sprint endpoints with nested issue reads', async () => {
    const calls: FetchCall[] = [];
    const client = new ShipClient({
      baseUrl: 'https://ship.test',
      token: 'token',
      fetch: asyncJsonFetch(calls),
    });

    await client.sprints.list({ limit: 2 });
    await client.sprints.get('sprint-1');
    await client.sprints.listIssues('sprint-1', { limit: 10, assignee_id: 'unassigned' });

    expect(callSummary(calls)).toEqual([
      ['GET', 'https://ship.test/api/v1/sprints?limit=2'],
      ['GET', 'https://ship.test/api/v1/sprints/sprint-1'],
      ['GET', 'https://ship.test/api/v1/sprints/sprint-1/issues?limit=10&assignee_id=unassigned'],
    ]);
  });

  it('iterates documents, issues, and sprints through cursor pages', async () => {
    const calls: FetchCall[] = [];
    const fetch = pagedJsonFetch(calls, [
      { data: [{ id: 'doc-1' }], next_cursor: 'doc-cursor' },
      { data: [{ id: 'doc-2' }], next_cursor: null },
      { data: [{ id: 'issue-1' }], next_cursor: 'issue-cursor' },
      { data: [{ id: 'issue-2' }], next_cursor: null },
      { data: [{ id: 'sprint-1' }], next_cursor: 'sprint-cursor' },
      { data: [{ id: 'sprint-2' }], next_cursor: null },
    ]);
    const client = new ShipClient({ baseUrl: 'https://ship.test', token: 'token', fetch });

    await expect(collectIds(client.documents.iterate({ limit: 1 }))).resolves.toEqual(['doc-1', 'doc-2']);
    await expect(collectIds(client.issues.iterate({ limit: 1 }))).resolves.toEqual(['issue-1', 'issue-2']);
    await expect(collectIds(client.sprints.iterate({ limit: 1 }))).resolves.toEqual(['sprint-1', 'sprint-2']);

    expect(callSummary(calls)).toEqual([
      ['GET', 'https://ship.test/api/v1/documents?limit=1'],
      ['GET', 'https://ship.test/api/v1/documents?limit=1&cursor=doc-cursor'],
      ['GET', 'https://ship.test/api/v1/issues?limit=1'],
      ['GET', 'https://ship.test/api/v1/issues?limit=1&cursor=issue-cursor'],
      ['GET', 'https://ship.test/api/v1/sprints?limit=1'],
      ['GET', 'https://ship.test/api/v1/sprints?limit=1&cursor=sprint-cursor'],
    ]);
  });

  it('coalesces concurrent refresh-token retries behind one refresh request', async () => {
    const calls: FetchCall[] = [];
    let refreshCalls = 0;
    let releaseRefresh: (() => void) | undefined;
    let resolveRefreshStarted: () => void = () => {};
    const refreshStarted = new Promise<void>((resolve) => {
      resolveRefreshStarted = resolve;
    });
    const fetch: FetchLike = async (input, init) => {
      calls.push({ input, init });
      const url = String(input);

      if (url === 'https://ship.test/oauth/token') {
        refreshCalls += 1;
        resolveRefreshStarted();
        await new Promise<void>((release) => {
          releaseRefresh = release;
        });
        return jsonResponse({
          access_token: 'fresh-token',
          refresh_token: 'fresh-refresh',
          token_type: 'Bearer',
        });
      }

      if (authorizationHeader(init) === 'Bearer stale-token') {
        return jsonResponse({ code: 'unauthorized', message: 'stale token' }, 401);
      }
      if (url.endsWith('/api/v1/me')) {
        return jsonResponse({ id: 'user-1' });
      }
      return jsonResponse({ data: [], next_cursor: null });
    };
    const tokenStore = new MemoryTokenStore({
      accessToken: 'stale-token',
      refreshToken: 'refresh-token',
    });
    const client = new ShipClient({
      baseUrl: 'https://ship.test',
      clientId: 'ship-client',
      tokenStore,
      fetch,
    });
    const requests = Promise.all([client.me(), client.documents.list()]);

    await refreshStarted;
    await Promise.resolve();
    releaseRefresh?.();
    await requests;

    expect(refreshCalls).toBe(1);
    expect(callSummary(calls)).toEqual([
      ['GET', 'https://ship.test/api/v1/me'],
      ['GET', 'https://ship.test/api/v1/documents'],
      ['POST', 'https://ship.test/oauth/token'],
      ['GET', 'https://ship.test/api/v1/me'],
      ['GET', 'https://ship.test/api/v1/documents'],
    ]);
  });
});

function asyncJsonFetch(calls: FetchCall[] = []): FetchLike {
  return async (input, init) => {
    calls.push({ input, init });
    return jsonResponse({ data: [], next_cursor: null });
  };
}

function pagedJsonFetch(calls: FetchCall[], pages: unknown[]): FetchLike {
  return async (input, init) => {
    calls.push({ input, init });
    return jsonResponse(pages.shift() ?? { data: [], next_cursor: null });
  };
}

function callSummary(calls: FetchCall[]): Array<[string, string]> {
  return calls.map((call) => [call.init?.method ?? 'GET', String(call.input)]);
}

function jsonBody(call: FetchCall | undefined): unknown {
  if (!call || typeof call.init?.body !== 'string') return undefined;
  return JSON.parse(call.init.body) as unknown;
}

async function collectIds(iterable: AsyncIterable<{ id: string }>): Promise<string[]> {
  const ids: string[] = [];
  for await (const item of iterable) ids.push(item.id);
  return ids;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authorizationHeader(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get('Authorization') ?? undefined;
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  }
  return headers.Authorization ?? headers.authorization;
}
