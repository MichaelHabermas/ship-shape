#!/usr/bin/env node
// Live PlugForge Slack proof: real Slack OAuth, real signed Ship webhooks, real Slack messages.
import process from 'node:process';
import {
  absoluteUrl,
  assert,
  closeServer,
  ensureSdkBuild,
  importBuiltSdk,
  isLocalUrl,
  listen,
  openUrl,
  parseArgs,
  runId,
  truncate,
  waitFor,
  writeLiveEvidence,
} from './lib/plugforge-live-drill.mjs';

const REQUIRED_ENV = [
  {
    name: 'SHIP_API_URL',
    secret: false,
    source: 'Ship API URL that the Slack integration calls',
  },
  {
    name: 'SHIP_ACCESS_TOKEN',
    secret: true,
    source: 'Ship public API OAuth token used to create documents, issues, and webhook subscriptions',
  },
  {
    name: 'SLACK_CLIENT_ID',
    secret: false,
    source: 'Slack app client id',
  },
  {
    name: 'SLACK_CLIENT_SECRET',
    secret: true,
    source: 'Slack app client secret',
  },
  {
    name: 'SLACK_REDIRECT_URI',
    secret: false,
    source: 'Local Slack OAuth callback URL, for example http://127.0.0.1:8080/slack/oauth/callback',
  },
  {
    name: 'SLACK_CHANNEL_ID',
    secret: false,
    source: 'Real Slack channel id where proof messages will be posted',
  },
];

const args = parseArgs();
const id = runId('slack-live');
const timeoutMs = Number(args.get('timeout-ms') ?? process.env.PLUGFORGE_LIVE_TIMEOUT_MS ?? 180_000);
let server = null;
let shipClient = null;
let cleanupAttempted = false;
const createdSubscriptionIds = [];

try {
  const env = requireSlackLiveEnv();
  await ensureSdkBuild();
  const { ShipClient } = await importBuiltSdk();
  const { createSlackIntegrationServer, MemoryInstallStore } = await import('../integrations/slack/src/index.mjs');

  const redirectUri = new URL(env.SLACK_REDIRECT_URI);
  assert(isLocalUrl(redirectUri.toString()), 'SLACK_REDIRECT_URI must be a local callback URL for this drill');
  assert(redirectUri.port, 'SLACK_REDIRECT_URI must include an explicit local port');

  const targetBase = args.get('public-url') ?? process.env.SLACK_INTEGRATION_PUBLIC_URL ?? redirectUri.origin;
  if (!isLocalUrl(env.SHIP_API_URL) && isLocalUrl(targetBase)) {
    throw new Error('Deployed SHIP_API_URL cannot deliver webhooks to a local Slack integration URL; set SLACK_INTEGRATION_PUBLIC_URL to a public tunnel or deployed integration origin');
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
  const installUrl = `${redirectUri.origin}/slack/install`;
  console.error(`Slack install URL: ${installUrl}`);
  if (args.get('open') === 'true' || process.env.PLUGFORGE_OPEN_BROWSER === '1') {
    await openUrl(installUrl);
  }

  const installation = await waitFor(
    () => installStore.load().then((value) => value?.accessToken ? value : null),
    'live Slack OAuth callback',
    timeoutMs,
    1000
  );

  shipClient = new ShipClient({ baseUrl: env.SHIP_API_URL, token: env.SHIP_ACCESS_TOKEN });
  const me = await shipClient.me();
  const assigneeId = args.get('assignee-id') ?? process.env.SHIP_ISSUE_ASSIGNEE_ID ?? me.user.id;
  const webhookTarget = absoluteUrl(targetBase, '/ship/webhooks');

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

  const documentTitle = `PlugForge live Slack ${id}`;
  const document = await shipClient.documents.create({ title: documentTitle });
  const documentMessage = await waitFor(
    () => messages.find((message) => message.event === 'document.created' && message.text_preview.includes(documentTitle)),
    'real Slack document.created message',
    timeoutMs,
    1000
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
  const issueMessage = await waitFor(
    () => messages.find((message) => message.event === 'issue.assigned' && message.text_preview.includes(issueTitle)),
    'real Slack issue.assigned message',
    timeoutMs,
    1000
  );
  assert(Boolean(issueMessage.message_ts || issueMessage.permalink), 'Slack issue.assigned message did not include message_ts or permalink');
  const issueDelivery = await waitForDelivery(shipClient, {
    eventType: 'issue.assigned',
    subscriptionId: issueSubscription.id,
    createdAfter: startedAt,
  }, timeoutMs);
  const cleanup = await cleanupShipWebhookSubscriptions(shipClient, createdSubscriptionIds);
  cleanupAttempted = true;

  const evidence = {
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
    document: {
      id: document.id,
      title: document.title,
    },
    issue: {
      id: assignedIssue.id,
      title: assignedIssue.title,
      assignee_id: assignedIssue.assignee_id,
    },
  };

  const output = await writeLiveEvidence('slack', evidence, args.get('output'));
  console.log(JSON.stringify({ ok: true, evidence: output }, null, 2));
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

function requireSlackLiveEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter(({ name }) => !env[name]);
  if (missing.length > 0) {
    throw new Error(formatMissingSlackEnv(missing));
  }
  return Object.fromEntries(REQUIRED_ENV.map(({ name }) => [name, env[name]]));
}

function formatMissingSlackEnv(missing) {
  const required = REQUIRED_ENV
    .map(({ name, secret, source }) => `  ${name.padEnd(24)} ${secret ? 'secret' : 'not secret'}  ${source}`)
    .join('\n');
  const missingNames = missing.map(({ name }) => `  - ${name}`).join('\n');
  return `Missing env for Slack live proof:

Missing:
${missingNames}

Required:
${required}

Optional:
  SLACK_INTEGRATION_PUBLIC_URL   Public tunnel/deployed URL if SHIP_API_URL is not local
  SHIP_ISSUE_ASSIGNEE_ID         Ship user id to assign the proof issue to; defaults to current user
  PLUGFORGE_OPEN_BROWSER=1       Open Slack install URL automatically
  PLUGFORGE_KEEP_SHIP_WEBHOOKS=1 Keep created Ship webhook subscriptions
  PLUGFORGE_LIVE_TIMEOUT_MS      Defaults to 180000

Nothing was run. No evidence was written.`;
}

async function waitForDelivery(client, input, timeoutMs) {
  return waitFor(async () => {
    const page = await client.webhooks.listDeliveries({ limit: 100 });
    return page.data.find((delivery) => (
      delivery.event_type === input.eventType &&
      delivery.subscription_id === input.subscriptionId &&
      delivery.status === 'succeeded' &&
      delivery.created_at >= input.createdAfter
    )) ?? null;
  }, `${input.eventType} webhook delivery`, timeoutMs, 1000);
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
