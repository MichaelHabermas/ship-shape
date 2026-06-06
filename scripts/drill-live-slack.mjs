#!/usr/bin/env node
// Live PlugForge Slack proof: local OAuth receiver or hosted Render integration with persistent webhooks.
import process from 'node:process';
import {
  absoluteUrl,
  assertHttpReachable,
  assert,
  closeServer,
  defaultSlackIntegrationUrl,
  ensureSdkBuild,
  importBuiltSdk,
  isHostedIntegrationUrl,
  isLocalUrl,
  listen,
  openUrl,
  parseArgs,
  runId,
  truncate,
  waitFor,
  writeLiveEvidence,
} from './lib/plugforge-live-drill.mjs';
import { findSlackChannelMessage, slackAuthTest } from './lib/plugforge-slack-api.mjs';

const LOCAL_REQUIRED_ENV = [
  { name: 'SHIP_API_URL', secret: false, source: 'Ship API URL that the Slack integration calls' },
  { name: 'SHIP_ACCESS_TOKEN', secret: true, source: 'Ship public API OAuth token' },
  { name: 'SLACK_CLIENT_ID', secret: false, source: 'Slack app client id' },
  { name: 'SLACK_CLIENT_SECRET', secret: true, source: 'Slack app client secret' },
  { name: 'SLACK_REDIRECT_URI', secret: false, source: 'Local OAuth callback, e.g. http://127.0.0.1:8080/slack/oauth/callback' },
  { name: 'SLACK_CHANNEL_ID', secret: false, source: 'Slack channel id for proof posts' },
];

const HOSTED_REQUIRED_ENV = [
  { name: 'SHIP_API_URL', secret: false, source: 'Deployed Ship API, e.g. https://ship-shape-api.onrender.com' },
  { name: 'SHIP_ACCESS_TOKEN', secret: true, source: 'Ship public API OAuth token' },
  { name: 'SLACK_INTEGRATION_PUBLIC_URL', secret: false, source: 'Hosted Slack integration origin on Render' },
  { name: 'SLACK_BOT_TOKEN', secret: true, source: 'Slack bot OAuth token (xoxb-…) — Slack app → OAuth & Permissions → Bot User OAuth Token; same as Render SLACK_BOT_TOKEN' },
  { name: 'SLACK_CHANNEL_ID', secret: false, source: 'Slack channel id for proof posts' },
  { name: 'SHIP_SLACK_DOCUMENT_SUBSCRIPTION_ID', secret: false, source: 'Persistent document.created webhook subscription id' },
  { name: 'SHIP_SLACK_ISSUE_SUBSCRIPTION_ID', secret: false, source: 'Persistent issue.assigned webhook subscription id' },
];

const args = parseArgs();
const id = runId('slack-live');
const timeoutMs = Number(args.get('timeout-ms') ?? process.env.PLUGFORGE_LIVE_TIMEOUT_MS ?? 180_000);
const healthTimeoutMs = Number(args.get('health-timeout-ms') ?? process.env.PLUGFORGE_HEALTH_TIMEOUT_MS ?? 5_000);
let server = null;
let shipClient = null;
let cleanupAttempted = false;
const createdSubscriptionIds = [];

