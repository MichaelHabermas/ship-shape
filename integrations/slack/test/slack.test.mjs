// Slack integration tests mock Slack HTTP while exercising OAuth, signatures, and dedupe.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createSlackIntegrationServer, MemoryInstallStore } from '../src/index.mjs';

const webhookSecret = 'whsec_slack_test';

test('Slack OAuth install stores token and signed Ship webhooks post once per Idempotency-Key', async () => {
  const slackCalls = [];
  const messages = [];
  const installStore = new MemoryInstallStore();
  const server = createSlackIntegrationServer({
    env: {
      SLACK_CLIENT_ID: 'client-123',
      SLACK_CLIENT_SECRET: 'secret-123',
      SLACK_REDIRECT_URI: 'http://127.0.0.1/slack/oauth/callback',
      SLACK_CHANNEL_ID: 'C123',
      SHIP_WEBHOOK_SECRET: webhookSecret,
    },
    installStore,
    messageSink: (message) => messages.push(message),
    fetch: async (url, init) => {
      slackCalls.push({ url: url.toString(), init });
      if (url.toString().endsWith('/oauth.v2.access')) {
        return jsonResponse({ ok: true, access_token: 'xoxb-installed', team: { id: 'T123' }, bot_user_id: 'B123' });
      }
      if (url.toString().endsWith('/chat.postMessage')) {
        return jsonResponse({ ok: true, ts: '1.234' });
      }
      return jsonResponse({ ok: false }, 404);
    },
  });
  await listen(server);
  try {
    const baseUrl = serverBaseUrl(server);
    const installResponse = await fetch(`${baseUrl}/slack/install`, { redirect: 'manual' });
    assert.equal(installResponse.status, 302);
    const location = new URL(installResponse.headers.get('location'));
    assert.equal(location.hostname, 'slack.com');
    const state = location.searchParams.get('state');
    assert.ok(state);

    const callback = await fetch(`${baseUrl}/slack/oauth/callback?code=oauth-code&state=${state}`);
    assert.equal(callback.status, 200);
    assert.deepEqual(await installStore.load(), {
      accessToken: 'xoxb-installed',
      teamId: 'T123',
      botUserId: 'B123',
      channelId: 'C123',
    });

    const event = {
      type: 'document.created',
      data: {
        document: { id: 'doc-1', title: 'Demo Doc', ui_url: 'https://ship.test/documents/doc-1' },
      },
    };
    const first = await postSignedWebhook(baseUrl, event, 'document.created:doc-1');
    const replay = await postSignedWebhook(baseUrl, event, 'document.created:doc-1');

    assert.deepEqual(first, { ok: true, deduped: false, posted: true });
    assert.deepEqual(replay, { ok: true, deduped: true });
    const postCalls = slackCalls.filter((call) => call.url.endsWith('/chat.postMessage'));
    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0].init.headers.authorization, 'Bearer xoxb-installed');
    assert.match(JSON.parse(postCalls[0].init.body).text, /Document created: Demo Doc/);
    assert.deepEqual(messages, [{
      event: 'document.created',
      channel: 'C123',
      message_ts: '1.234',
      permalink: null,
      text: 'Document created: Demo Doc (https://ship.test/documents/doc-1)',
    }]);
  } finally {
    await close(server);
  }
});

test('signed issue.assigned webhooks post to Slack with env bot token', async () => {
  const postBodies = [];
  const server = createSlackIntegrationServer({
    env: {
      SLACK_BOT_TOKEN: 'xoxb-env',
      SLACK_CHANNEL_ID: 'C999',
      SHIP_WEBHOOK_SECRET: webhookSecret,
    },
    fetch: async (url, init) => {
      assert.equal(url.toString(), 'https://slack.com/api/chat.postMessage');
      postBodies.push(JSON.parse(init.body));
      return jsonResponse({ ok: true, ts: '2.345' });
    },
  });
  await listen(server);
  try {
    const body = await postSignedWebhook(serverBaseUrl(server), {
      type: 'issue.assigned',
      data: {
        issue: { id: 'issue-1', title: 'Fix public link', ui_url: 'https://ship.test/issues/issue-1' },
        assignee: { name: 'Ada' },
      },
    }, 'issue.assigned:issue-1');

    assert.deepEqual(body, { ok: true, deduped: false, posted: true });
    assert.deepEqual(postBodies, [{
      channel: 'C999',
      text: 'Issue assigned: Fix public link -> Ada (https://ship.test/issues/issue-1)',
    }]);
  } finally {
    await close(server);
  }
});

test('failed Slack post responses include Slack error reason', async () => {
  const server = createSlackIntegrationServer({
    env: {
      SLACK_BOT_TOKEN: 'xoxb-env',
      SLACK_CHANNEL_ID: 'C999',
      SHIP_WEBHOOK_SECRET: webhookSecret,
    },
    fetch: async () => jsonResponse({ ok: false, error: 'not_in_channel' }),
  });
  await listen(server);
  try {
    const response = await postSignedWebhookResponse(serverBaseUrl(server), {
      type: 'document.created',
      data: {
        document: { id: 'doc-1', title: 'Demo Doc' },
      },
    }, 'document.created:doc-1');

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'SLACK_POST_MESSAGE_FAILED: not_in_channel',
    });
  } finally {
    await close(server);
  }
});

function postSignedWebhook(baseUrl, event, idempotencyKey) {
  return postSignedWebhookResponse(baseUrl, event, idempotencyKey)
    .then((response) => response.json());
}

function postSignedWebhookResponse(baseUrl, event, idempotencyKey) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return fetch(`${baseUrl}/ship/webhooks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'ship-signature': `t=${timestamp},v1=${signature}`,
    },
    body,
  });
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
