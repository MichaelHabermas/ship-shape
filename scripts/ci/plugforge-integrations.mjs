#!/usr/bin/env node
// PlugForge integration runner — live proof only by default; mock path is explicit and always fails gates.
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { freePort } from '../lib/net.mjs';
import { ensureSdkBuild as buildSdk, importBuiltSdk } from '../lib/plugforge-live-drill.mjs';
import { runCommand as runCommandCore } from '../lib/run-command.mjs';
import { sleep } from '../lib/process-utils.mjs';
import { startShipApi as startShipStack } from '../lib/ttfe-server.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { failLiveIntegrationRequired } from './plugforge-gate-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromApi = createRequire(new URL('../../api/package.json', import.meta.url));
const { Pool } = requireFromApi('pg');
const evidenceDir = path.join(rootDir, 'my-docs/evidence/plugforge-integrations');
const runId = process.env.PLUGFORGE_INTEGRATION_RUN_ID ?? `plugforge-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const completedReferenceFlows = new Set();
const childTails = new Map();
let sdkBuildReady = false;

const argv = process.argv.slice(2);
const mockOnly = argv.includes('--mock-only');
const flow = parseFlow(argv);
const behavioralFlows = new Set(['all', 'slack', 'gitlab', 'browser', 'matrix']);
const validFlows = new Set(['all', 'slack', 'gitlab', 'browser', 'boundary', 'matrix']);

if (!validFlows.has(flow)) {
  console.error(`Unknown flow "${flow}". Use --flow slack|gitlab|browser|boundary|matrix|all.`);
  process.exit(1);
}

if (!mockOnly && behavioralFlows.has(flow)) {
  failLiveIntegrationRequired(flow);
  process.exit(1);
}

if (mockOnly) {
  console.error('');
  console.error('⚠️  MOCK-ONLY MODE — this run does NOT prove live integrations and will FAIL gates.');
  console.error('');
}

try {
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.rm(path.join(evidenceDir, 'last-failure.json'), { force: true });
  const startedAt = Date.now();
  await runSelectedFlow(flow);
  if (mockOnly && behavioralFlows.has(flow)) {
    throw new Error(
      'MOCK-ONLY integration run finished executing code paths but is NOT live proof. ' +
      'Do not treat this as passing any PlugForge gate.'
    );
  }
  await writeEvidence(`${flow}-runner`, {
    proof_class: 'contract',
    status: 'passed',
    duration_ms: Date.now() - startedAt,
  });
  console.log(`PlugForge integrations ${flow} passed (${runId})`);
} catch (error) {
  await writeEvidence('last-failure', {
    proof_class: mockOnly ? 'dev_shortcut' : 'live',
    status: 'failed',
    failed_flow: flow,
    mock_only: mockOnly,
    error: error instanceof Error ? error.message : String(error),
    child_tails: Object.fromEntries(childTails),
  }).catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runSelectedFlow(selectedFlow) {
  switch (selectedFlow) {
    case 'all':
      await runReferenceFlow('slack');
      await runReferenceFlow('gitlab');
      await runReferenceFlow('browser');
      await runBoundaryFlow();
      await runMatrixFlow();
      return;
    case 'slack':
    case 'gitlab':
    case 'browser':
      await runReferenceFlow(selectedFlow);
      return;
    case 'boundary':
      await runBoundaryFlow();
      return;
    case 'matrix':
      await runMatrixFlow();
      return;
  }
}

async function runReferenceFlow(referenceFlow) {
  if (completedReferenceFlows.has(referenceFlow)) return;
  if (referenceFlow === 'slack') await runSlackFlow();
  if (referenceFlow === 'gitlab') await runGitLabFlow();
  if (referenceFlow === 'browser') await runBrowserFlow();
  completedReferenceFlows.add(referenceFlow);
}

async function runSlackFlow() {
  await ensureSdkBuild();
  await runCommand('pnpm', ['--filter', '@ship/slack-integration', 'check'], { timeoutMs: 90_000 });
  const { ShipClient } = await importBuiltSdk();
  const { createSlackIntegrationServer, MemoryInstallStore } = await import('../../integrations/slack/src/index.mjs');
  const databaseUrl = resolveDatabaseUrl();
  await migrateDatabase(databaseUrl);

  const fixture = await seedFixture(databaseUrl, {
    label: 'Slack Acceptance',
    scopes: ['documents:read', 'documents:write', 'issues:read', 'issues:write', 'webhooks:manage'],
  });
  const shipApi = await startShipApi(databaseUrl);
  const slackPosts = [];
  const slackOauthCalls = [];
  const processedKeys = new Set();
  const webhookSecrets = [];
  const slackPort = await freePort();
  const slackBaseUrl = `http://127.0.0.1:${slackPort}`;
  const installStore = new MemoryInstallStore();
  const slackServer = createSlackIntegrationServer({
    env: {
      SLACK_CLIENT_ID: 'slack-client-id',
      SLACK_CLIENT_SECRET: 'slack-client-secret',
      SLACK_REDIRECT_URI: `${slackBaseUrl}/slack/oauth/callback`,
      SLACK_CHANNEL_ID: 'CPLUGFORGE',
    },
    installStore,
    processedKeys,
    webhookSecrets,
    fetch: async (url, init) => {
      const href = url.toString();
      if (href.endsWith('/oauth.v2.access')) {
        slackOauthCalls.push({ url: href, method: init?.method ?? 'GET' });
        return jsonResponse({
          ok: true,
          access_token: 'xoxb-plugforge-installed',
          team: { id: 'TPLUGFORGE' },
          bot_user_id: 'BPLUGFORGE',
        });
      }
      if (href.endsWith('/chat.postMessage')) {
        slackPosts.push({
          authorization: headerValue(init?.headers, 'authorization'),
          body: JSON.parse(String(init?.body ?? '{}')),
        });
        return jsonResponse({ ok: true, ts: `${slackPosts.length}.000` });
      }
      return jsonResponse({ ok: false, error: 'not_found' }, 404);
    },
  });

  await listen(slackServer, slackPort);
  try {
    const installResponse = await fetch(`${slackBaseUrl}/slack/install`, { redirect: 'manual' });
    assert(installResponse.status === 302, 'Slack install did not redirect');
    const installLocation = new URL(installResponse.headers.get('location') ?? '');
    const state = installLocation.searchParams.get('state');
    assert(installLocation.hostname === 'slack.com', 'Slack install did not target slack.com');
    assert(Boolean(state), 'Slack install did not produce OAuth state');
    const callbackResponse = await fetch(`${slackBaseUrl}/slack/oauth/callback?code=oauth-code&state=${state}`);
    assert(callbackResponse.ok, 'Slack OAuth callback failed');
    const installation = await installStore.load();
    assert(installation?.accessToken === 'xoxb-plugforge-installed', 'Slack OAuth installation was not stored');

    const client = new ShipClient({ baseUrl: shipApi.url, token: fixture.accessToken });
    const documentSubscription = await client.webhooks.create({
      event: 'document.created',
      targetUrl: `${slackBaseUrl}/ship/webhooks`,
    });
    const issueSubscription = await client.webhooks.create({
      event: 'issue.assigned',
      targetUrl: `${slackBaseUrl}/ship/webhooks`,
    });
    webhookSecrets.push(documentSubscription.signing_secret, issueSubscription.signing_secret);

    const documentTitle = `PlugForge Slack Document ${fixture.runSlug}`;
    const document = await client.documents.create({ title: documentTitle });
    await waitFor(() => slackPosts.length >= 1, 'Slack document.created post');

    const issue = await client.issues.create({ title: `PlugForge Slack Issue ${fixture.runSlug}` });
    await client.issues.update(issue.id, { assignee_id: fixture.memberUserId });
    await waitFor(() => slackPosts.length >= 2, 'Slack issue.assigned post');

    const postCountBeforeReplay = slackPosts.length;
    const deliveries = await waitForDelivery(client, `document.created:${document.id}`);
    const replay = await client.webhooks.replay(deliveries.id);
    assert(replay.idempotency_key === `document.created:${document.id}`, 'Slack replay did not preserve Idempotency-Key');
    assert(slackPosts.length === postCountBeforeReplay, 'Slack replay posted a duplicate message');
    assert(processedKeys.has(`document.created:${document.id}`), 'Slack receiver did not process document idempotency key');

    const documentPost = slackPosts.find((post) => String(post.body.text).includes(documentTitle));
    const issuePost = slackPosts.find((post) => String(post.body.text).includes('Issue assigned:'));
    assert(Boolean(documentPost), 'Slack document.created message was not posted');
    assert(Boolean(issuePost), 'Slack issue.assigned message was not posted');
    assert(slackPosts.every((post) => post.authorization === 'Bearer xoxb-plugforge-installed'), 'Slack posts did not use OAuth bot token');

    await writeEvidence('slack', {
      proof_class: 'dev_shortcut',
      status: mockOnly ? 'mock_only_not_proof' : 'passed',
      api_url: shipApi.url,
      oauth_callback: true,
      slack_oauth_calls: slackOauthCalls.length,
      subscriptions: [
        { id: documentSubscription.id, event: documentSubscription.event },
        { id: issueSubscription.id, event: issueSubscription.event },
      ],
      posts: slackPosts.map((post) => ({ channel: post.body.channel, text: post.body.text })),
      replay: {
        idempotency_key: replay.idempotency_key,
        post_count_before: postCountBeforeReplay,
        post_count_after: slackPosts.length,
      },
    });
  } finally {
    await closeServer(slackServer);
    await shipApi.close();
    await fixture.cleanup();
  }
}

