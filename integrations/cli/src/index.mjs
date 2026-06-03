#!/usr/bin/env node
// Ship CLI uses the public SDK for login, public API resources, and webhook tailing.
import http from 'node:http';
import process from 'node:process';
import { ShipClient, ShipError, verifyWebhook } from '@ship/sdk';
import {
  numberFlag,
  printJson,
  printRows,
  requireApiBaseUrl,
  shipClientFromParsed,
  stringFlag,
  tokenStoreFromParsed,
} from './public-api.mjs';

// Align with Ship Agent read scopes plus write/manage flags used by CLI commands.
const DEFAULT_LOGIN_SCOPE =
  'documents:read documents:write issues:read sprints:read webhooks:manage';

main().catch(error => {
  if (error instanceof ShipError) {
    console.error(`ship: ${error.message}`);
    if (error.requestId) console.error(`request_id: ${error.requestId}`);
    process.exit(error.kind === 'validation' ? 2 : 1);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const { parseArgs } = await import('./parse-args.mjs');
  const parsed = parseArgs(process.argv.slice(2));
  const [group, sub, action] = parsed.positionals;

  if (!group || parsed.flags.help || parsed.flags.h) {
    printHelp();
    return;
  }

  if (group === 'login') {
    await login(parsed);
    return;
  }

  if (group === 'me') {
    await cmdMe(parsed);
    return;
  }

  if (group === 'documents' || group === 'docs') {
    await routeDocuments(group, sub, action, parsed);
    return;
  }

  if (group === 'issues') {
    await routeIssues(sub, action, parsed);
    return;
  }

  if (group === 'sprints') {
    await routeSprints(sub, action, parsed);
    return;
  }

  if (group === 'fleetgraph') {
    await routeFleetgraph(sub, parsed);
    return;
  }

  if (group === 'webhooks') {
    await routeWebhooks(sub, action, parsed);
    return;
  }

  throw new ShipError({ kind: 'validation', message: `Unknown command: ${parsed.positionals.join(' ')}` });
}

async function login(parsed) {
  const baseUrl = requireApiBaseUrl(parsed);
  const clientId = requireValue(parsed, 'client-id', process.env.SHIP_CLIENT_ID, 'SHIP_CLIENT_ID');
  const client = await ShipClient.deviceLogin({
    baseUrl,
    clientId,
    scope: String(parsed.flags.scope ?? DEFAULT_LOGIN_SCOPE),
    tokenStore: tokenStoreFromParsed(parsed),
    onUserCode(code, verificationUrl, verificationUrlComplete) {
      console.log(`Open: ${verificationUrlComplete}`);
      console.log(`Code: ${code}`);
      console.log(`Waiting for approval at ${verificationUrl}`);
    },
  });
  const me = await client.me();
  console.log(`Logged in as ${me.user.email}`);
}

async function cmdMe(parsed) {
  printJson(await shipClientFromParsed(parsed).me());
}

async function routeDocuments(group, sub, action, parsed) {
  const verb = sub ?? action;
  if (verb === 'list' || verb === 'ls') {
    const page = await shipClientFromParsed(parsed).documents.list({
      limit: numberFlag(parsed.flags.limit),
      type: stringFlag(parsed.flags.type),
    });
    if (parsed.flags.json) {
      printJson(page);
      return;
    }
    printRows(page.data.map(document => ({
      id: document.id,
      type: document.document_type,
      title: document.title,
      updated: document.updated_at,
    })));
    return;
  }
  if (verb === 'get') {
    const id = parsed.positionals[group === 'docs' ? 2 : 2];
    if (!id) throw usage(`ship ${group} get <id>`);
    printJson(await shipClientFromParsed(parsed).documents.get(id));
    return;
  }
  if (verb === 'create') {
    const idIndex = group === 'docs' ? 2 : 2;
    const positionalTitle = parsed.positionals.slice(idIndex).join(' ').trim() || undefined;
    const title = stringFlag(parsed.flags.title) ?? positionalTitle;
    const document = await shipClientFromParsed(parsed).documents.create({
      title,
      document_type: stringFlag(parsed.flags.type),
    });
    if (parsed.flags.json) {
      printJson(document);
      return;
    }
    console.log(`${document.id}\t${document.title}`);
    return;
  }
  throw usage(`ship ${group} <list|get|create>`);
}

async function routeIssues(sub, action, parsed) {
  const verb = sub;
  const client = shipClientFromParsed(parsed);
  if (verb === 'list' || verb === 'ls') {
    printJson(await client.issues.list({
      limit: numberFlag(parsed.flags.limit),
      state: stringFlag(parsed.flags.state),
      assignee_id: stringFlag(parsed.flags['assignee-id']),
    }));
    return;
  }
  if (verb === 'get') {
    const id = parsed.positionals[2];
    if (!id) throw usage('ship issues get <id>');
    printJson(await client.issues.get(id));
    return;
  }
  if (verb === 'create') {
    printJson(await client.issues.create({
      title: requireFlag(parsed, 'title'),
      state: stringFlag(parsed.flags.state),
      priority: stringFlag(parsed.flags.priority),
    }));
    return;
  }
  if (verb === 'update' || verb === 'patch') {
    const id = parsed.positionals[2];
    if (!id) throw usage('ship issues update <id>');
    printJson(await client.issues.update(id, {
      state: stringFlag(parsed.flags.state),
      assignee_id: stringFlag(parsed.flags['assignee-id']),
      confirm_orphan_children: parsed.flags['confirm-orphan-children'] === true
        ? true
        : stringFlag(parsed.flags['confirm-orphan-children']) === 'true'
          ? true
          : undefined,
    }));
    return;
  }
  throw usage('ship issues <list|get|create|update>');
}

async function routeSprints(sub, action, parsed) {
  const client = shipClientFromParsed(parsed);
  if (sub === 'list' || sub === 'ls') {
    printJson(await client.sprints.list({ limit: numberFlag(parsed.flags.limit) }));
    return;
  }
  if (sub === 'get') {
    const id = parsed.positionals[2];
    if (!id) throw usage('ship sprints get <id>');
    printJson(await client.sprints.get(id));
    return;
  }
  if (sub === 'issues') {
    const sprintId = parsed.positionals[2];
    if (!sprintId) throw usage('ship sprints issues <sprint-id>');
    printJson(await client.sprints.listIssues(sprintId, { limit: numberFlag(parsed.flags.limit) }));
    return;
  }
  throw usage('ship sprints <list|get|issues>');
}

async function routeFleetgraph(sub, parsed) {
  if (sub === 'attention-contexts' || sub === 'contexts') {
    printJson(await shipClientFromParsed(parsed).fleetgraph.attentionContexts.list({
      limit: numberFlag(parsed.flags.limit),
      source_issue_id: stringFlag(parsed.flags['source-issue-id']),
      source_sprint_id: stringFlag(parsed.flags['source-sprint-id']),
    }));
    return;
  }
  throw usage('ship fleetgraph attention-contexts');
}

async function routeWebhooks(sub, action, parsed) {
  const client = shipClientFromParsed(parsed);
  if (sub === 'tail') {
    await webhooksTail(parsed);
    return;
  }
  if (sub === 'subscriptions') {
    if (action === 'list' || action === 'ls') {
      printJson(await client.webhooks.list({ limit: numberFlag(parsed.flags.limit) }));
      return;
    }
    if (action === 'create') {
      printJson(await client.webhooks.create({
        event: requireFlag(parsed, 'event'),
        target_url: requireFlag(parsed, 'target-url'),
      }));
      return;
    }
    throw usage('ship webhooks subscriptions <list|create>');
  }
  if (sub === 'deliveries') {
    if (action === 'list' || action === 'ls') {
      printJson(await client.webhooks.listDeliveries({ limit: numberFlag(parsed.flags.limit) }));
      return;
    }
    if (action === 'replay') {
      const id = parsed.positionals[3];
      if (!id) throw usage('ship webhooks deliveries replay <delivery-id>');
      printJson(await client.webhooks.replay(id));
      return;
    }
    throw usage('ship webhooks deliveries <list|replay>');
  }
  throw usage('ship webhooks <tail|subscriptions|deliveries>');
}

async function webhooksTail(parsed) {
  const client = shipClientFromParsed(parsed);
  const event = stringFlag(parsed.flags.event) ?? 'document.created';
  const once = Boolean(parsed.flags.once);
  const timeoutMs = numberFlag(parsed.flags['timeout-ms']) ?? 120_000;
  const configuredTargetUrl = stringFlag(parsed.flags['target-url']) ?? process.env.SHIP_WEBHOOK_PUBLIC_URL;

  let resolveFirstEvent;
  const firstEvent = new Promise(resolve => {
    resolveFirstEvent = resolve;
  });
  let signingSecret = stringFlag(parsed.flags.secret) ?? '';
  const received = [];

  const server = http.createServer(async (req, res) => {
    const rawBody = await readRawBody(req);
    const valid = signingSecret
      ? verifyWebhook(req.headers, rawBody, signingSecret)
      : false;
    res.statusCode = valid || !signingSecret ? 200 : 400;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Connection', 'close');
    res.end(JSON.stringify({ ok: valid || !signingSecret }));
    const payload = parseJson(rawBody);
    const line = {
      verified: valid,
      event: req.headers['ship-event-type'] ?? payload?.type ?? null,
      idempotency_key: req.headers['idempotency-key'] ?? null,
      payload,
    };
    received.push(line);
    process.stdout.write(`${JSON.stringify(line)}\n`);
    resolveFirstEvent(line);
    if (once) {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      server.close(() => undefined);
      setTimeout(() => process.exit(0), 25);
    }
  });

  await listen(server, numberFlag(parsed.flags.port) ?? 0);
  const address = server.address();
  const localPort = typeof address === 'object' && address ? address.port : null;
  if (!localPort) throw new ShipError({ kind: 'server', message: 'Webhook receiver failed to bind' });
  const targetUrl = configuredTargetUrl ?? `http://127.0.0.1:${localPort}/ship/webhooks`;

  if (!parsed.flags['no-register']) {
    const subscription = await client.webhooks.create({ event, targetUrl });
    signingSecret = subscription.signing_secret;
    console.error(`Listening on ${targetUrl}`);
    console.error(`Subscribed ${subscription.id} to ${event}`);
  } else {
    console.error(`Listening on ${targetUrl}`);
  }

  if (once) {
    const timer = setTimeout(() => {
      server.close();
      resolveFirstEvent(null);
    }, timeoutMs);
    const eventLine = await firstEvent;
    clearTimeout(timer);
    if (!eventLine) throw new ShipError({ kind: 'network', message: 'Timed out waiting for webhook event' });
    await closeServer(server);
  } else {
    await new Promise(resolve => server.on('close', resolve));
  }

  return received;
}

function requireValue(parsed, flag, envValue, envName) {
  const value = stringFlag(parsed.flags[flag]) ?? envValue;
  if (!value) {
    throw new ShipError({
      kind: 'validation',
      message: `Pass --${flag} or set ${envName}`,
    });
  }
  return value;
}

function requireFlag(parsed, flag) {
  const value = stringFlag(parsed.flags[flag]);
  if (!value) throw usage(`--${flag} is required`);
  return value;
}

function usage(message) {
  return new ShipError({ kind: 'validation', message });
}

function printHelp() {
  console.log(`ship login --api-url <url> --client-id <id>
ship me
ship documents list|get <id>|create --title <title>
ship issues list|get <id>|create --title <t>|update <id> --state <s>
ship sprints list|get <id>|issues <sprint-id>
ship fleetgraph attention-contexts
ship webhooks tail --once
ship webhooks subscriptions list|create --event <e> --target-url <url>
ship webhooks deliveries list|replay <delivery-id>`);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
