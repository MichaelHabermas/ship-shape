#!/usr/bin/env node
// Recreates Render-target Slack webhooks via public API and prints signing secrets once.
import process from 'node:process';
import {
  defaultSlackIntegrationUrl,
  ensureSdkBuild,
  importBuiltSdk,
  parseArgs,
} from '../lib/plugforge-live-drill.mjs';

const TARGET_URL = `${defaultSlackIntegrationUrl}/ship/webhooks`;
const args = parseArgs();

async function main() {
  const apiUrl = process.env.SHIP_API_URL ?? 'https://ship-shape-api.onrender.com';
  const token = process.env.SHIP_ACCESS_TOKEN;
  if (!token) {
    throw new Error('Set SHIP_ACCESS_TOKEN (PlugForge Slack Live Proof app OAuth token with webhooks:manage).');
  }

  await ensureSdkBuild();
  const { ShipClient } = await importBuiltSdk();
  const client = new ShipClient({ baseUrl: apiUrl, token });

  if (!args.has('keep-existing')) {
    const page = await client.webhooks.list({ limit: 100 });
    const renderSubs = page.data.filter((row) => row.target_url === TARGET_URL && row.active);
    for (const sub of renderSubs) {
      await client.webhooks.deactivate(sub.id);
      console.error(`Deactivated ${sub.event} subscription ${sub.id}`);
    }
  }

  const document = await client.webhooks.create({ event: 'document.created', targetUrl: TARGET_URL });
  const issue = await client.webhooks.create({ event: 'issue.assigned', targetUrl: TARGET_URL });

  const secrets = `${document.signing_secret},${issue.signing_secret}`;
  console.log(JSON.stringify({
    ok: true,
    target_url: TARGET_URL,
    document_subscription_id: document.id,
    issue_subscription_id: issue.id,
    ship_webhook_secrets: secrets,
    render_env: { SHIP_WEBHOOK_SECRETS: secrets },
    local_env: {
      SHIP_SLACK_DOCUMENT_SUBSCRIPTION_ID: document.id,
      SHIP_SLACK_ISSUE_SUBSCRIPTION_ID: issue.id,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
