#!/usr/bin/env node
// Gated PlugForge baseline comparator checks public API latency, query counts, and SDK size drift.
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  nowIso,
  parseArgs,
  parseTrailingJson,
  percentile,
  resolveMetricDatabaseUrl,
  rootDir,
  runProcess,
  writeJsonReport,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const samples = Number.parseInt(String(args.samples ?? '5'), 10);
if (!Number.isInteger(samples) || samples < 1) {
  console.error('Usage: node scripts/plugforge-metrics/baseline-comparator.mjs --samples <positive integer>');
  process.exit(2);
}

const startedAt = Date.now();
const baselinePath = path.join(rootDir, 'scripts', 'plugforge-metrics', 'baseline.json');
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const maxRegressionRatio = Number(baseline.maxRegressionRatio ?? 1.1);
process.env.DATABASE_URL = resolveMetricDatabaseUrl();
process.env.SESSION_SECRET ||= 'plugforge-baseline-metric-secret';
process.env.NODE_ENV ||= 'test';

const requireFromApi = createRequire(path.join(rootDir, 'api', 'package.json'));
const tsx = requireFromApi('tsx/cjs/api');
const { pool } = tsx.require(path.join(rootDir, 'api', 'src', 'db', 'client.ts'), import.meta.url);
const { createOAuthAccessToken } = tsx.require(
  path.join(rootDir, 'api', 'src', 'platform', 'oauth', 'tokens.ts'),
  import.meta.url
);

let capture = null;
const originalQuery = pool.query.bind(pool);
pool.query = function measuredQuery(...queryArgs) {
  if (capture) capture.count += 1;
  return originalQuery(...queryArgs);
};

const { createApp } = tsx.require(path.join(rootDir, 'api', 'src', 'app.ts'), import.meta.url);
const apiServer = createServer(createApp());
const fixture = await seedFixture();
const failures = [];
const publicApiResults = [];
let sdkResult = null;

try {
  const apiBaseUrl = await listen(apiServer);
  await measurePublicApi(apiBaseUrl);
  sdkResult = await measureSdkSize();
} finally {
  await cleanupFixture().catch(error => {
    failures.push({
      target: 'cleanup',
      error: error instanceof Error ? error.message : String(error),
    });
  });
  await closeServer(apiServer);
  await pool.end();
}

for (const result of publicApiResults) {
  const target = baseline.publicApi[result.name];
  if (!target) {
    failures.push({ target: result.name, error: 'Missing public API baseline entry' });
    continue;
  }
  if (result.p95LatencyMs > target.p95LatencyMs * maxRegressionRatio) {
    failures.push({
      target: result.name,
      error: `P95 latency ${result.p95LatencyMs}ms exceeds +10% baseline ${target.p95LatencyMs}ms`,
    });
  }
  if (result.maxQueryCount > target.queryCount * maxRegressionRatio) {
    failures.push({
      target: result.name,
      error: `query count ${result.maxQueryCount} exceeds +10% baseline ${target.queryCount}`,
    });
  }
}

if (!sdkResult?.ok) {
  failures.push({ target: 'sdk.gzipBytes', error: 'SDK size probe failed inside baseline comparator' });
} else if (sdkResult.result.gzipBytes > baseline.sdk.gzipBytes * maxRegressionRatio) {
  failures.push({
    target: 'sdk.gzipBytes',
    error: `SDK gzip ${sdkResult.result.gzipBytes} exceeds +10% baseline ${baseline.sdk.gzipBytes}`,
  });
}

const report = {
  metric: 'plugforge-baseline-comparator',
  status: failures.length === 0 ? 'measured' : 'failed',
  ok: failures.length === 0,
  generatedAt: nowIso(),
  durationMs: Date.now() - startedAt,
  targets: {
    baseline: path.relative(rootDir, baselinePath),
    maxRegressionRatio,
    samples,
  },
  result: {
    publicApi: publicApiResults,
    sdk: sdkResult?.result ?? null,
  },
  failures,
};

const outputPath = await writeJsonReport('baseline-comparator.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

async function measurePublicApi(apiBaseUrl) {
  for (const name of Object.keys(baseline.publicApi)) {
    const [method, pathAndQuery] = name.split(' ');
    const timings = [];
    const queryCounts = [];
    for (let sample = 0; sample < samples; sample += 1) {
      capture = { count: 0 };
      const requestStartedAt = performance.now();
      const response = await fetch(`${apiBaseUrl}${pathAndQuery}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${fixture.accessToken}`,
        },
      });
      await response.text();
      timings.push(Math.round(performance.now() - requestStartedAt));
      queryCounts.push(capture.count);
      capture = null;
      if (!response.ok) {
        failures.push({ target: name, error: `HTTP ${response.status}` });
      }
    }
    publicApiResults.push({
      name,
      samples,
      p50LatencyMs: percentile(timings, 50),
      p95LatencyMs: percentile(timings, 95),
      maxQueryCount: Math.max(...queryCounts),
      queryCounts,
      timings,
    });
  }
}

async function measureSdkSize() {
  const result = await runProcess(process.execPath, [
    path.join(rootDir, 'scripts', 'plugforge-metrics', 'sdk-size.mjs'),
    '--no-write',
  ], { cwd: rootDir });
  const report = parseTrailingJson(result.stdout);
  return report ?? {
    ok: false,
    result: null,
    process: {
      exitCode: result.exitCode,
      stderrTail: result.stderr.slice(-1000),
    },
  };
}

async function seedFixture() {
  const runId = crypto.randomBytes(6).toString('hex');
  const clientId = `ship_app_baseline_metric_${runId}`;
  const workspaceId = (await pool.query(
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`Baseline Metric ${runId}`]
  )).rows[0].id;
  const userId = (await pool.query(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, 'baseline-metric', 'Baseline Metric User')
     RETURNING id`,
    [`baseline-metric-${runId}@ship.local`]
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
     VALUES ($1, $2, 'Baseline Metric App', $3, 'baseline-metric-secret', $4, $5)
     RETURNING id`,
    [
      workspaceId,
      userId,
      clientId,
      ['https://example.test/callback'],
      ['documents:read', 'documents:write', 'webhooks:manage'],
    ]
  )).rows[0].id;
  await pool.query(
    `INSERT INTO documents (
       workspace_id, document_type, title, properties, created_by, visibility
     )
     VALUES ($1, 'wiki', 'Baseline Metric Document', '{}', $2, 'workspace')`,
    [workspaceId, userId]
  );
  const accessToken = (await createOAuthAccessToken({
    appId,
    userId,
    workspaceId,
    grantedScopes: ['documents:read', 'documents:write', 'webhooks:manage'],
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  })).token;
  return { runId, clientId, workspaceId, userId, appId, accessToken };
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
