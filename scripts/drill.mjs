// TTFE drill packs SDK/CLI artifacts and proves login, documents, and signed webhooks.
import crypto from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const [, , drillName] = process.argv;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromApi = createRequire(new URL('../api/package.json', import.meta.url));
const { Pool } = requireFromApi('pg');

if (drillName !== 'ttfe') {
  console.error('Usage: pnpm drill ttfe');
  process.exit(1);
}

const timings = [];
const startedAt = Date.now();
let apiProcess = null;
let fixtures = null;
let databaseUrl = '';

try {
  await runTtfeDrill();
  stage('total', startedAt);
  console.log(JSON.stringify({ ok: true, timings }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
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
  const apiPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ship-ttfe-'));
  const tokenPath = path.join(tempDir, 'tokens.json');

  await timed('migrate', () => run('pnpm', ['--filter', '@ship/api', 'db:migrate'], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  }));
  fixtures = await timed('seed', () => seedFixtures(databaseUrl));
  const artifactDir = path.join(tempDir, 'artifacts');
  await fs.mkdir(artifactDir, { recursive: true });
  await timed('pack', async () => {
    await run('pnpm', ['--filter', '@ship/shared', 'build'], { cwd: rootDir });
    await run('pnpm', ['--filter', '@ship/sdk', 'build'], { cwd: rootDir });
    const sharedTarball = await packWorkspace('@ship/shared', artifactDir);
    const sdkTarball = await packWorkspace('@ship/sdk', artifactDir);
    const cliTarball = await packWorkspace('@ship/cli', artifactDir);
    await fs.writeFile(path.join(tempDir, 'package.json'), '{"type":"module","dependencies":{}}\n');
    await run('pnpm', ['add', sharedTarball, sdkTarball, cliTarball, '--ignore-scripts'], { cwd: tempDir });
  });

  apiProcess = spawn('pnpm', ['--filter', '@ship/api', 'exec', 'tsx', 'src/index.ts'], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      PORT: String(apiPort),
      HOST: '127.0.0.1',
      CORS_ORIGIN: apiUrl,
      FRONTEND_URL: apiUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', chunk => process.stderr.write(`[api] ${chunk}`));
  apiProcess.stderr.on('data', chunk => process.stderr.write(`[api] ${chunk}`));
  await timed('api-ready', () => waitForHttp(`${apiUrl}/api/v1/openapi.json`, 30_000));

  const shipBin = path.join(tempDir, 'node_modules', '.bin', 'ship');
  await timed('login', () => runLoginAndApprove({
    shipBin,
    apiUrl,
    clientId: fixtures.clientId,
    tokenPath,
    userId: fixtures.userId,
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
  await waitForOutput(tail.stderr, /Subscribed /, 10_000);

  await timed('docs-create', () => run(shipBin, [
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

  await timed('webhook-verified', async () => {
    try {
      await onceExit(tail, 35_000);
    } catch (error) {
      const diagnostics = await fetchDeliveryDiagnostics(apiUrl, tokenPath).catch((diagnosticError) => ({
        error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}; deliveries=${JSON.stringify(diagnostics)}`);
    }
    const lines = (await tailOutput).trim().split('\n').filter(Boolean);
    const event = lines.map(line => parseJson(line)).find(line => line?.event === 'document.created');
    if (!event) throw new Error(`ship webhooks tail did not receive document.created. Output: ${lines.join('\n')}`);
    if (event.verified !== true) throw new Error(`ship webhooks tail received an unsigned/invalid event: ${JSON.stringify(event)}`);
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
  await approveDeviceCode(databaseUrl, code[1], input.userId);
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
  try {
    const workspace = await pool.query(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`TTFE Drill ${runId}`]
    );
    const workspaceId = workspace.rows[0].id;
    const user = await pool.query(
      `INSERT INTO users (email, password_hash, name, last_workspace_id)
       VALUES ($1, 'ttfe-drill', 'TTFE Drill User', $2)
       RETURNING id`,
      [`ttfe-${runId}@ship.local`, workspaceId]
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
        ['documents:read', 'documents:write', 'webhooks:manage'],
      ]
    );
    return { workspaceId, userId, appId: app.rows[0].id, clientId };
  } finally {
    await pool.end();
  }
}

async function approveDeviceCode(url, userCode, userId) {
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      cwd: options.cwd ?? rootDir,
      env: options.env ?? process.env,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (stdout) process.stderr.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) {
        reject(new Error(`${command} ${args.join(' ')} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin?.end();
  });
}

async function timed(name, fn) {
  const start = Date.now();
  const result = await fn();
  stage(name, start);
  return result;
}

function stage(name, start) {
  const ms = Date.now() - start;
  timings.push({ stage: name, ms });
  console.error(`[ttfe] ${name}: ${ms}ms`);
}

function freePort() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
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

function onceExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      if (child.exitCode && child.exitCode !== 0) {
        reject(new Error(`Process ${child.pid} exited with ${child.exitCode}`));
        return;
      }
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for process ${child.pid} to exit`));
    }, timeoutMs);
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code && code !== 0) {
        reject(new Error(`Process ${child.pid} exited with ${code}`));
        return;
      }
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
