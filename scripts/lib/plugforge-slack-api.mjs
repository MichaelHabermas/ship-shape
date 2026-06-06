// Slack Web API helpers for hosted PlugForge live proof (channel history + permalinks).
import { truncate } from './plugforge-live-drill.mjs';

const SLACK_AUTH_TEST_URL = 'https://slack.com/api/auth.test';
const SLACK_HISTORY_URL = 'https://slack.com/api/conversations.history';
const SLACK_GET_PERMALINK_URL = 'https://slack.com/api/chat.getPermalink';

export async function slackAuthTest(token, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(SLACK_AUTH_TEST_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const reason = payload.error ?? `${response.status} ${response.statusText}`;
    throw new Error(`Slack auth.test failed: ${reason}`);
  }
  return payload;
}

export async function findSlackChannelMessage(token, channelId, textNeedle, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const limit = options.limit ?? 40;
  const url = new URL(SLACK_HISTORY_URL);
  url.searchParams.set('channel', channelId);
  url.searchParams.set('limit', String(limit));
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const reason = payload.error ?? `${response.status} ${response.statusText}`;
    throw new Error(`Slack conversations.history failed: ${reason}`);
  }
  const match = (payload.messages ?? []).find((message) => (
    typeof message.text === 'string' && message.text.includes(textNeedle)
  ));
  if (!match?.ts) return null;
  const permalink = await fetchSlackPermalink(token, channelId, match.ts, fetchImpl);
  return {
    channel: channelId,
    message_ts: match.ts,
    permalink,
    text_preview: truncate(match.text),
  };
}

export async function fetchSlackPermalink(token, channelId, messageTs, fetchImpl = globalThis.fetch) {
  const url = new URL(SLACK_GET_PERMALINK_URL);
  url.searchParams.set('channel', channelId);
  url.searchParams.set('message_ts', messageTs);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false || typeof payload.permalink !== 'string') {
    return null;
  }
  return payload.permalink;
}
