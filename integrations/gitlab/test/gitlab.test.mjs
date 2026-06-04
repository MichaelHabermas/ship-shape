// GitLab integration tests mock SDK fetch while exercising token verification and MR linking.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitLabIntegrationServer, extractShipIssueIds } from '../src/index.mjs';

const issueId = '123e4567-e89b-42d3-a456-426614174000';

test('extracts Ship issue UUID markers and URLs from merge requests', () => {
  assert.deepEqual(extractShipIssueIds({
    object_attributes: {
      title: `Link ship:issue:${issueId}`,
      description: `Also see https://ship.test/issues/${issueId}`,
    },
  }), [issueId]);
});

test('rejects GitLab webhooks with invalid token', async () => {
  const shipCalls = [];
  const server = createGitLabIntegrationServer({
    env: {
      GITLAB_WEBHOOK_SECRET: 'gitlab-secret',
      SHIP_API_URL: 'https://ship.test',
      SHIP_ACCESS_TOKEN: 'ship_oat_test',
    },
    fetch: async (url, init) => {
      shipCalls.push({ url: url.toString(), init });
      return jsonResponse({});
    },
  });
  await listen(server);
  try {
    const response = await fetch(`${serverBaseUrl(server)}/gitlab/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gitlab-token': 'wrong' },
      body: JSON.stringify(mergeRequestEvent()),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: 'invalid_gitlab_token' });
    assert.equal(shipCalls.length, 0);
  } finally {
    await close(server);
  }
});

test('links GitLab merge requests to existing Ship issues through the SDK', async () => {
  const shipCalls = [];
  const server = createGitLabIntegrationServer({
    env: {
      GITLAB_WEBHOOK_SECRET: 'gitlab-secret',
      SHIP_API_URL: 'https://ship.test',
      SHIP_ACCESS_TOKEN: 'ship_oat_test',
    },
    fetch: async (url, init) => {
      shipCalls.push({ url: url.toString(), init });
      assert.equal(init.method, 'POST');
      return jsonResponse({
        provider: 'gitlab',
        external_id: 'ship/repo!42',
        kind: 'merge_request',
        url: 'https://gitlab.test/ship/repo/-/merge_requests/42',
        title: 'Resolve SDK boundary',
        status: 'opened',
        created_at: '2026-06-03T00:00:00.000Z',
        updated_at: '2026-06-03T00:00:00.000Z',
      });
    },
  });
  await listen(server);
  try {
    const response = await fetch(`${serverBaseUrl(server)}/gitlab/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gitlab-token': 'gitlab-secret' },
      body: JSON.stringify(mergeRequestEvent()),
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, linked: 1, merge_request_iid: 42 });
    assert.equal(shipCalls.length, 1);
    assert.equal(shipCalls[0].url, `https://ship.test/api/v1/issues/${issueId}/external-links`);
    assert.deepEqual(JSON.parse(shipCalls[0].init.body), {
      provider: 'gitlab',
      external_id: 'ship/repo!42',
      kind: 'merge_request',
      url: 'https://gitlab.test/ship/repo/-/merge_requests/42',
      title: 'Resolve SDK boundary',
      status: 'opened',
    });
    assert.equal(shipCalls[0].init.headers.Authorization, 'Bearer ship_oat_test');
  } finally {
    await close(server);
  }
});

test('merge requests without Ship UUID markers are acknowledged without linking', async () => {
  const shipCalls = [];
  const server = createGitLabIntegrationServer({
    env: {
      GITLAB_WEBHOOK_SECRET: 'gitlab-secret',
      SHIP_API_URL: 'https://ship.test',
      SHIP_ACCESS_TOKEN: 'ship_oat_test',
    },
    fetch: async (url, init) => {
      shipCalls.push({ url: url.toString(), init });
      return jsonResponse({});
    },
  });
  await listen(server);
  try {
    const event = mergeRequestEvent();
    event.object_attributes.description = 'No public issue marker here';
    const response = await fetch(`${serverBaseUrl(server)}/gitlab/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gitlab-token': 'gitlab-secret' },
      body: JSON.stringify(event),
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, linked: 0, merge_request_iid: 42 });
    assert.equal(shipCalls.length, 0);
  } finally {
    await close(server);
  }
});

function mergeRequestEvent() {
  return {
    object_kind: 'merge_request',
    project: {
      id: 7,
      path_with_namespace: 'ship/repo',
      web_url: 'https://gitlab.test/ship/repo',
    },
    object_attributes: {
      id: 100,
      iid: 42,
      title: 'Resolve SDK boundary',
      state: 'opened',
      url: 'https://gitlab.test/ship/repo/-/merge_requests/42',
      source_branch: 'feature/public-sdk-boundary',
      target_branch: 'main',
      description: `Links Ship issue ship:issue:${issueId}`,
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, resolve));
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function serverBaseUrl(server) {
  const address = server.address();
  assert.equal(typeof address, 'object');
  return `http://127.0.0.1:${address.port}`;
}
