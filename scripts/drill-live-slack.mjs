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
  requireEnv,
  runId,
  truncate,
  waitFor,
  writeEvidence,
} from './lib/plugforge-live-drill.mjs';

const args = parseArgs();
const id = runId('slack-live');
const timeoutMs = Number(args.get('timeout-ms') ?? process.env.PLUGFORGE_LIVE_TIMEOUT_MS ?? 180_000);
let server = null;

try {
  const env = requireEnv([
    'SHIP_API_URL',
    'SHIP_ACCESS_TOKEN',
    'SLACK_CLIENT_ID',
    'SLACK_CLIENT_SECRET',
    'SLACK_REDIRECT_URI',
    'SLACK_CHANNEL_ID',
  ]);
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

  const client = new ShipClient({ baseUrl: env.SHIP_API_URL, token: env.SHIP_ACCESS_TOKEN });
  const me = await client.me();
  const assigneeId = args.get('assignee-id') ?? process.env.SHIP_ISSUE_ASSIGNEE_ID ?? me.user.id;
  const webhookTarget = absoluteUrl(targetBase, '/ship/webhooks');
  const allowPersistentWebhooks = args.get('allow-persistent-webhooks') === 'true' ||
    process.env.PLUGFORGE_ALLOW_PERSISTENT_WEBHOOKS === '1';
  if (!isLocalUrl(env.SHIP_API_URL) && !allowPersistentWebhooks) {
    throw new Error('Refusing to create persistent Ship webhooks against a non-local API without --allow-persistent-webhooks or PLUGFORGE_ALLOW_PERSISTENT_WEBHOOKS=1');
  }

  const startedAt = new Date().toISOString();
  const documentSubscription = await client.webhooks.create({
    event: 'document.created',
    targetUrl: webhookTarget,
  });
  const issueSubscription = await client.webhooks.create({
    event: 'issue.assigned',
    targetUrl: webhookTarget,
  });
  webhookSecrets.push(documentSubscription.signing_secret, issueSubscription.signing_secret);

  const documentTitle = `PlugForge live Slack ${id}`;
  const document = await client.documents.create({ title: documentTitle });
  const documentMessage = await waitFor(
    () => messages.find((message) => message.event === 'document.created' && message.text_preview.includes(documentTitle)),
    'real Slack document.created message',
    timeoutMs,
    1000
  );
  assert(Boolean(documentMessage.message_ts || documentMessage.permalink), 'Slack document.created message did not include message_ts or permalink');
  const documentDelivery = await waitForDelivery(client, {
    eventType: 'document.created',
    subscriptionId: documentSubscription.id,
    createdAfter: startedAt,
  }, timeoutMs);

  const issueTitle = `PlugForge live Slack issue ${id}`;
  const issue = await client.issues.create({ title: issueTitle });
  const assignedIssue = await client.issues.update(issue.id, { assignee_id: assigneeId });
  const issueMessage = await waitFor(
    () => messages.find((message) => message.event === 'issue.assigned' && message.text_preview.includes(issueTitle)),
    'real Slack issue.assigned message',
    timeoutMs,
    1000
  );
  assert(Boolean(issueMessage.message_ts || issueMessage.permalink), 'Slack issue.assigned message did not include message_ts or permalink');
  const issueDelivery = await waitForDelivery(client, {
    eventType: 'issue.assigned',
    subscriptionId: issueSubscription.id,
    createdAfter: startedAt,
  }, timeoutMs);

  const evidence = {
    flow: 'slack',
    proof_class: 'live',
    status: 'passed',
    run_id: id,
    generated_at: new Date().toISOString(),
    api_url: env.SHIP_API_URL,
    integration_target_url: webhookTarget,
    persistent_webhooks_acknowledged: !isLocalUrl(env.SHIP_API_URL) ? allowPersistentWebhooks : false,
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

  const output = await writeEvidence('slack', evidence, args.get('output'));
  console.log(JSON.stringify({ ok: true, evidence: output }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (server) await closeServer(server).catch(() => {});
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
