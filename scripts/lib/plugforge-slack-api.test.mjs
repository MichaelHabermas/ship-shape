// Unit tests for Slack Web API helpers used in hosted live proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { findSlackChannelMessage, slackAuthTest } from './plugforge-slack-api.mjs';

test('slackAuthTest returns team id from auth.test', async () => {
  const payload = await slackAuthTest('xoxb-test', async () => ({
    ok: true,
    json: async () => ({ ok: true, team_id: 'T123', user_id: 'U123' }),
  }));
  assert.equal(payload.team_id, 'T123');
});

test('findSlackChannelMessage locates proof text and permalink', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('conversations.history')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          messages: [{ ts: '1780000000.000001', text: 'Document created: PlugForge live Slack proof' }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        ok: true,
        permalink: 'https://example.slack.com/archives/C1/p1780000000000001',
      }),
    };
  };

  const message = await findSlackChannelMessage('xoxb-test', 'C123', 'PlugForge live Slack', { fetch: fetchImpl });
  assert.equal(message.message_ts, '1780000000.000001');
  assert.match(message.permalink, /slack\.com/);
});