async function runGitLabFlow() {
  await ensureSdkBuild();
  await runCommand('pnpm', ['--filter', '@ship/gitlab-integration', 'check'], { timeoutMs: 90_000 });
  const { ShipClient } = await importBuiltSdk();
  const { createGitLabIntegrationServer } = await import('../../integrations/gitlab/src/index.mjs');
  const databaseUrl = resolveDatabaseUrl();
  await migrateDatabase(databaseUrl);

  const fixture = await seedFixture(databaseUrl, {
    label: 'GitLab Acceptance',
    scopes: ['issues:read', 'issues:write'],
  });
  const shipApi = await startShipApi(databaseUrl);
  const gitlabPort = await freePort();
  const gitlabBaseUrl = `http://127.0.0.1:${gitlabPort}`;
  const gitlabServer = createGitLabIntegrationServer({
    env: {
      GITLAB_WEBHOOK_SECRET: 'gitlab-plugforge-secret',
      SHIP_API_URL: shipApi.url,
      SHIP_ACCESS_TOKEN: fixture.accessToken,
    },
  });

  await listen(gitlabServer, gitlabPort);
  try {
    const client = new ShipClient({ baseUrl: shipApi.url, token: fixture.accessToken });
    const issue = await client.issues.create({ title: `PlugForge GitLab Issue ${fixture.runSlug}` });
    const mergeRequest = mergeRequestEvent(issue.id, fixture.runSlug);
    const response = await fetch(`${gitlabBaseUrl}/gitlab/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gitlab-token': 'gitlab-plugforge-secret',
      },
      body: JSON.stringify(mergeRequest),
    });
    assert(response.status === 202, `GitLab webhook returned ${response.status}`);
    const body = await response.json();
    assert(body.linked === 1, 'GitLab webhook did not link the Ship issue');

    const fetched = await client.issues.get(issue.id);
    const link = fetched.external_links.find((candidate) => candidate.external_id === `ship/plugforge!${fixture.runSlug}`);
    assert(Boolean(link), 'GitLab external link was not visible through public issue API');
    assert(link?.provider === 'gitlab', 'GitLab link provider was not gitlab');
    assert(link?.kind === 'merge_request', 'GitLab link kind was not merge_request');

    await writeEvidence('gitlab', {
      proof_class: 'dev_shortcut',
      status: mockOnly ? 'mock_only_not_proof' : 'passed',
      api_url: shipApi.url,
      issue_id: issue.id,
      webhook_response: body,
      external_link: link,
    });
  } finally {
    await closeServer(gitlabServer);
    await shipApi.close();
    await fixture.cleanup();
  }
}

async function runBrowserFlow() {
  await runCommand('pnpm', ['test:e2e:run', 'e2e/plugforge-acceptance.spec.ts'], {
    env: { ...process.env, PLUGFORGE_INTEGRATION_RUN_ID: runId, PLAYWRIGHT_WORKERS: process.env.PLAYWRIGHT_WORKERS ?? '1' },
    timeoutMs: 10 * 60 * 1000,
  });
  const artifact = await readEvidence('browser');
  assert(artifact.run_id === runId, 'Browser evidence did not come from this runner invocation');
  assert(artifact.status === 'passed', 'Browser evidence did not pass');
}

async function runBoundaryFlow() {
  const steps = [];
  steps.push(await runCommand('pnpm', ['plugforge:integrations:check']));
  steps.push(await runCommand('node', ['--test', './scripts/ci/check-integration-boundary.test.mjs']));
  await writeEvidence('boundary', {
    proof_class: 'contract',
    status: 'passed',
    steps: steps.map(commandSummary),
  });
}

async function runMatrixFlow() {
  await runReferenceFlow('slack');
  await runReferenceFlow('gitlab');
  await runReferenceFlow('browser');
  const reference = {
    slack: await readEvidence('slack'),
    gitlab: await readEvidence('gitlab'),
    browser: await readEvidence('browser'),
  };
  const acceptableReferenceStatus = mockOnly
    ? new Set(['passed', 'mock_only_not_proof'])
    : new Set(['passed']);
  assert(
    Object.values(reference).every((artifact) => acceptableReferenceStatus.has(artifact.status)),
    'Reference flow evidence is not all green',
  );

  const steps = [];
  steps.push(await runCommand('pnpm', ['drill', 'ttfe'], { timeoutMs: 3 * 60 * 1000 }));
  steps.push(await runCommand('./scripts/run-api-tests.sh', [
    '--',
    'src/platform/oauth/refresh-theft-drill.test.ts',
    'src/platform/api/v1/webhooks.test.ts',
  ], { timeoutMs: 3 * 60 * 1000 }));
  steps.push(await runCommand('pnpm', ['plugforge:developer-ops-e2e'], { timeoutMs: 10 * 60 * 1000 }));

  await writeEvidence('matrix', {
    proof_class: 'dev_shortcut',
    status: mockOnly ? 'mock_only_not_proof' : 'passed',
    reference_flows: {
      slack: reference.slack.generated_at,
      gitlab: reference.gitlab.generated_at,
      browser: reference.browser.generated_at,
    },
    matrix_flows: ['cli_ttfe', 'refresh_token_theft', 'idempotency_replay', 'slack', 'gitlab', 'browser_sdk_demo'],
    steps: steps.map(commandSummary),
  });
}

async function ensureSdkBuild() {
  if (sdkBuildReady) return;
  await buildSdk();
  sdkBuildReady = true;
}

async function startShipApi(databaseUrl) {
  const stack = await startShipStack({
    rootDir,
    databaseUrl,
    includeWeb: false,
    apiReadyPath: '/health',
    tailOnWaitFailure: true,
  });
  return {
    url: stack.apiUrl,
    close: stack.close,
  };
}

async function seedFixture(databaseUrl, input) {
  const pool = new Pool({ connectionString: databaseUrl });
  const runSlug = crypto.randomBytes(6).toString('hex');
  const workspaceName = `PlugForge ${input.label} ${runSlug}`;
  const clientId = `ship_app_${input.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${runSlug}`;
  const accessToken = `ship_oat_${crypto.randomBytes(32).toString('hex')}`;
  let fixture;

  try {
    const workspaceId = firstId(await pool.query(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [workspaceName]
    ));
    const adminUserId = firstId(await pool.query(
      `INSERT INTO users (email, password_hash, name, last_workspace_id)
       VALUES ($1, 'plugforge-hash', $2, $3)
       RETURNING id`,
      [`plugforge-admin-${runSlug}@ship.local`, `${input.label} Admin`, workspaceId]
    ));
    const memberUserId = firstId(await pool.query(
      `INSERT INTO users (email, password_hash, name, last_workspace_id)
       VALUES ($1, 'plugforge-hash', $2, $3)
       RETURNING id`,
      [`plugforge-member-${runSlug}@ship.local`, `${input.label} Member`, workspaceId]
    ));
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, adminUserId, memberUserId]
    );
    const appId = firstId(await pool.query(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, $3, $4, 'plugforge-secret-hash', $5, $6)
       RETURNING id`,
      [
        workspaceId,
        adminUserId,
        `${input.label} App`,
        clientId,
        ['http://127.0.0.1/callback'],
        input.scopes,
      ]
    ));
    await pool.query(
      `INSERT INTO oauth_access_tokens (
         app_id,
         user_id,
         workspace_id,
         token_hash,
         granted_scopes,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5, NOW() + interval '1 hour')`,
      [
        appId,
        adminUserId,
        workspaceId,
        crypto.createHash('sha256').update(accessToken).digest('hex'),
        input.scopes,
      ]
    );

    fixture = { runSlug, workspaceId, adminUserId, memberUserId, appId, clientId, accessToken };
    return {
      ...fixture,
      cleanup: () => cleanupFixture(databaseUrl, fixture),
    };
  } finally {
    await pool.end();
  }
}

