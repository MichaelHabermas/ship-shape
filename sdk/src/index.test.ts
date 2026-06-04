// SDK public work tests assert route helpers, iterators, and refresh coalescing stay callable.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  CursorPage,
  PublicDocument,
  PublicDocumentCreateInput,
  PublicDocumentListParams,
  PublicFleetGraphAttentionContextListParams,
  PublicFleetGraphAttentionContextsListResponse,
  PublicIssue,
  PublicIssueCreateInput,
  PublicIssueExternalLink,
  PublicIssueExternalLinkInput,
  PublicIssueListParams,
  PublicIssueUpdateInput,
  PublicSprint,
  PublicSprintIssueListParams,
  PublicSprintListParams,
  PublicWebhookDelivery,
  PublicWebhookListParams,
  PublicWebhookSubscription,
  PublicWebhookSubscriptionCreated,
  WebhookEventType,
} from '@ship/shared';
import {
  FileTokenStore,
  MemoryTokenStore,
  ShipClient,
  ShipError,
  type FetchLike,
  type ShipErrorKind,
  type ShipErrorVariantData,
} from './index.js';

type FetchCall = {
  input: string | URL;
  init?: RequestInit;
};

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;
type Assert<T extends true> = T;
type AsyncReturn<T> = T extends (...args: infer _A) => Promise<infer R> ? R : never;
type MethodArgs<T> = T extends (...args: infer A) => unknown ? A : never;
type SdkOpenApiParity = [
  Assert<Equal<MethodArgs<ShipClient['documents']['list']>, [params?: PublicDocumentListParams]>>,
  Assert<Equal<AsyncReturn<ShipClient['documents']['list']>, CursorPage<PublicDocument>>>,
  Assert<Equal<MethodArgs<ShipClient['documents']['get']>, [id: string]>>,
  Assert<Equal<AsyncReturn<ShipClient['documents']['get']>, PublicDocument>>,
  Assert<Equal<MethodArgs<ShipClient['documents']['create']>, [input: PublicDocumentCreateInput]>>,
  Assert<Equal<AsyncReturn<ShipClient['documents']['create']>, PublicDocument>>,
  Assert<Equal<MethodArgs<ShipClient['issues']['list']>, [params?: PublicIssueListParams]>>,
  Assert<Equal<AsyncReturn<ShipClient['issues']['list']>, CursorPage<PublicIssue>>>,
  Assert<Equal<MethodArgs<ShipClient['issues']['get']>, [id: string]>>,
  Assert<Equal<AsyncReturn<ShipClient['issues']['get']>, PublicIssue>>,
  Assert<Equal<MethodArgs<ShipClient['issues']['create']>, [input: PublicIssueCreateInput]>>,
  Assert<Equal<AsyncReturn<ShipClient['issues']['create']>, PublicIssue>>,
  Assert<Equal<MethodArgs<ShipClient['issues']['update']>, [id: string, input: PublicIssueUpdateInput]>>,
  Assert<Equal<AsyncReturn<ShipClient['issues']['update']>, PublicIssue>>,
  Assert<Equal<MethodArgs<ShipClient['issues']['upsertExternalLink']>, [id: string, input: PublicIssueExternalLinkInput]>>,
  Assert<Equal<AsyncReturn<ShipClient['issues']['upsertExternalLink']>, PublicIssueExternalLink>>,
  Assert<Equal<MethodArgs<ShipClient['sprints']['list']>, [params?: PublicSprintListParams]>>,
  Assert<Equal<AsyncReturn<ShipClient['sprints']['list']>, CursorPage<PublicSprint>>>,
  Assert<Equal<MethodArgs<ShipClient['sprints']['get']>, [id: string]>>,
  Assert<Equal<AsyncReturn<ShipClient['sprints']['get']>, PublicSprint>>,
  Assert<Equal<MethodArgs<ShipClient['sprints']['listIssues']>, [id: string, params?: PublicSprintIssueListParams]>>,
  Assert<Equal<AsyncReturn<ShipClient['sprints']['listIssues']>, CursorPage<PublicIssue>>>,
  Assert<Equal<MethodArgs<ShipClient['fleetgraph']['attentionContexts']['list']>, [params?: PublicFleetGraphAttentionContextListParams]>>,
  Assert<Equal<AsyncReturn<ShipClient['fleetgraph']['attentionContexts']['list']>, PublicFleetGraphAttentionContextsListResponse>>,
  Assert<Equal<MethodArgs<ShipClient['webhooks']['list']>, [params?: PublicWebhookListParams]>>,
  Assert<Equal<AsyncReturn<ShipClient['webhooks']['list']>, CursorPage<PublicWebhookSubscription>>>,
  Assert<Equal<MethodArgs<ShipClient['webhooks']['create']>, [input: { event: WebhookEventType; targetUrl?: string; target_url?: string }]>>,
  Assert<Equal<AsyncReturn<ShipClient['webhooks']['create']>, PublicWebhookSubscriptionCreated>>,
  Assert<Equal<MethodArgs<ShipClient['webhooks']['listDeliveries']>, [params?: PublicWebhookListParams]>>,
  Assert<Equal<AsyncReturn<ShipClient['webhooks']['listDeliveries']>, CursorPage<PublicWebhookDelivery>>>,
  Assert<Equal<MethodArgs<ShipClient['webhooks']['replay']>, [deliveryId: string]>>,
  Assert<Equal<AsyncReturn<ShipClient['webhooks']['replay']>, PublicWebhookDelivery>>,
];
const sdkOpenApiParity: SdkOpenApiParity = [] as unknown as SdkOpenApiParity;
void sdkOpenApiParity;

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

  it('stores token identity metadata after /me and refreshes', async () => {
    const tokenStore = new MemoryTokenStore({
      accessToken: 'stale-token',
      refreshToken: 'refresh-token',
    });
    const fetch: FetchLike = async (input, init) => {
      if (String(input) === 'https://ship.test/oauth/token') {
        return jsonResponse({
          access_token: 'fresh-token',
          refresh_token: 'fresh-refresh',
          token_type: 'Bearer',
          expires_in: 900,
          scope: 'documents:read',
        });
      }
      if (authorizationHeader(init) === 'Bearer stale-token') {
        return jsonResponse({ code: 'unauthorized', message: 'stale', request_id: 'req-stale' }, 401);
      }
      return jsonResponse({
        user: {
          id: '00000000-0000-4000-8000-000000000101',
          email: 'sdk-user@ship.local',
          name: 'SDK User',
        },
        app: { client_id: 'ship_app_sdk' },
        workspace_id: '00000000-0000-4000-8000-000000000102',
        granted_scopes: ['documents:read'],
      });
    };
    const client = new ShipClient({
      baseUrl: 'https://ship.test',
      clientId: 'ship_app_sdk',
      tokenStore,
      fetch,
    });

    await client.me();

    expect(tokenStore.get()).toMatchObject({
      accessToken: 'fresh-token',
      refreshToken: 'fresh-refresh',
      clientId: 'ship_app_sdk',
      userId: '00000000-0000-4000-8000-000000000101',
      workspaceId: '00000000-0000-4000-8000-000000000102',
    });
  });

  it('maps network fetch failures into ShipError(network)', async () => {
    const client = new ShipClient({
      baseUrl: 'https://ship.test',
      token: 'token',
      fetch: async () => {
        throw new TypeError('socket disconnected');
      },
    });

    await expect(client.documents.list()).rejects.toMatchObject({
      kind: 'network',
      message: 'socket disconnected',
    });
  });

  it('preserves public API request_id, details, and retry-after on errors', async () => {
    const client = new ShipClient({
      baseUrl: 'https://ship.test',
      token: 'token',
      fetch: async () => jsonResponse({
        code: 'validation_failed',
        message: 'Invalid cursor',
        details: { reason: 'bad_cursor' },
        request_id: 'req-sdk-error',
      }, 400, { 'retry-after': '7' }),
    });

    await expect(client.documents.list()).rejects.toMatchObject({
      kind: 'validation',
      status: 400,
      code: 'validation_failed',
      requestId: 'req-sdk-error',
      details: { reason: 'bad_cursor' },
      retryAfter: 7,
    });
  });

  it('polls Device Grant through authorization_pending, slow_down, and token storage', async () => {
    const calls: FetchCall[] = [];
    const delays: number[] = [];
    const tokenStore = new MemoryTokenStore();
    let tokenPolls = 0;
    const fetch: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (String(input) === 'https://ship.test/oauth/device/code') {
        return jsonResponse({
          device_code: 'ship_odc_device',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://ship.test/oauth/device',
          verification_uri_complete: 'https://ship.test/oauth/device?user_code=ABCD-EFGH',
          expires_in: 60,
          interval: 5,
        });
      }

      tokenPolls += 1;
      if (tokenPolls === 1) return jsonResponse({ error: 'authorization_pending' }, 400);
      if (tokenPolls === 2) return jsonResponse({ error: 'slow_down' }, 400);
      return jsonResponse({
        access_token: 'device-access',
        refresh_token: 'device-refresh',
        token_type: 'Bearer',
        expires_in: 900,
        scope: 'documents:read',
      });
    };

    await ShipClient.deviceLogin({
      baseUrl: 'https://ship.test',
      clientId: 'ship_app_device',
      tokenStore,
      fetch,
      pollDelay: async (ms) => {
        delays.push(ms);
      },
      onUserCode: (code, verificationUrl, verificationUrlComplete) => {
        expect(code).toBe('ABCD-EFGH');
        expect(verificationUrl).toBe('https://ship.test/oauth/device');
        expect(verificationUrlComplete).toContain('user_code=ABCD-EFGH');
      },
    });

    expect(delays).toEqual([5_000, 5_000, 10_000]);
    expect(callSummary(calls)).toEqual([
      ['POST', 'https://ship.test/oauth/device/code'],
      ['POST', 'https://ship.test/oauth/token'],
      ['POST', 'https://ship.test/oauth/token'],
      ['POST', 'https://ship.test/oauth/token'],
    ]);
    expect(tokenStore.get()).toMatchObject({
      accessToken: 'device-access',
      refreshToken: 'device-refresh',
      clientId: 'ship_app_device',
    });
  });

  it('runs Authorization Code helper without a client secret and stores token metadata', async () => {
    const storage = memorySessionStorage([
      ['ship.oauth.pkce.ship_app_auth.state', 'state-1'],
      ['ship.oauth.pkce.ship_app_auth.verifier', 'verifier-1'],
    ]);
    const tokenStore = new MemoryTokenStore();
    const fetch: FetchLike = async (_input, init) => {
      expect(jsonBody({ input: '', init })).toEqual({
        grant_type: 'authorization_code',
        client_id: 'ship_app_auth',
        code: 'ship_oac_code',
        code_verifier: 'verifier-1',
        redirect_uri: 'https://integrator.test/callback',
      });
      return jsonResponse({
        access_token: 'auth-access',
        refresh_token: 'auth-refresh',
        token_type: 'Bearer',
      });
    };

    await ShipClient.authorizationCodeFlow({
      baseUrl: 'https://ship.test',
      clientId: 'ship_app_auth',
      currentUrl: 'https://integrator.test/callback?code=ship_oac_code&state=state-1',
      tokenStore,
      storage,
      fetch,
    });

    expect(tokenStore.get()).toMatchObject({
      accessToken: 'auth-access',
      refreshToken: 'auth-refresh',
      clientId: 'ship_app_auth',
    });
    expect(storage.getItem('ship.oauth.pkce.ship_app_auth.state')).toBeNull();
    expect(storage.getItem('ship.oauth.pkce.ship_app_auth.verifier')).toBeNull();
  });

  it('builds Authorization Code URLs without persisting client secrets', async () => {
    const storage = memorySessionStorage();
    let resolveAuthorizeUrl: (url: string) => void = () => {};
    const authorizeUrl = new Promise<string>((resolve) => {
      resolveAuthorizeUrl = resolve;
    });

    void ShipClient.authorizationCodeFlow({
      baseUrl: 'https://ship.test',
      clientId: 'ship_app_auth_url',
      currentUrl: 'https://integrator.test/callback',
      scope: ['documents:read'],
      storage,
      onAuthorizeUrl: resolveAuthorizeUrl,
    });

    const url = new URL(await authorizeUrl);
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('ship_app_auth_url');
    expect(url.searchParams.get('client_secret')).toBeNull();
    expect(JSON.stringify(storage.dump())).not.toContain('client_secret');
  });

  it('persists file token stores with identity metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ship-sdk-token-store-'));
    const tokenPath = join(directory, 'tokens.json');
    const store = new FileTokenStore(tokenPath);
    try {
      await store.set({
        accessToken: 'file-access',
        refreshToken: 'file-refresh',
        clientId: 'ship_app_file',
        userId: 'user-file',
        workspaceId: 'workspace-file',
      });

      expect(JSON.parse(await readFile(tokenPath, 'utf8'))).toMatchObject({
        accessToken: 'file-access',
        refreshToken: 'file-refresh',
        clientId: 'ship_app_file',
        userId: 'user-file',
        workspaceId: 'workspace-file',
      });
      await expect(store.get()).resolves.toMatchObject({
        accessToken: 'file-access',
        clientId: 'ship_app_file',
        userId: 'user-file',
        workspaceId: 'workspace-file',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps ShipErrorVariantData exhaustive by kind while ShipErrorData accepts broad kinds', () => {
    const labels = [
      { kind: 'auth', message: 'auth' },
      { kind: 'rate_limit', message: 'rate' },
      { kind: 'not_found', message: 'missing' },
      { kind: 'validation', message: 'bad' },
      { kind: 'network', message: 'network' },
      { kind: 'server', message: 'server' },
    ].map((data) => describeShipErrorKind(data as ShipErrorVariantData));

    expect(labels).toEqual(['auth', 'rate', 'missing', 'bad', 'network', 'server']);
    const broadKind: ShipErrorKind = 'server';
    expect(new ShipError({ kind: broadKind, message: 'boom' })).toBeInstanceOf(Error);
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

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
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

function memorySessionStorage(entries: Array<[string, string]> = []) {
  const values = new Map(entries);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    dump: () => Object.fromEntries(values),
  };
}

function describeShipErrorKind(data: ShipErrorVariantData): string {
  switch (data.kind) {
    case 'auth':
      return 'auth';
    case 'rate_limit':
      return 'rate';
    case 'not_found':
      return 'missing';
    case 'validation':
      return 'bad';
    case 'network':
      return 'network';
    case 'server':
      return 'server';
    default:
      return assertNever(data);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ShipErrorData kind: ${JSON.stringify(value)}`);
}