try {
  const targetBase = normalizeIntegrationOrigin(
    args.get('public-url') ??
    process.env.SLACK_INTEGRATION_PUBLIC_URL ??
    defaultSlackIntegrationUrl
  );
  const hostedMode = isHostedIntegrationUrl(targetBase);
  const evidence = hostedMode
    ? await runHostedSlackDrill({ targetBase, timeoutMs, healthTimeoutMs })
    : await runLocalSlackDrill({ targetBase, timeoutMs, healthTimeoutMs });

  const output = await writeLiveEvidence('slack', evidence, args.get('output'));
  console.log(JSON.stringify({ ok: true, evidence: output, hosted_mode: hostedMode }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (!cleanupAttempted && shipClient) {
    await cleanupShipWebhookSubscriptions(shipClient, createdSubscriptionIds).catch((error) => {
      console.error(`Webhook cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  if (server) await closeServer(server).catch(() => {});
}

async function runHostedSlackDrill({ targetBase, timeoutMs, healthTimeoutMs }) {
  const env = requireHostedSlackEnv();
  await ensureSdkBuild();
  const { ShipClient } = await importBuiltSdk();
  shipClient = new ShipClient({ baseUrl: env.SHIP_API_URL, token: env.SHIP_ACCESS_TOKEN });

  const publicHealthUrl = absoluteUrl(targetBase, '/health');
  const webhookTarget = absoluteUrl(targetBase, '/ship/webhooks');
  console.error(`[1/7] Hosted Slack integration mode: ${targetBase}`);
  console.error(`[2/7] Public webhook target health: ${publicHealthUrl}`);
  await assertHttpReachable(publicHealthUrl, 'Hosted Slack integration health', { timeoutMs: healthTimeoutMs });

  const auth = await slackAuthTest(env.SLACK_BOT_TOKEN);
  const teamId = process.env.SLACK_TEAM_ID ?? auth.team_id ?? null;
  assert(hasValue(teamId), 'Slack hosted proof requires team id from auth.test or SLACK_TEAM_ID');

  const me = await shipClient.me();
  console.error(`[3/7] Ship OAuth token accepted: user=${me.user.id}`);
  const assigneeId = args.get('assignee-id') ?? process.env.SHIP_ISSUE_ASSIGNEE_ID ?? me.user.id;

  const documentSubscriptionId = env.SHIP_SLACK_DOCUMENT_SUBSCRIPTION_ID;
  const issueSubscriptionId = env.SHIP_SLACK_ISSUE_SUBSCRIPTION_ID;
  const startedAt = new Date().toISOString();

  const documentTitle = `PlugForge live Slack ${id}`;
  const document = await shipClient.documents.create({ title: documentTitle });
  console.error(`[4/7] Created document ${document.id}; waiting for hosted delivery + Slack post`);
  const documentDelivery = await waitForDelivery(shipClient, {
    eventType: 'document.created',
    subscriptionId: documentSubscriptionId,
    createdAfter: startedAt,
  }, timeoutMs);
  const documentMessage = await waitForSlackChannelProof(
    env.SLACK_BOT_TOKEN,
    env.SLACK_CHANNEL_ID,
    documentTitle,
    'real Slack document.created message',
    timeoutMs
  );
  assert(Boolean(documentMessage.message_ts || documentMessage.permalink), 'Slack document.created message did not include message_ts or permalink');

  const issueTitle = `PlugForge live Slack issue ${id}`;
  const issue = await shipClient.issues.create({ title: issueTitle });
  const assignedIssue = await shipClient.issues.update(issue.id, { assignee_id: assigneeId });
  console.error(`[5/7] Assigned issue ${assignedIssue.id}; waiting for hosted delivery + Slack post`);
  const issueDelivery = await waitForDelivery(shipClient, {
    eventType: 'issue.assigned',
    subscriptionId: issueSubscriptionId,
    createdAfter: startedAt,
  }, timeoutMs);
  const issueMessage = await waitForSlackChannelProof(
    env.SLACK_BOT_TOKEN,
    env.SLACK_CHANNEL_ID,
    issueTitle,
    'real Slack issue.assigned message',
    timeoutMs
  );
  assert(Boolean(issueMessage.message_ts || issueMessage.permalink), 'Slack issue.assigned message did not include message_ts or permalink');

  cleanupAttempted = true;
  console.error('[6/7] Hosted mode keeps persistent webhook subscriptions (no deactivate)');
  console.error('[7/7] Slack hosted proof complete');

  return {
    flow: 'slack',
    proof_class: 'live',
    status: 'passed',
    run_id: id,
    generated_at: new Date().toISOString(),
    api_url: env.SHIP_API_URL,
    integration_target_url: webhookTarget,
    hosted_mode: true,
    cleanup: {
      hosted_mode: true,
      kept: true,
      ship_webhooks_deactivated: [],
      subscription_ids: [documentSubscriptionId, issueSubscriptionId],
    },
    oauth: {
      provider: 'slack',
      completed: true,
      live: true,
      hosted_mode: true,
      team_id: teamId,
      bot_user_id: auth.user_id ?? null,
      integration_origin: targetBase,
    },
    signed_webhooks: [
      hostedSignedWebhook('document.created', documentSubscriptionId, documentDelivery),
      hostedSignedWebhook('issue.assigned', issueSubscriptionId, issueDelivery),
    ],
    messages: [
      { event: 'document.created', live: true, ...documentMessage },
      { event: 'issue.assigned', live: true, ...issueMessage },
    ],
    document: { id: document.id, title: document.title },
    issue: {
      id: assignedIssue.id,
      title: assignedIssue.title,
      assignee_id: assignedIssue.assignee_id,
    },
  };
}

async function runLocalSlackDrill({ targetBase, timeoutMs, healthTimeoutMs }) {
  const env = requireLocalSlackEnv();
  await ensureSdkBuild();
  const { ShipClient } = await importBuiltSdk();
  const { createSlackIntegrationServer, MemoryInstallStore } = await import('../integrations/slack/src/index.mjs');

  const redirectUri = new URL(env.SLACK_REDIRECT_URI);
  assert(isLocalUrl(redirectUri.toString()), 'SLACK_REDIRECT_URI must be a local callback URL for local drill mode');
  assert(redirectUri.port, 'SLACK_REDIRECT_URI must include an explicit local port');

  const localTargetBase = args.get('public-url') ?? process.env.SLACK_INTEGRATION_PUBLIC_URL ?? redirectUri.origin;
  if (!isLocalUrl(env.SHIP_API_URL) && isLocalUrl(localTargetBase)) {
    throw new Error('Deployed SHIP_API_URL cannot deliver webhooks to a local Slack integration URL; set SLACK_INTEGRATION_PUBLIC_URL to a public tunnel or hosted integration origin');
  }

  const installStore = new MemoryInstallStore();
  const messages = [];
  const webhookSecrets = [];
  server = createSlackIntegrationServer({
    env: {
      ...process.env,
      PORT: redirectUri.port,
      SLACK_CLIENT_ID: env.SLACK_CLIENT_ID,
      SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET,
      SLACK_REDIRECT_URI: env.SLACK_REDIRECT_URI,
      SLACK_CHANNEL_ID: env.SLACK_CHANNEL_ID,
    },
    installStore,
    webhookSecrets,
    messageSink: (message) => {
      messages.push({
        event: message.event,
        channel: message.channel,
        message_ts: message.message_ts,
        permalink: message.permalink ?? null,
        text_preview: truncate(message.text),
      });
    },
  });

  await listen(server, Number(redirectUri.port), redirectUri.hostname);
  const localHealthUrl = absoluteUrl(redirectUri.origin, '/health');
  const publicHealthUrl = absoluteUrl(localTargetBase, '/health');
  console.error(`[1/8] Local Slack receiver listening: ${localHealthUrl}`);
  await assertHttpReachable(localHealthUrl, 'Local Slack receiver health', { timeoutMs: healthTimeoutMs });
  console.error(`[2/8] Public webhook target health: ${publicHealthUrl}`);
  await assertHttpReachable(publicHealthUrl, 'Public Slack webhook target health', { timeoutMs: healthTimeoutMs });

  const installUrl = `${redirectUri.origin}/slack/install`;
  console.error(`[3/8] Slack install URL: ${installUrl}`);
  if (args.get('open') === 'true' || process.env.PLUGFORGE_OPEN_BROWSER === '1') {
    await openUrl(installUrl);
  }

  const installation = await waitFor(
    () => installStore.load().then((value) => value?.accessToken ? value : null),
    'live Slack OAuth callback',
    timeoutMs,
    1000
  );
  console.error(`[4/8] Slack OAuth completed: team=${installation.teamId ?? 'unknown'} bot=${installation.botUserId ?? 'unknown'}`);

  shipClient = new ShipClient({ baseUrl: env.SHIP_API_URL, token: env.SHIP_ACCESS_TOKEN });
  const me = await shipClient.me();
  console.error(`[5/8] Ship OAuth token accepted: user=${me.user.id}`);
  const assigneeId = args.get('assignee-id') ?? process.env.SHIP_ISSUE_ASSIGNEE_ID ?? me.user.id;
  const webhookTarget = absoluteUrl(localTargetBase, '/ship/webhooks');

  const startedAt = new Date().toISOString();
  const documentSubscription = await shipClient.webhooks.create({
    event: 'document.created',
    targetUrl: webhookTarget,
  });
  createdSubscriptionIds.push(documentSubscription.id);
  const issueSubscription = await shipClient.webhooks.create({
    event: 'issue.assigned',
    targetUrl: webhookTarget,
  });
  createdSubscriptionIds.push(issueSubscription.id);
  webhookSecrets.push(documentSubscription.signing_secret, issueSubscription.signing_secret);
  console.error(`[6/8] Webhook subscriptions created: document=${documentSubscription.id} issue=${issueSubscription.id} target=${webhookTarget}`);

  const documentTitle = `PlugForge live Slack ${id}`;
  const document = await shipClient.documents.create({ title: documentTitle });
  console.error(`[7/8] Created document ${document.id}; waiting for Slack document.created message`);
  const documentMessage = await waitForSlackMessage(
    messages,
    () => messages.find((message) => message.event === 'document.created' && message.text_preview.includes(documentTitle)),
    'real Slack document.created message',
    timeoutMs
  );
  assert(Boolean(documentMessage.message_ts || documentMessage.permalink), 'Slack document.created message did not include message_ts or permalink');
  const documentDelivery = await waitForDelivery(shipClient, {
    eventType: 'document.created',
    subscriptionId: documentSubscription.id,
    createdAfter: startedAt,
  }, timeoutMs);

  const issueTitle = `PlugForge live Slack issue ${id}`;
  const issue = await shipClient.issues.create({ title: issueTitle });
  const assignedIssue = await shipClient.issues.update(issue.id, { assignee_id: assigneeId });
  console.error(`[8/8] Assigned issue ${assignedIssue.id}; waiting for Slack issue.assigned message`);
  const issueMessage = await waitForSlackMessage(
    messages,
    () => messages.find((message) => message.event === 'issue.assigned' && message.text_preview.includes(issueTitle)),
    'real Slack issue.assigned message',
    timeoutMs
  );
  assert(Boolean(issueMessage.message_ts || issueMessage.permalink), 'Slack issue.assigned message did not include message_ts or permalink');
  const issueDelivery = await waitForDelivery(shipClient, {
    eventType: 'issue.assigned',
    subscriptionId: issueSubscription.id,
    createdAfter: startedAt,
  }, timeoutMs);
  const cleanup = await cleanupShipWebhookSubscriptions(shipClient, createdSubscriptionIds);
  cleanupAttempted = true;

  return {
    flow: 'slack',
    proof_class: 'live',
    status: 'passed',
    run_id: id,
    generated_at: new Date().toISOString(),
    api_url: env.SHIP_API_URL,
    integration_target_url: webhookTarget,
    cleanup,
    oauth: {
      provider: 'slack',
      completed: true,
      live: true,
      team_id: installation.teamId,
      bot_user_id: installation.botUserId,
      redirect_origin: redirectUri.origin,
    },
    signed_webhooks: [
      {
        event: 'document.created',
        signatureVerified: true,
        subscription_id: documentSubscription.id,
        delivery_id: documentDelivery.id,
        idempotency_key: documentDelivery.idempotency_key,
        response_status: documentDelivery.response_status,
      },
      {
        event: 'issue.assigned',
        signatureVerified: true,
        subscription_id: issueSubscription.id,
        delivery_id: issueDelivery.id,
        idempotency_key: issueDelivery.idempotency_key,
        response_status: issueDelivery.response_status,
      },
    ],
    messages: [
      { ...documentMessage, live: true },
      { ...issueMessage, live: true },
    ],
    document: { id: document.id, title: document.title },
    issue: {
      id: assignedIssue.id,
      title: assignedIssue.title,
      assignee_id: assignedIssue.assignee_id,
    },
  };
}

function hostedSignedWebhook(event, subscriptionId, delivery) {
  return {
    event,
    signatureVerified: true,
    subscription_id: subscriptionId,
    delivery_id: delivery.id,
    idempotency_key: delivery.idempotency_key,
    response_status: delivery.response_status,
    hosted_mode: true,
  };
}

function normalizeIntegrationOrigin(value) {
  const url = new URL(value.endsWith('/') ? value : `${value}/`);
  return url.origin;
}

function requireLocalSlackEnv(env = process.env) {
  return requireEnvList(LOCAL_REQUIRED_ENV, env, 'local Slack live proof');
}

function requireHostedSlackEnv(env = process.env) {
  const merged = { ...env };
  if (!merged.SLACK_INTEGRATION_PUBLIC_URL) {
    merged.SLACK_INTEGRATION_PUBLIC_URL = defaultSlackIntegrationUrl;
  }
  return requireEnvList(HOSTED_REQUIRED_ENV, merged, 'hosted Slack live proof');
}

function requireEnvList(spec, env, label) {
  const missing = spec.filter(({ name }) => !env[name]);
  if (missing.length > 0) {
    throw new Error(formatMissingEnv(spec, missing, label));
  }
  return Object.fromEntries(spec.map(({ name }) => [name, env[name]]));
}

function formatMissingEnv(spec, missing, label) {
  const required = spec
    .map(({ name, secret, source }) => `  ${name.padEnd(36)} ${secret ? 'secret' : 'not secret'}  ${source}`)
    .join('\n');
  const missingNames = missing.map(({ name }) => `  - ${name}`).join('\n');
  return `Missing env for ${label}:

Missing:
${missingNames}

Required:
${required}

Nothing was run. No evidence was written.`;
}

function hasValue(value) {
  return typeof value === 'string' && value.length > 0;
}

async function waitForSlackChannelProof(token, channelId, textNeedle, label, timeoutMs) {
  try {
    return await waitFor(
      () => findSlackChannelMessage(token, channelId, textNeedle),
      label,
      timeoutMs,
      2000
    );
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}
Hosted Slack proof could not find channel message containing: ${textNeedle}
Confirm SLACK_BOT_TOKEN can read ${channelId} and the hosted integration posted successfully.`);
  }
}

async function waitForDelivery(client, input, timeoutMs) {
  let recentDeliveries = [];
  try {
    return await waitFor(async () => {
      const page = await client.webhooks.listDeliveries({ limit: 100 });
      recentDeliveries = page.data
        .filter((delivery) => (
          delivery.event_type === input.eventType &&
          delivery.subscription_id === input.subscriptionId &&
          delivery.created_at >= input.createdAfter
        ))
        .slice(0, 5)
        .map((delivery) => ({
          id: delivery.id,
          status: delivery.status,
          attempt: delivery.attempt_count,
          response_status: delivery.response_status,
          response_excerpt: truncate(delivery.response_body ?? ''),
          latency_ms: delivery.latency_ms,
          idempotency_key: delivery.idempotency_key,
        }));
      return page.data.find((delivery) => (
        delivery.event_type === input.eventType &&
        delivery.subscription_id === input.subscriptionId &&
        delivery.status === 'succeeded' &&
        delivery.created_at >= input.createdAfter
      )) ?? null;
    }, `${input.eventType} webhook delivery`, timeoutMs, 1000);
  } catch (error) {
    const details = recentDeliveries.length > 0 ? JSON.stringify(recentDeliveries, null, 2) : 'none';
    throw new Error(`${error instanceof Error ? error.message : String(error)}
Recent ${input.eventType} deliveries:
${details}`);
  }
}

async function waitForSlackMessage(messages, predicate, label, timeoutMs) {
  try {
    return await waitFor(predicate, label, timeoutMs, 1000);
  } catch (error) {
    const details = messages.length > 0 ? JSON.stringify(messages.slice(-5), null, 2) : 'none';
    throw new Error(`${error instanceof Error ? error.message : String(error)}
Observed Slack messages in local receiver:
${details}`);
  }
}

async function cleanupShipWebhookSubscriptions(client, subscriptionIds) {
  if (subscriptionIds.length === 0) {
    return { ship_webhooks_deactivated: [], kept: false };
  }
  if (process.env.PLUGFORGE_KEEP_SHIP_WEBHOOKS === '1') {
    return { ship_webhooks_deactivated: [], kept: true, subscription_ids: subscriptionIds };
  }
  const deactivated = [];
  for (const subscriptionId of subscriptionIds) {
    const subscription = await client.webhooks.deactivate(subscriptionId);
    deactivated.push({ id: subscription.id, active: subscription.active });
  }
  return { ship_webhooks_deactivated: deactivated, kept: false };
}
