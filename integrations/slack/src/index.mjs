// Slack reference integration receives signed Ship webhooks and posts selected events to Slack.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { verifyWebhook } from '@ship/sdk';

const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_OAUTH_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_GET_PERMALINK_URL = 'https://slack.com/api/chat.getPermalink';
const JSON_HEADERS = { 'content-type': 'application/json' };

export function createSlackIntegrationServer(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const installStore = options.installStore ?? createInstallStore(env);
  const processedKeys = options.processedKeys ?? new Set();
  const pendingStates = options.pendingStates ?? new Set();
  const webhookSecrets = options.webhookSecrets ?? parseWebhookSecrets(env);
  const messageSink = options.messageSink ?? null;
  const config = {
    clientId: env.SLACK_CLIENT_ID,
    clientSecret: env.SLACK_CLIENT_SECRET,
    redirectUri: env.SLACK_REDIRECT_URI,
    channelId: env.SLACK_CHANNEL_ID,
    webhookSecrets,
    botToken: env.SLACK_BOT_TOKEN,
  };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/slack/install') {
        handleInstall(res, config, pendingStates);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/slack/oauth/callback') {
        await handleCallback(url, res, { config, fetchImpl, installStore, pendingStates });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/ship/webhooks') {
        await handleWebhook(req, res, { config, fetchImpl, installStore, processedKeys, messageSink });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'internal_error' });
    }
  });
}

export async function startSlackIntegrationServer(options = {}) {
  const server = createSlackIntegrationServer(options);
  const port = Number(options.env?.PORT ?? process.env.PORT ?? 8080);
  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}

function handleInstall(res, config, pendingStates) {
  requireConfig(config.clientId, 'SLACK_CLIENT_ID');
  requireConfig(config.redirectUri, 'SLACK_REDIRECT_URI');
  const state = crypto.randomBytes(18).toString('base64url');
  pendingStates.add(state);
  const authorizeUrl = new URL(SLACK_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('scope', 'chat:write');
  authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizeUrl.searchParams.set('state', state);
  res.writeHead(302, { location: authorizeUrl.toString() });
  res.end();
}

async function handleCallback(url, res, deps) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !deps.pendingStates.delete(state)) {
    sendJson(res, 400, { ok: false, error: 'invalid_oauth_state' });
    return;
  }

  requireConfig(deps.config.clientId, 'SLACK_CLIENT_ID');
  requireConfig(deps.config.clientSecret, 'SLACK_CLIENT_SECRET');
  requireConfig(deps.config.redirectUri, 'SLACK_REDIRECT_URI');

  const body = new URLSearchParams({
    client_id: deps.config.clientId,
    client_secret: deps.config.clientSecret,
    code,
    redirect_uri: deps.config.redirectUri,
  });
  const response = await deps.fetchImpl(SLACK_OAUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false || !payload.access_token) {
    sendJson(res, 502, { ok: false, error: 'slack_oauth_failed' });
    return;
  }

  await deps.installStore.save({
    accessToken: payload.access_token,
    teamId: payload.team?.id ?? null,
    botUserId: payload.bot_user_id ?? null,
    channelId: deps.config.channelId ?? null,
  });
  sendJson(res, 200, { ok: true, team_id: payload.team?.id ?? null });
}

async function handleWebhook(req, res, deps) {
  if (deps.config.webhookSecrets.length === 0) throw new Error('SHIP_WEBHOOK_SECRET or SHIP_WEBHOOK_SECRETS is required');
  const rawBody = await readRequestBody(req);
  if (!deps.config.webhookSecrets.some((secret) => verifyWebhook(req.headers, rawBody, secret))) {
    sendJson(res, 400, { ok: false, error: 'invalid_signature' });
    return;
  }

  const idempotencyKey = headerValue(req.headers, 'idempotency-key');
  if (!idempotencyKey) {
    sendJson(res, 400, { ok: false, error: 'missing_idempotency_key' });
    return;
  }
  if (deps.processedKeys.has(idempotencyKey)) {
    sendJson(res, 200, { ok: true, deduped: true });
    return;
  }

  const event = JSON.parse(rawBody);
  const message = slackMessageForEvent(event);
  if (message) {
    const postResult = await postSlackMessage(message, deps);
    deps.messageSink?.({
      event: event.type ?? event.event_type,
      channel: postResult.channel,
      message_ts: postResult.ts,
      permalink: postResult.permalink ?? null,
      text: message,
    });
  }
  deps.processedKeys.add(idempotencyKey);
  sendJson(res, 200, { ok: true, deduped: false, posted: Boolean(message) });
}

async function postSlackMessage(text, deps) {
  const installation = await deps.installStore.load();
  const token = installation?.accessToken ?? deps.config.botToken;
  const channel = installation?.channelId ?? deps.config.channelId;
  requireConfig(token, 'SLACK_BOT_TOKEN or Slack OAuth installation');
  requireConfig(channel, 'SLACK_CHANNEL_ID');

  const response = await deps.fetchImpl(SLACK_POST_MESSAGE_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ channel, text }),
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const reason = payload.error ?? `${response.status} ${response.statusText}`;
    throw new Error(`SLACK_POST_MESSAGE_FAILED: ${reason}`);
  }
  const resolvedChannel = payload.channel ?? channel;
  const permalink = payload.ts
    ? await fetchSlackPermalink(deps.fetchImpl, token, resolvedChannel, payload.ts)
    : null;
  return {
    ...payload,
    channel: resolvedChannel,
    permalink,
  };
}

async function fetchSlackPermalink(fetchImpl, token, channel, messageTs) {
  const url = new URL(SLACK_GET_PERMALINK_URL);
  url.searchParams.set('channel', channel);
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

export function slackMessageForEvent(event) {
  const type = event.type ?? event.event_type;
  const data = event.data ?? event.payload ?? {};
  if (type === 'document.created') {
    const document = data.document ?? data;
    const title = document.title ?? document.name ?? document.id ?? 'Untitled';
    const url = document.ui_url ?? document.url ?? document.api_url;
    return url ? `Document created: ${title} (${url})` : `Document created: ${title}`;
  }
  if (type === 'issue.assigned') {
    const issue = data.issue ?? data;
    const assignee = data.assignee?.name ?? issue.assignee_name ?? issue.assignee_id ?? 'someone';
    const title = issue.title ?? issue.display_id ?? issue.id ?? 'issue';
    const url = issue.ui_url ?? issue.url ?? issue.api_url;
    const text = `Issue assigned: ${title} -> ${assignee}`;
    return url ? `${text} (${url})` : text;
  }
  return null;
}

function createInstallStore(env) {
  if (env.SLACK_INSTALL_STORE_FILE) return new FileInstallStore(env.SLACK_INSTALL_STORE_FILE);
  return new MemoryInstallStore();
}

export class MemoryInstallStore {
  installation = null;

  async load() {
    return this.installation;
  }

  async save(installation) {
    this.installation = installation;
  }
}

class FileInstallStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(installation) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(installation, null, 2)}\n`, { mode: 0o600 });
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function requireConfig(value, name) {
  if (!value) throw new Error(`${name}_REQUIRED`);
}

function parseWebhookSecrets(env) {
  return [env.SHIP_WEBHOOK_SECRET, ...(env.SHIP_WEBHOOK_SECRETS ?? '').split(',')]
    .map((secret) => secret?.trim())
    .filter(Boolean);
}

function headerValue(headers, name) {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSlackIntegrationServer().then((server) => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : process.env.PORT;
    console.log(`Ship Slack integration listening on ${port}`);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
