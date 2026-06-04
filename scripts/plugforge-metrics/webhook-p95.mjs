#!/usr/bin/env node
// Gated webhook P95 probe uses SDK subscription, public document create, and a signed local receiver.
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {
  nowIso,
  parseArgs,
  percentile,
  requireNumber,
  resolveMetricDatabaseUrl,
  rootDir,
  writeJsonReport,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const samples = Number.parseInt(String(args.samples ?? '25'), 10);
if (!Number.isInteger(samples) || samples < 1) {
  console.error('Usage: node scripts/plugforge-metrics/webhook-p95.mjs --samples <positive integer>');
  process.exit(2);
}

const maxP95Ms = requireNumber(args['max-p95-ms'], 2_000);
const startedAt = Date.now();
process.env.DATABASE_URL = resolveMetricDatabaseUrl();
process.env.SESSION_SECRET ||= 'plugforge-webhook-metric-secret';
process.env.NODE_ENV ||= 'test';

const requireFromApi = createRequire(path.join(rootDir, 'api', 'package.json'));
const tsx = requireFromApi('tsx/cjs/api');
const { createApp } = tsx.require(path.join(rootDir, 'api', 'src', 'app.ts'), import.meta.url);
const { pool } = tsx.require(path.join(rootDir, 'api', 'src', 'db', 'client.ts'), import.meta.url);
const { createOAuthAccessToken } = tsx.require(
  path.join(rootDir, 'api', 'src', 'platform', 'oauth', 'tokens.ts'),
  import.meta.url
);
const { ShipClient, verifyWebhook } = tsx.require(path.join(rootDir, 'sdk', 'src', 'index.ts'), import.meta.url);

const received = [];
let signingSecret = '';
const receiver = createServer(async (req, res) => {
  const rawBody = await readRawBody(req);
  const verified = signingSecret ? verifyWebhook(req.headers, rawBody, signingSecret) : false;
  const receivedAt = performance.now();
  received.push({
    receivedAt,
    verified,
    event: req.headers['ship-event-type'] ?? null,
    idempotencyKey: req.headers['idempotency-key'] ?? null,
    rawBody,
  });
  res.statusCode = verified ? 200 : 400;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: verified }));
});
const apiServer = createServer(createApp());
const fixture = await seedFixture();
const latencies = [];
const failures = [];

try {
  const apiBaseUrl = await listen(apiServer);
  const receiverBaseUrl = await listen(receiver);
  const client = new ShipClient({
    baseUrl: apiBaseUrl,
    token: fixture.accessToken,
  });
  const subscription = await client.webhooks.create({
    event: 'document.created',
    targetUrl: `${receiverBaseUrl}/ship/webhooks`,
  });
  signingSecret = subscription.signing_secret;

  for (let index = 0; index < samples; index += 1) {
    const sampleStartedAt = performance.now();
    try {
      const document = await client.documents.create({
        title: `webhook metric ${fixture.runId} ${index}`,
      });
      const idempotencyKey = `document.created:${document.id}`;
      const delivery = await waitForDelivery(idempotencyKey, sampleStartedAt);
      if (!delivery.verified) throw new Error(`delivery ${idempotencyKey} failed signature verification`);
      latencies.push(Math.round(delivery.receivedAt - sampleStartedAt));
    } catch (error) {
      failures.push({
        sample: index + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
} finally {
  await cleanupFixture().catch(error => {
    failures.push({
      sample: 'cleanup',
      error: error instanceof Error ? error.message : String(error),
    });
  });
  await closeServer(receiver);
  await closeServer(apiServer);
  await pool.end();
}

const p95 = percentile(latencies, 95);
const ok = failures.length === 0 && typeof p95 === 'number' && p95 < maxP95Ms;
const report = {
  metric: 'webhook-first-attempt-p95',
  status: ok ? 'measured' : 'failed',
  ok,
  generatedAt: nowIso(),
  durationMs: Date.now() - startedAt,
  targets: {
    maxP95Ms,
    samples,
  },
  result: {
    samplesSucceeded: latencies.length,
    samplesFailed: failures.length,
    minMs: latencies.length ? Math.min(...latencies) : null,
    maxMs: latencies.length ? Math.max(...latencies) : null,
    p50Ms: percentile(latencies, 50),
    p95Ms: p95,
  },
  failures,
};

const outputPath = await writeJsonReport('webhook-p95.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

async function seedFixture() {
  const runId = crypto.randomBytes(6).toString('hex');
  const clientId = `ship_app_webhook_metric_${runId}`;
  const workspaceId = (await pool.query(
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`Webhook Metric ${runId}`]
  )).rows[0].id;
  const userId = (await pool.query(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, 'webhook-metric', 'Webhook Metric User')
     RETURNING id`,
    [`webhook-metric-${runId}@ship.local`]
  )).rows[0].id;
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'admin')`,
    [workspaceId, userId]
  );
  const appId = (await pool.query(
    `INSERT INTO oauth_apps (
       workspace_id,
       owner_user_id,
       name,
       client_id,
       client_secret_hash,
       redirect_uris,
       requested_scopes
     )
     VALUES ($1, $2, 'Webhook Metric App', $3, 'webhook-metric-secret', $4, $5)
     RETURNING id`,
    [
      workspaceId,
      userId,
      clientId,
      ['https://example.test/callback'],
      ['documents:read', 'documents:write', 'webhooks:manage'],
    ]
  )).rows[0].id;
  const accessToken = (await createOAuthAccessToken({
    appId,
    userId,
    workspaceId,
    grantedScopes: ['documents:read', 'documents:write', 'webhooks:manage'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })).token;
  return { runId, clientId, workspaceId, userId, appId, accessToken };
}

async function waitForDelivery(idempotencyKey, sampleStartedAt) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const match = received.find(delivery => (
      delivery.idempotencyKey === idempotencyKey &&
      delivery.receivedAt >= sampleStartedAt
    ));
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for webhook delivery ${idempotencyKey}`);
}

async function cleanupFixture() {
  await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM webhook_subscriptions WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2', [
    fixture.workspaceId,
    fixture.clientId,
  ]);
  await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM documents WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM oauth_apps WHERE id = $1', [fixture.appId]);
  await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM users WHERE id = $1', [fixture.userId]);
  await pool.query('DELETE FROM workspaces WHERE id = $1', [fixture.workspaceId]);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('Server did not bind to a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    if (!server.listening) {
      resolve();
      return;
    }
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