async function cleanupFixture(databaseUrl, fixture) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [fixture.workspaceId]);
    await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [fixture.workspaceId]);
    await pool.query('DELETE FROM webhook_subscriptions WHERE app_id = $1', [fixture.appId]);
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR app_id = $2', [fixture.workspaceId, fixture.appId]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE app_id = $1', [fixture.appId]);
    await pool.query('DELETE FROM oauth_refresh_tokens WHERE app_id = $1', [fixture.appId]);
    await pool.query('DELETE FROM oauth_refresh_token_families WHERE app_id = $1', [fixture.appId]);
    await pool.query('DELETE FROM oauth_device_authorizations WHERE app_id = $1', [fixture.appId]);
    await pool.query('DELETE FROM oauth_grants WHERE app_id = $1', [fixture.appId]);
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [fixture.appId]);
    await pool.query(
      `DELETE FROM document_associations
       WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)
          OR related_id IN (SELECT id FROM documents WHERE workspace_id = $1)`,
      [fixture.workspaceId]
    );
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [fixture.workspaceId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [fixture.workspaceId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[fixture.adminUserId, fixture.memberUserId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [fixture.workspaceId]);
  } finally {
    await pool.end();
  }
}

async function waitForDelivery(client, idempotencyKey) {
  return waitFor(async () => {
    const page = await client.webhooks.listDeliveries({ limit: 50 });
    return page.data.find((delivery) => delivery.idempotency_key === idempotencyKey && delivery.status === 'succeeded') ?? null;
  }, `delivery ${idempotencyKey}`, 15_000);
}

