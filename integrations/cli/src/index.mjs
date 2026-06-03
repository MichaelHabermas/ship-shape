#!/usr/bin/env node
// Ship CLI uses the public SDK for login, documents, and webhook tailing.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { FileTokenStore, ShipClient, ShipError, verifyWebhook } from '@ship/sdk';

const DEFAULT_SCOPE = 'documents:read documents:write webhooks:manage';

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
  const parsed = parseArgs(process.argv.slice(2));
  const [group, command] = parsed.positionals;

  if (!group || parsed.flags.help || parsed.flags.h) {
    printHelp();
    return;
  }

  if (group === 'login') {
    await login(parsed);
    return;
  }

  if (group === 'docs') {
    if (command === 'ls' || command === 'list') {
      await docsList(parsed);
      return;
    }
    if (command === 'get') {
      await docsGet(parsed);
      return;
    }
    if (command === 'create') {
      await docsCreate(parsed);
      return;
    }
  }

  if (group === 'webhooks' && command === 'tail') {
    await webhooksTail(parsed);
    return;
  }

  throw new ShipError({ kind: 'validation', message: `Unknown command: ${parsed.positionals.join(' ')}` });
}

async function login(parsed) {
  const baseUrl = requireValue(parsed, 'api-url', process.env.SHIP_API_URL, 'SHIP_API_URL');
  const clientId = requireValue(parsed, 'client-id', process.env.SHIP_CLIENT_ID, 'SHIP_CLIENT_ID');
  const tokenStore = tokenStoreFrom(parsed);
  const client = await ShipClient.deviceLogin({
    baseUrl,
    clientId,
    scope: String(parsed.flags.scope ?? DEFAULT_SCOPE),
    tokenStore,
    onUserCode(code, verificationUrl, verificationUrlComplete) {
      console.log(`Open: ${verificationUrlComplete}`);
      console.log(`Code: ${code}`);
      console.log(`Waiting for approval at ${verificationUrl}`);
    },
  });
  const me = await client.me();
  console.log(`Logged in as ${me.user.email}`);
}

async function docsList(parsed) {
  const client = clientFrom(parsed);
  const page = await client.documents.list({
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
}

async function docsGet(parsed) {
  const id = parsed.positionals[2];
  if (!id) throw new ShipError({ kind: 'validation', message: 'Usage: ship docs get <id>' });
  printJson(await clientFrom(parsed).documents.get(id));
}

async function docsCreate(parsed) {
  const positionalTitle = parsed.positionals.slice(2).join(' ').trim() || undefined;
  const title = stringFlag(parsed.flags.title) ?? positionalTitle;
  const document = await clientFrom(parsed).documents.create({
    title,
    document_type: stringFlag(parsed.flags.type),
  });
  if (parsed.flags.json) {
    printJson(document);
    return;
  }
  console.log(`${document.id}\t${document.title}`);
}

async function webhooksTail(parsed) {
  const client = clientFrom(parsed);
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

function clientFrom(parsed) {
  return new ShipClient({
    baseUrl: requireValue(parsed, 'api-url', process.env.SHIP_API_URL, 'SHIP_API_URL'),
    clientId: stringFlag(parsed.flags['client-id']) ?? process.env.SHIP_CLIENT_ID,
    tokenStore: tokenStoreFrom(parsed),
  });
}

function tokenStoreFrom(parsed) {
  const tokenPath = stringFlag(parsed.flags['token-path'])
    ?? process.env.SHIP_TOKEN_PATH
    ?? path.join(os.homedir(), '.ship', 'tokens.json');
  return new FileTokenStore(tokenPath);
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    const raw = arg.replace(/^-+/, '');
    const [inlineKey, inlineValue] = raw.split('=', 2);
    if (inlineValue !== undefined) {
      flags[inlineKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('-')) {
      flags[inlineKey] = next;
      index += 1;
    } else {
      flags[inlineKey] = true;
    }
  }
  return { flags, positionals };
}

function requireValue(parsed, flag, envValue, envName) {
  const value = stringFlag(parsed.flags[flag]) ?? envValue;
  if (!value) {
    throw new ShipError({
      kind: 'validation',
      message: `Pass --${flag} or set ${envName}`,
    });
  }
  return value.replace(/\/+$/, '');
}

function stringFlag(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberFlag(value) {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function printRows(rows) {
  if (rows.length === 0) return;
  for (const row of rows) {
    console.log(Object.values(row).join('\t'));
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`ship login --api-url <url> --client-id <id>
ship docs ls
ship docs get <id>
ship docs create --title <title>
ship webhooks tail --once`);
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
