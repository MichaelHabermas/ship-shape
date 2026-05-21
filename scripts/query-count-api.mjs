#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = resolve(rootDir, 'api');
const requireFromApi = createRequire(resolve(apiDir, 'package.json'));
const { config } = requireFromApi('dotenv');

config({ path: resolve(apiDir, '.env.local') });
config({ path: resolve(apiDir, '.env') });

process.env.DATABASE_URL ||= 'postgresql://localhost/ship_dev';
process.env.SESSION_SECRET ||= 'query-count-measurement-secret';
process.env.E2E_TEST ||= '1';

const endpoints = (process.env.QUERY_COUNT_ENDPOINTS || [
  '/api/documents?type=wiki',
  '/api/issues',
  '/api/dashboard/my-week',
  '/api/projects',
  '/api/bootstrap',
  '/api/search/content?q=auditloadrareterm&limit=10',
  '/api/search/content?q=auditloadmediumterm&limit=10',
  '/api/search/content?q=auditloadcommonterm&limit=10',
  '/api/search/content?q=auditloadnomatchterm&limit=10',
].join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const flowDefinitions = [
  {
    name: 'content_search_distribution',
    description: 'Content search across deterministic seeded rare, medium, common, and no-match terms.',
    requests: [
      '/api/search/content?q=auditloadrareterm&limit=10',
      '/api/search/content?q=auditloadmediumterm&limit=10',
      '/api/search/content?q=auditloadcommonterm&limit=10',
      '/api/search/content?q=auditloadnomatchterm&limit=10',
    ],
  },
  {
    name: 'old_docs_startup_fanout',
    description: 'Pre-bootstrap protected docs startup fanout: auth plus app-shell list/status requests.',
    requests: [
      '/api/auth/me',
      '/api/documents?type=wiki',
      '/api/programs',
      '/api/projects',
      '/api/issues',
      '/api/standups/status',
      '/api/accountability/action-items',
    ],
  },
  {
    name: 'current_bootstrap',
    description: 'Current protected startup hydration through the single bootstrap endpoint.',
    requests: [
      '/api/bootstrap',
    ],
  },
];
const email = process.env.QUERY_COUNT_EMAIL || process.env.BENCHMARK_EMAIL || 'dev@ship.local';
const outputPath = resolve(
  rootDir,
  process.env.QUERY_COUNT_OUTPUT || `test-results/perf/query-count-api-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);

const pg = requireFromApi('pg');
const originalQuery = pg.Pool.prototype.query;
let capture = null;

pg.Pool.prototype.query = function measuredQuery(...args) {
  if (capture) {
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text || '';
    capture.queries.push({
      sql: normalizeSql(sql),
      started_at_ms: Math.round(performance.now() - capture.startedAt),
    });
  }
  return originalQuery.apply(this, args);
};

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function summarizeStatements(queries) {
  const byStatement = new Map();
  for (const query of queries) {
    byStatement.set(query.sql, (byStatement.get(query.sql) || 0) + 1);
  }

  return [...byStatement.entries()]
    .map(([sql, count]) => ({ count, sql }))
    .sort((a, b) => b.count - a.count || a.sql.localeCompare(b.sql));
}

async function request(baseUrl, path, options = {}, cookie = '') {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {}),
    },
  });
}

async function measureRequest(baseUrl, endpoint, cookie) {
  capture = { startedAt: performance.now(), queries: [] };
  const startedAt = performance.now();
  const response = await request(baseUrl, endpoint, {}, cookie);
  const body = await response.text();
  const elapsedMs = performance.now() - startedAt;
  const queries = capture.queries;
  capture = null;

  return {
    endpoint,
    status: response.status,
    ok: response.ok,
    elapsed_ms: Math.round(elapsedMs),
    response_bytes: Buffer.byteLength(body),
    query_count: queries.length,
    statements: summarizeStatements(queries),
  };
}

async function measureFlow(baseUrl, flow, cookie) {
  const startedAt = performance.now();
  const requests = [];

  for (const endpoint of flow.requests) {
    requests.push(await measureRequest(baseUrl, endpoint, cookie));
  }

  return {
    name: flow.name,
    description: flow.description,
    request_count: requests.length,
    total_elapsed_ms: Math.round(performance.now() - startedAt),
    total_response_bytes: requests.reduce((sum, result) => sum + result.response_bytes, 0),
    total_query_count: requests.reduce((sum, result) => sum + result.query_count, 0),
    ok: requests.every((result) => result.ok),
    requests,
  };
}

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function createMeasurementSession(pool) {
  const userResult = await pool.query(
    `SELECT u.id AS user_id, wm.workspace_id
     FROM users u
     JOIN workspace_memberships wm ON wm.user_id = u.id
     WHERE LOWER(u.email) = LOWER($1)
     ORDER BY (u.last_workspace_id = wm.workspace_id) DESC, wm.created_at ASC
     LIMIT 1`,
    [email]
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new Error(`Could not find workspace member for "${email}". Run pnpm db:seed first.`);
  }

  const sessionId = `query_count_${randomBytes(24).toString('hex')}`;
  await pool.query(
    `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      user.user_id,
      user.workspace_id,
      new Date(Date.now() + 15 * 60 * 1000),
      new Date(),
      'query-count-api',
      '127.0.0.1',
    ]
  );

  return {
    sessionId,
    cookie: `session_id=${sessionId}`,
  };
}

const { tsImport } = requireFromApi('tsx/esm/api');
const { pool } = await tsImport(resolve(apiDir, 'src/db/client.ts'), import.meta.url);
const { createApp } = await tsImport(resolve(apiDir, 'src/app.ts'), import.meta.url);
const app = createApp('http://localhost:5173');
const server = createServer(app);
const baseUrl = await listen(server);
let measurementSession = null;

try {
  measurementSession = await createMeasurementSession(pool);
  const cookie = measurementSession.cookie;
  const results = [];

  for (const endpoint of endpoints) {
    results.push(await measureRequest(baseUrl, endpoint, cookie));
  }

  const flows = [];
  for (const flow of flowDefinitions) {
    flows.push(await measureFlow(baseUrl, flow, cookie));
  }

  const report = {
    generated_at: new Date().toISOString(),
    database: new URL(process.env.DATABASE_URL).pathname.slice(1),
    base_url: baseUrl,
    endpoints,
    results,
    flows,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`API query-count report written to ${outputPath}`);

  const failures = [
    ...results.filter((result) => !result.ok),
    ...flows.flatMap((flow) => flow.requests.filter((result) => !result.ok)),
  ];
  if (failures.length > 0) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
} finally {
  capture = null;
  try {
    if (measurementSession) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [measurementSession.sessionId]);
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await pool.end();
  }
  setImmediate(() => process.exit(process.exitCode || 0));
}
