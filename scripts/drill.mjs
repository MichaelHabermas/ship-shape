// TTFE drill packs SDK/CLI artifacts and proves login, documents, and signed webhooks.
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import { onceExit, sleep } from './lib/process-utils.mjs';
import { runCommand as runCommandCore } from './lib/run-command.mjs';
import { startShipApi } from './lib/ttfe-server.mjs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const [drillName, ...drillArgs] = process.argv.slice(2);
const drillFlags = new Set(drillArgs);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromApi = createRequire(new URL('../api/package.json', import.meta.url));
const { Pool } = requireFromApi('pg');
const useDevShortcut = drillFlags.has('--dev-shortcut');

if (drillName !== 'ttfe') {
  console.error('Usage: pnpm drill ttfe [--dev-shortcut]');
  process.exit(1);
}

const timings = [];
const debugTimings = [];
const startedAt = Date.now();
let apiProcess = null;
let webProcess = null;
let fixtures = null;
let databaseUrl = '';
let proof = {
  proofClass: useDevShortcut ? 'dev_shortcut' : 'live',
  approvalMethod: useDevShortcut ? 'sql_dev_shortcut' : 'oauth_device_ui',
  origins: null,
  approval: null,
  tailEvent: null,
};

try {
  await runTtfeDrill();
  stage('total', startedAt);
  console.log(JSON.stringify({ ok: true, ...proof, timings, debugTimings }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (webProcess) {
    webProcess.kill('SIGTERM');
    await onceExit(webProcess, 5_000).catch(() => webProcess?.kill('SIGKILL'));
  }
  if (apiProcess) {
    apiProcess.kill('SIGTERM');
    await onceExit(apiProcess, 5_000).catch(() => apiProcess?.kill('SIGKILL'));
  }
  if (fixtures && databaseUrl) {
    await cleanupFixtures(databaseUrl, fixtures).catch(error => {
      console.error(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function runTtfeDrill() {
  // Always resolve ship_test_audit so shell DATABASE_URL cannot seed one DB and start the API on another.
  databaseUrl = process.env.TTFE_DATABASE_URL ?? resolveDatabaseUrl('ship_test_audit');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-ttfe-'));
  const tokenPath = path.join(tempDir, 'tokens.json');

  await debugTimed('migrate', () => run('pnpm', ['--filter', '@ship/api', 'db:migrate'], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  }));
  fixtures = await debugTimed('seed', () => seedFixtures(databaseUrl));
  const artifactDir = path.join(tempDir, 'artifacts');
  await fs.mkdir(artifactDir, { recursive: true });
  await timed('install', async () => {
    await run('pnpm', ['--filter', '@ship/shared', 'build'], { cwd: rootDir });
    await run('pnpm', ['--filter', '@ship/sdk', 'build'], { cwd: rootDir });
    const sharedTarball = await packWorkspace('@ship/shared', artifactDir);
    const sdkTarball = await packWorkspace('@ship/sdk', artifactDir);
    const cliTarball = await packWorkspace('@ship/cli', artifactDir);
    await fs.writeFile(path.join(tempDir, 'package.json'), '{"type":"module","dependencies":{}}\n');
    await run('pnpm', ['add', sharedTarball, sdkTarball, cliTarball, '--ignore-scripts'], { cwd: tempDir });
  });

  const stack = await debugTimed('stack-ready', () => startShipApi({
    rootDir,
    databaseUrl,
    includeWeb: true,
  }));
  apiProcess = stack.apiProcess;
  webProcess = stack.webProcess;
  const { apiUrl, webUrl } = stack;
  proof.origins = { apiUrl, webUrl };

  const shipBin = path.join(tempDir, 'node_modules', '.bin', 'ship');
  await timed('login', () => runLoginAndApprove({
    shipBin,
    apiUrl,
    webUrl,
    clientId: fixtures.clientId,
    tokenPath,
    userId: fixtures.userId,
    email: fixtures.email,
    password: fixtures.password,
  }));

  const tail = spawn(shipBin, [
    'webhooks',
    'tail',
    '--api-url',
    apiUrl,
    '--client-id',
    fixtures.clientId,
    '--token-path',
    tokenPath,
    '--once',
    '--timeout-ms',
    '30000',
  ], {
    cwd: tempDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tail.stderr.on('data', chunk => process.stderr.write(`[tail] ${chunk}`));
  const tailOutput = collectOutput(tail.stdout);
  await timed('subscription', () => waitForOutput(tail.stderr, /Subscribed /, 10_000));

  await timed('create', () => run(shipBin, [
    'docs',
    'create',
    '--api-url',
    apiUrl,
    '--client-id',
    fixtures.clientId,
    '--token-path',
    tokenPath,
    '--title',
    'hello',
  ], { cwd: tempDir }));

  await timed('receipt', async () => {
    try {
      await onceExit(tail, 35_000);
    } catch (error) {
      const diagnostics = await fetchDeliveryDiagnostics(apiUrl, tokenPath).catch((diagnosticError) => ({
        error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}; deliveries=${JSON.stringify(diagnostics)}`);
    }
  });

  await timed('verification', async () => {
    const lines = (await tailOutput).trim().split('\n').filter(Boolean);
    const event = lines.map(line => parseJson(line)).find(line => line?.event === 'document.created');
    if (!event) throw new Error(`ship webhooks tail did not receive document.created. Output: ${lines.join('\n')}`);
    if (event.verified !== true) throw new Error(`ship webhooks tail received an unsigned/invalid event: ${JSON.stringify(event)}`);
    proof.tailEvent = sanitizeTailEvent(event);
  });
}

async function fetchDeliveryDiagnostics(apiUrl, tokenPath) {
  const tokens = JSON.parse(await fs.readFile(tokenPath, 'utf8'));
  const response = await fetch(`${apiUrl}/api/v1/webhooks/deliveries`, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: 'application/json',
    },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function runLoginAndApprove(input) {
  const login = spawn(input.shipBin, [
    'login',
    '--api-url',
    input.apiUrl,
    '--client-id',
    input.clientId,
    '--token-path',
    input.tokenPath,
  ], {
    cwd: rootDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  login.stderr.on('data', chunk => process.stderr.write(`[login] ${chunk}`));
  const output = collectOutput(login.stdout);
  const code = await waitForOutput(login.stdout, /Code: ([A-Z0-9-]+)/, 10_000);
  if (useDevShortcut) {
    await approveDeviceCodeViaSqlDevShortcut(databaseUrl, code[1], input.userId);
    proof.approval = {
      method: 'sql_dev_shortcut',
      userCodeSuffix: code[1].slice(-4),
    };
  } else {
    proof.approval = await approveDeviceCodeThroughWebUi({
      webUrl: input.webUrl,
      userCode: code[1],
      email: input.email,
      password: input.password,
    });
  }
  await onceExit(login, 30_000);
  const loginText = await output;
  if (!loginText.includes('Logged in as')) {
    throw new Error(`ship login did not complete. Output: ${loginText}`);
  }
}

async function seedFixtures(url) {
  const pool = new Pool({ connectionString: url });
  const runId = crypto.randomBytes(6).toString('hex');
  const clientId = `ship_ttfe_${runId}`;
  const password = `ttfe-${runId}-password`;
  const passwordHash = await bcrypt.hash(password, 8);
  try {
    const workspace = await pool.query(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`TTFE Drill ${runId}`]
    );
    const workspaceId = workspace.rows[0].id;
    const user = await pool.query(
      `INSERT INTO users (email, password_hash, name, last_workspace_id)
       VALUES ($1, $2, 'TTFE Drill User', $3)
       RETURNING id`,
      [`ttfe-${runId}@ship.local`, passwordHash, workspaceId]
    );
    const userId = user.rows[0].id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [workspaceId, userId]
    );
    const app = await pool.query(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, 'TTFE Drill App', $3, 'ttfe-drill', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        ['http://127.0.0.1/oauth/callback'],
        ['documents:read', 'documents:write', 'issues:read', 'sprints:read', 'webhooks:manage'],
      ]
    );
    return { workspaceId, userId, appId: app.rows[0].id, clientId, email: `ttfe-${runId}@ship.local`, password };
  } finally {
    await pool.end();
  }
}

async function approveDeviceCodeViaSqlDevShortcut(url, userCode, userId) {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const normalized = userCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const userCodeHash = crypto.createHash('sha256').update(normalized).digest('hex');
    const device = await client.query(
      `SELECT id, app_id, workspace_id, requested_scopes
       FROM oauth_device_authorizations
       WHERE user_code_hash = $1
       FOR UPDATE`,
      [userCodeHash]
    );
    const row = device.rows[0];
    if (!row) throw new Error(`No device authorization found for ${userCode}`);
    const grant = await client.query(
      `INSERT INTO oauth_grants (app_id, user_id, workspace_id, granted_scopes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (app_id, user_id, workspace_id)
       DO UPDATE
         SET granted_scopes = EXCLUDED.granted_scopes,
             revoked_at = NULL,
             updated_at = NOW()
       RETURNING id`,
      [row.app_id, userId, row.workspace_id, row.requested_scopes]
    );
    await client.query(
      `UPDATE oauth_device_authorizations
       SET authorized_user_id = $2,
           grant_id = $3,
           authorized_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [row.id, userId, grant.rows[0].id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function approveDeviceCodeThroughWebUi(input) {
  const { chromium } = await import('@playwright/test');
  const started = Date.now();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: input.webUrl });
  const verificationPath = `/oauth/device?user_code=${encodeURIComponent(input.userCode)}`;
  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.locator('#email').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#email').fill(input.email);
    await page.locator('#password').fill(input.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/login', { timeout: 15_000 });
    await page.goto(verificationPath, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Approve device login' }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByText('Approved. You can return to the CLI.').waitFor({ timeout: 15_000 });
    return {
      method: 'oauth_device_ui',
      verificationPath: '/oauth/device',
      usedUserCodeParam: true,
      durationMs: Date.now() - started,
    };
  } finally {
    await browser.close();
  }
}

async function cleanupFixtures(url, input) {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('DELETE FROM webhook_deliveries WHERE subscription_id IN (SELECT id FROM webhook_subscriptions WHERE app_id = $1)', [input.appId]);
    await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [input.workspaceId]);
    await pool.query('DELETE FROM webhook_subscriptions WHERE app_id = $1', [input.appId]);
    await pool.query('DELETE FROM public_api_audit_logs WHERE app_id = $1 OR workspace_id = $2', [input.appId, input.workspaceId]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE app_id = $1', [input.appId]);
    await pool.query('DELETE FROM oauth_refresh_tokens WHERE app_id = $1', [input.appId]);
    await pool.query('DELETE FROM oauth_refresh_token_families WHERE app_id = $1', [input.appId]);
    await pool.query('DELETE FROM oauth_device_authorizations WHERE app_id = $1', [input.appId]);
    await pool.query('DELETE FROM oauth_grants WHERE app_id = $1', [input.appId]);
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [input.appId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [input.workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [input.workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [input.userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [input.workspaceId]);
  } finally {
    await pool.end();
  }
}

async function packWorkspace(filter, destination) {
  const output = await run('pnpm', ['--filter', filter, 'pack', '--pack-destination', destination], { cwd: rootDir });
  const line = output.split('\n').map(value => value.trim()).find(value => value.endsWith('.tgz'));
  if (!line) throw new Error(`Could not find packed tarball for ${filter}: ${output}`);
  return path.isAbsolute(line) ? line : path.join(destination, path.basename(line));
}

function resolveDatabaseUrl(name) {
  return execFileSync(path.join(rootDir, 'scripts', 'resolve-database-url.sh'), [name], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
}

async function run(command, args, options = {}) {
  const result = await runCommandCore(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    throwOnFail: true,
    tailChars: null,
    timeoutMs: options.timeoutMs ?? 120_000,
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

async function timed(name, fn) {
  const start = Date.now();
  const result = await fn();
  stage(name, start);
  return result;
}

async function debugTimed(name, fn) {
  const start = Date.now();
  const result = await fn();
  debugStage(name, start);
  return result;
}

function stage(name, start) {
  const ms = Date.now() - start;
  timings.push({ stage: name, ms });
  console.error(`[ttfe] ${name}: ${ms}ms`);
}

function debugStage(name, start) {
  const ms = Date.now() - start;
  debugTimings.push({ stage: name, ms });
  console.error(`[ttfe:debug] ${name}: ${ms}ms`);
}

function waitForOutput(stream, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      stream.off('data', onData);
      reject(new Error(`Timed out waiting for output ${pattern}`));
    }, timeoutMs);
    function onData(chunk) {
      buffer += chunk.toString();
      process.stderr.write(chunk);
      const match = buffer.match(pattern);
      if (match) {
        clearTimeout(timeout);
        stream.off('data', onData);
        resolve(match);
      }
    }
    stream.on('data', onData);
  });
}

function collectOutput(stream) {
  return new Promise(resolve => {
    let buffer = '';
    stream.on('data', chunk => {
      buffer += chunk.toString();
    });
    stream.on('end', () => resolve(buffer));
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeTailEvent(event) {
  return {
    verified: event.verified === true,
    event: event.event ?? null,
    idempotency_key: event.idempotency_key ?? null,
    payload: event.payload ?? null,
  };
}
