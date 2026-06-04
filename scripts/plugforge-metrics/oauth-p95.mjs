#!/usr/bin/env node
// Gated OAuth Auth Code + PKCE metric probe measures real authorize, consent, and token routes.
import crypto from 'node:crypto';
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
const samples = Number.parseInt(String(args.samples ?? '20'), 10);
if (!Number.isInteger(samples) || samples < 1) {
  console.error('Usage: node scripts/plugforge-metrics/oauth-p95.mjs --samples <positive integer>');
  process.exit(2);
}

const maxP95Ms = requireNumber(args['max-p95-ms'], 3_000);
const startedAt = Date.now();
process.env.DATABASE_URL = resolveMetricDatabaseUrl();
process.env.SESSION_SECRET ||= 'plugforge-oauth-metric-secret';
process.env.NODE_ENV ||= 'test';

const requireFromApi = createRequire(path.join(rootDir, 'api', 'package.json'));
const request = requireFromApi('supertest');
const tsx = requireFromApi('tsx/cjs/api');
const { createApp } = tsx.require(path.join(rootDir, 'api', 'src', 'app.ts'), import.meta.url);
const { pool } = tsx.require(path.join(rootDir, 'api', 'src', 'db', 'client.ts'), import.meta.url);

const app = createApp();
const fixture = await seedFixture();
const timings = [];
const failures = [];

try {
  const csrf = await csrfCookie();
  for (let index = 0; index < samples; index += 1) {
    const flowStartedAt = performance.now();
    try {
      await runAuthorizationCodeFlow(index, csrf);
      timings.push(Math.round(performance.now() - flowStartedAt));
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
  await pool.end();
}

const p95 = percentile(timings, 95);
const ok = failures.length === 0 && typeof p95 === 'number' && p95 < maxP95Ms;
const report = {
  metric: 'oauth-auth-code-p95',
  status: ok ? 'measured' : 'failed',
  ok,
  generatedAt: nowIso(),
  durationMs: Date.now() - startedAt,
  targets: {
    maxP95Ms,
    samples,
  },
  result: {
    samplesSucceeded: timings.length,
    samplesFailed: failures.length,
    minMs: timings.length ? Math.min(...timings) : null,
    maxMs: timings.length ? Math.max(...timings) : null,
    p50Ms: percentile(timings, 50),
    p95Ms: p95,
  },
  failures,
};

const outputPath = await writeJsonReport('oauth-p95.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

async function seedFixture() {
  const runId = crypto.randomBytes(6).toString('hex');
  const clientId = `ship_app_oauth_metric_${runId}`;
  const redirectUri = `http://127.0.0.1/oauth-metric/${runId}/callback`;
  const workspaceId = (await pool.query(
    'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
    [`OAuth Metric ${runId}`]
  )).rows[0].id;
  const userId = (await pool.query(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, 'oauth-metric', 'OAuth Metric User')
     RETURNING id`,
    [`oauth-metric-${runId}@ship.local`]
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
     VALUES ($1, $2, 'OAuth Metric App', $3, 'oauth-metric-secret', $4, $5)
     RETURNING id`,
    [workspaceId, userId, clientId, [redirectUri], ['documents:read']]
  )).rows[0].id;
  const sessionId = `oauth_metric_${crypto.randomBytes(24).toString('hex')}`;
  await pool.query(
    `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
     VALUES ($1, $2, $3, NOW() + interval '1 hour')`,
    [sessionId, userId, workspaceId]
  );
  return { runId, clientId, redirectUri, workspaceId, userId, appId, sessionId };
}

async function runAuthorizationCodeFlow(index, csrf) {
  const pkce = createPkcePair();
  const state = `oauth-metric-${index}-${fixture.runId}`;
  const authorizeResponse = await request(app)
    .get('/oauth/authorize')
    .set('Cookie', `session_id=${fixture.sessionId}`)
    .query({
      client_id: fixture.clientId,
      redirect_uri: fixture.redirectUri,
      response_type: 'code',
      scope: 'documents:read',
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    });
  if (authorizeResponse.status !== 302) {
    throw new Error(`authorize returned ${authorizeResponse.status}`);
  }
  const requestId = requestIdFromConsentLocation(authorizeResponse.headers.location);

  const approvalResponse = await request(app)
    .post('/oauth/consent/approve')
    .set('Cookie', `${csrf.cookie}; session_id=${fixture.sessionId}`)
    .set('x-csrf-token', csrf.token)
    .send({ request_id: requestId });
  if (approvalResponse.status !== 200) {
    throw new Error(`consent approve returned ${approvalResponse.status}`);
  }

  const redirectUrl = approvalResponse.body?.data?.redirect_url;
  const code = redirectUrl ? new URL(redirectUrl).searchParams.get('code') : null;
  if (!code) throw new Error('consent approval omitted authorization code');

  const tokenResponse = await request(app)
    .post('/oauth/token')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      client_id: fixture.clientId,
      redirect_uri: fixture.redirectUri,
      code,
      code_verifier: pkce.verifier,
    });
  if (tokenResponse.status !== 200 || !tokenResponse.body?.access_token) {
    throw new Error(`token exchange returned ${tokenResponse.status}`);
  }
}

async function csrfCookie() {
  const response = await request(app).get('/api/csrf-token');
  const token = response.body?.token;
  const cookie = response.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
  if (!token || !cookie) throw new Error('CSRF token endpoint did not return token and cookie');
  return { token, cookie };
}

function requestIdFromConsentLocation(location) {
  if (!location) throw new Error('authorize response omitted Location');
  const url = new URL(location, 'http://127.0.0.1');
  const requestId = url.searchParams.get('request_id');
  if (!requestId) throw new Error(`authorize Location omitted request_id: ${location}`);
  return requestId;
}

function createPkcePair() {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function cleanupFixture() {
  await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2', [
    fixture.workspaceId,
    fixture.clientId,
  ]);
  await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM oauth_refresh_tokens WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM oauth_refresh_token_families WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM oauth_authorization_codes WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM oauth_authorization_requests WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM oauth_grants WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [fixture.sessionId]);
  await pool.query('DELETE FROM oauth_apps WHERE id = $1', [fixture.appId]);
  await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [fixture.workspaceId]);
  await pool.query('DELETE FROM users WHERE id = $1', [fixture.userId]);
  await pool.query('DELETE FROM workspaces WHERE id = $1', [fixture.workspaceId]);
}
