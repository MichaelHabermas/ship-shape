#!/usr/bin/env node
// Live PlugForge GitLab proof: real project webhook, real MR event, real Ship external link.
import process from 'node:process';
import {
  absoluteUrl,
  assert,
  closeServer,
  ensureSdkBuild,
  importBuiltSdk,
  listen,
  parseArgs,
  requireEnv,
  runId,
  truncate,
  waitFor,
  writeEvidence,
} from './lib/plugforge-live-drill.mjs';

const args = parseArgs();
const id = runId('gitlab-live');
const timeoutMs = Number(args.get('timeout-ms') ?? process.env.PLUGFORGE_LIVE_TIMEOUT_MS ?? 180_000);
let server = null;

try {
  const env = requireEnv([
    'SHIP_API_URL',
    'SHIP_ACCESS_TOKEN',
    'GITLAB_TOKEN',
    'GITLAB_PROJECT_ID',
    'GITLAB_WEBHOOK_PUBLIC_URL',
    'GITLAB_WEBHOOK_SECRET',
  ]);
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
  const client = new ShipClient({ baseUrl: env.SHIP_API_URL, token: env.SHIP_ACCESS_TOKEN });
  const issue = await client.issues.create({ title: `PlugForge live GitLab ${id}` });

  let hook = null;
  let mergeRequest = null;
  const branch = `plugforge-live-${id}`;
  const filePath = `.plugforge-live-proof/${id}.txt`;

  try {
    const project = await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'GET', `/projects/${projectPath}`);
    hook = await gitlabJson(apiBaseUrl, env.GITLAB_TOKEN, 'POST', `/projects/${projectPath}/hooks`, {
      url: webhookPublicUrl,
      token: env.GITLAB_WEBHOOK_SECRET,
      merge_requests_events: true,
      push_events: false,
      enable_ssl_verification: true,
    });
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

    const link = await waitFor(async () => {
      const fetched = await client.issues.get(issue.id);
      return fetched.external_links?.find((candidate) => (
        candidate.provider === 'gitlab' &&
        candidate.kind === 'merge_request' &&
        candidate.url === mergeRequest.web_url
      )) ?? null;
    }, 'Ship issue GitLab external link created by real project webhook', timeoutMs, 2000);

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

    const output = await writeEvidence('gitlab', evidence, args.get('output'));
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
  return url.protocol === 'https:' &&
    knownGitLabHost &&
    !['localhost', '127.0.0.1', '::1'].includes(hostname) &&
    !hostname.endsWith('.example.com') &&
    !hostname.endsWith('.test') &&
    !hostname.endsWith('.example') &&
    !hostname.endsWith('.invalid') &&
    hostname !== 'example.com';
}