function mergeRequestEvent(issueId, runSlug) {
  return {
    object_kind: 'merge_request',
    project: {
      id: 7,
      path_with_namespace: 'ship/plugforge',
      web_url: 'https://gitlab.example.test/ship/plugforge',
    },
    object_attributes: {
      id: 100,
      iid: runSlug,
      title: 'PlugForge public issue link',
      state: 'opened',
      url: `https://gitlab.example.test/ship/plugforge/-/merge_requests/${runSlug}`,
      source_branch: `plugforge-${runSlug}`,
      target_branch: 'main',
      description: `Links Ship issue ship:issue:${issueId}`,
    },
  };
}

function resolveDatabaseUrl() {
  return execFileSync(path.join(rootDir, 'scripts/resolve-database-url.sh'), ['ship_test_audit'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();
}

async function migrateDatabase(databaseUrl) {
  await runCommand('pnpm', ['--filter', '@ship/api', 'db:migrate'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeoutMs: 90_000,
  });
}

async function runCommand(command, args, options = {}) {
  const result = await runCommandCore(command, args, {
    ...options,
    cwd: rootDir,
    logCommand: true,
    tailChars: 6_000,
    throwOnFail: true,
  });
  childTails.set(result.commandLabel, {
    stdout_tail: result.stdout_tail,
    stderr_tail: result.stderr_tail,
  });
  return {
    command: result.commandLabel,
    exit_code: result.code,
    duration_ms: result.duration_ms,
    stdout_tail: result.stdout_tail,
    stderr_tail: result.stderr_tail,
  };
}

function commandSummary(result) {
  return {
    command: result.command,
    duration_ms: result.duration_ms,
    exit_code: result.exit_code,
  };
}

async function writeEvidence(flowName, payload) {
  await fs.mkdir(evidenceDir, { recursive: true });
  const body = {
    flow: flowName,
    run_id: runId,
    generated_at: new Date().toISOString(),
    ...payload,
  };
  await fs.writeFile(path.join(evidenceDir, `${flowName}.json`), `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

async function readEvidence(flowName) {
  const raw = await fs.readFile(path.join(evidenceDir, `${flowName}.json`), 'utf8');
  return JSON.parse(raw);
}

async function waitFor(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    lastValue = value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(lastValue)}`);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function parseFlow(args) {
  const index = args.indexOf('--flow');
  if (index !== -1) return args[index + 1] ?? 'all';
  const inline = args.find((arg) => arg.startsWith('--flow='));
  if (inline) return inline.slice('--flow='.length);
  return 'all';
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  if (Array.isArray(value)) return value[0];
  return value;
}

function firstId(result) {
  const id = result.rows[0]?.id;
  if (typeof id !== 'string') throw new Error('Expected insert to return id');
  return id;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
