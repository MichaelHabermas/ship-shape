#!/usr/bin/env node
// Live PlugForge GitLab proof: real project webhook, real MR event, real Ship external link.
import process from 'node:process';
import {
  absoluteUrl,
  assert,
  assertHttpReachable,
  closeServer,
  ensureSdkBuild,
  importBuiltSdk,
  isRealExternalHttpsUrl,
  listen,
  parseArgs,
  runId,
  truncate,
  waitFor,
  writeLiveEvidence,
} from './lib/plugforge-live-drill.mjs';

const REQUIRED_ENV = [
  {
    name: 'SHIP_API_URL',
    secret: false,
    source: 'Deployed Ship public API base URL, for example https://ship-shape-api.onrender.com',
  },
  {
    name: 'SHIP_ACCESS_TOKEN',
    secret: true,
    source: 'Ship public API OAuth token that can create/read issues and upsert issue external links',
  },
  {
    name: 'GITLAB_TOKEN',
    secret: true,
    source: 'GitLab token for the target project with permission to create hooks, branches, files, and merge requests',
  },
  {
    name: 'GITLAB_PROJECT_ID',
    secret: false,
    source: 'GitLab numeric project id or URL-encoded path such as namespace/project',
  },
  {
    name: 'GITLAB_WEBHOOK_PUBLIC_URL',
    secret: false,
    source: 'Public HTTPS URL that reaches this running integration; /gitlab/webhook is appended if omitted',
  },
  {
    name: 'GITLAB_WEBHOOK_SECRET',
    secret: true,
    source: 'Random shared secret registered on the GitLab hook and checked by the integration',
  },
];

const args = parseArgs();
const id = runId('gitlab-live');
const timeoutMs = Number(args.get('timeout-ms') ?? process.env.PLUGFORGE_LIVE_TIMEOUT_MS ?? 180_000);
const healthTimeoutMs = Number(args.get('health-timeout-ms') ?? process.env.PLUGFORGE_HEALTH_TIMEOUT_MS ?? 5_000);
let server = null;

try {
  const env = requireGitLabLiveEnv();
  const webhookPublicUrl = normalizeGitLabWebhookUrl(env.GITLAB_WEBHOOK_PUBLIC_URL);
  assert(webhookPublicUrl.startsWith('https://'), 'GITLAB_WEBHOOK_PUBLIC_URL must be an HTTPS URL that reaches this integration server');

  await ensureSdkBuild();
  const { ShipClient } = await importBuiltSdk();
  const { createGitLabIntegrationServer } = await import('../integrations/gitlab/src/index.mjs');

  const apiBaseUrl = normalizeGitLabApiBaseUrl(process.env.GITLAB_API_URL ?? 'https://gitlab.com/api/v4');
  const projectPath = encodeURIComponent(env.GITLAB_PROJECT_ID);
  const localPort = Number(args.get('port') ?? process.env.GITLAB_INTEGRATION_PORT ?? 8081);
  const observedWebhooks = [];
  server = createGitLabIntegrationServer({
    env: {
      GITLAB_WEBHOOK_SECRET: env.GITLAB_WEBHOOK_SECRET,
      SHIP_API_URL: env.SHIP_API_URL,
      SHIP_ACCESS_TOKEN: env.SHIP_ACCESS_TOKEN,
    },
    webhookSink: (event) => observedWebhooks.push(event),
  });

  await listen(server, localPort);
  const localHealthUrl = `http://127.0.0.1:${localPort}/health`;
  const publicHealthUrl = absoluteUrl(new URL(webhookPublicUrl).origin, '/health');
  console.error(`[1/7] Local GitLab receiver listening: ${localHealthUrl}`);
  await assertHttpReachable(localHealthUrl, 'Local GitLab receiver health', { timeoutMs: healthTimeoutMs });
  console.error(`[2/7] Public GitLab webhook target health: ${publicHealthUrl}`);
  await assertHttpReachable(publicHealthUrl, 'Public GitLab webhook target health', { timeoutMs: healthTimeoutMs });

  const client = new ShipClient({ baseUrl: env.SHIP_API_URL, token: env.SHIP_ACCESS_TOKEN });
  console.error('[3/7] Creating Ship proof issue');
  const issue = await client.issues.create({ title: `PlugForge live GitLab ${id}` });

  let hook = null;
  let mergeRequest = null;
  const branch = `plugforge-live-${id}`;
  const filePath = `.plugforge-live-proof/${id}.txt`;

  try {
    console.error('[4/7] Reading GitLab project and installing project webhook');
    const project = await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'GET', `/projects/${projectPath}`);
    hook = await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'POST', `/projects/${projectPath}/hooks`, {
      url: webhookPublicUrl,
      token: env.GITLAB_WEBHOOK_SECRET,
      merge_requests_events: true,
      push_events: false,
      enable_ssl_verification: true,
    });
    console.error(`[5/7] Creating proof branch, file, and merge request in ${project.web_url}`);
    await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'POST', `/projects/${projectPath}/repository/branches`, {
      branch,
      ref: project.default_branch,
    });
    await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'POST', `/projects/${projectPath}/repository/files/${encodeURIComponent(filePath)}`, {
      branch,
      content: `PlugForge live GitLab proof ${id}\nShip issue: ${issue.id}\n`,
      commit_message: `PlugForge live proof ${id}`,
    });
    mergeRequest = await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'POST', `/projects/${projectPath}/merge_requests`, {
      source_branch: branch,
      target_branch: project.default_branch,
      title: `PlugForge live proof ${id}`,
      description: `Links Ship issue ship:issue:${issue.id}`,
      remove_source_branch: true,
    });

    console.error(`[6/7] Waiting for Ship issue ${issue.id} to receive GitLab external link`);
    const link = await waitFor(async () => {
      const fetched = await client.issues.get(issue.id);
      return fetched.external_links?.find((candidate) => (
        candidate.provider === 'gitlab' &&
        candidate.kind === 'merge_request' &&
        candidate.url === mergeRequest.web_url
      )) ?? null;
    }, 'Ship issue GitLab external link created by real project webhook', timeoutMs, 2000);

    console.error(`[7/7] Waiting for local receiver to observe GitLab MR webhook !${mergeRequest.iid}`);
    const observedWebhook = await waitFor(
      () => observedWebhooks.find((event) => event.merge_request_iid === mergeRequest.iid && event.linked >= 1),
      'local GitLab integration observed live MR webhook',
      timeoutMs,
      1000
    );

    const evidence = {
      flow: 'gitlab',
      proof_class: 'live',
      status: 'passed',
      run_id: id,
      generated_at: new Date().toISOString(),
      api_url: env.SHIP_API_URL,
      project_url: project.web_url,
      webhook: {
        live: true,
        projectUrl: project.web_url,
        hook_id: hook.id,
        target_url: webhookPublicUrl,
      },
      observed_webhook: {
        object_kind: observedWebhook.object_kind,
        linked: observedWebhook.linked,
        merge_request_iid: observedWebhook.merge_request_iid,
        project_url: observedWebhook.project_url,
      },
      merge_request: {
        id: mergeRequest.id,
        iid: mergeRequest.iid,
        url: mergeRequest.web_url,
        title: mergeRequest.title,
        source_branch: mergeRequest.source_branch,
        target_branch: mergeRequest.target_branch,
      },
      issue: {
        id: issue.id,
        title: issue.title,
      },
      external_link: {
        provider: link.provider,
        external_id: link.external_id,
        kind: link.kind,
        url: link.url,
        title: truncate(link.title),
        status: link.status,
      },
    };

    const output = await writeLiveEvidence('gitlab', evidence, args.get('output'));
    console.log(JSON.stringify({ ok: true, evidence: output }, null, 2));
  } finally {
    if (mergeRequest && process.env.GITLAB_KEEP_MR !== '1') {
      await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'PUT', `/projects/${projectPath}/merge_requests/${mergeRequest.iid}`, {
        state_event: 'close',
      }).catch(() => {});
    }
    if (process.env.GITLAB_KEEP_BRANCH !== '1') {
      await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'DELETE', `/projects/${projectPath}/repository/branches/${encodeURIComponent(branch)}`).catch(() => {});
    }
    if (hook && process.env.GITLAB_KEEP_HOOK !== '1') {
      await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'DELETE', `/projects/${projectPath}/hooks/${hook.id}`).catch(() => {});
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (server) await closeServer(server).catch(() => {});
}

function requireGitLabLiveEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter(({ name }) => !env[name]);
  if (missing.length > 0) {
    throw new Error(formatMissingGitLabEnv(missing));
  }
  return Object.fromEntries(REQUIRED_ENV.map(({ name }) => [name, env[name]]));
}

function formatMissingGitLabEnv(missing) {
  const required = REQUIRED_ENV
    .map(({ name, secret, source }) => `  ${name.padEnd(28)} ${secret ? 'secret' : 'not secret'}  ${source}`)
    .join('\n');
  const missingNames = missing.map(({ name }) => `  - ${name}`).join('\n');
  return `Missing env for GitLab live proof:

Missing:
${missingNames}

Required:
${required}

Optional:
  GITLAB_API_URL                Defaults to https://gitlab.com/api/v4
  GITLAB_INTEGRATION_PORT       Defaults to 8081 for the local integration server
  PLUGFORGE_LIVE_TIMEOUT_MS     Defaults to 180000
  GITLAB_KEEP_MR=1              Keep the proof merge request open
  GITLAB_KEEP_BRANCH=1          Keep the proof branch
  GITLAB_KEEP_HOOK=1            Keep the GitLab project hook

Nothing was run. No evidence was written.`;
}

async function gitlabJson(baseUrl, token, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'private-token': token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return {};
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`GitLab ${method} ${pathname} failed (${response.status}): ${truncate(JSON.stringify(payload), 500)}`);
  }
  return payload;
}

function normalizeGitLabWebhookUrl(value) {
  const url = new URL(value);
  if (url.pathname.endsWith('/gitlab/webhook')) return url.toString();
  return absoluteUrl(url.origin, '/gitlab/webhook');
}

function normalizeGitLabApiBaseUrl(value) {
  const url = new URL(value);
  if (!isRealExternalHttpsHost(url)) {
    throw new Error('GITLAB_API_URL must be an HTTPS, non-local, non-test GitLab API origin');
  }
  return url.toString().replace(/\/$/, '');
}

function isRealExternalHttpsHost(url) {
  const hostname = url.hostname.toLowerCase();
  const knownGitLabHost = hostname === 'gitlab.com' ||
    hostname.endsWith('.gitlab.com') ||
    hostname.includes('gitlab') ||
    hostname === 'labs.gauntletai.com' ||
    process.env.PLUGFORGE_ALLOW_CUSTOM_GITLAB_API_HOST === '1';
  return knownGitLabHost && isRealExternalHttpsUrl(url.toString());
}
