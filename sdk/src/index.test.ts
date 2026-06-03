// SDK public work tests assert issue and sprint route methods stay callable.
import { describe, expect, it } from 'vitest';
import { ShipClient, type FetchLike } from './index.js';

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
});

function asyncJsonFetch(calls: FetchCall[] = []): FetchLike {
  return async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ data: [], next_cursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function callSummary(calls: FetchCall[]): Array<[string, string]> {
  return calls.map((call) => [call.init?.method ?? 'GET', String(call.input)]);
}

function jsonBody(call: FetchCall | undefined): unknown {
  if (!call || typeof call.init?.body !== 'string') return undefined;
  return JSON.parse(call.init.body) as unknown;
}
