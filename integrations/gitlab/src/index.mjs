// GitLab reference integration maps merge request events to Ship issue external links via @ship/sdk.
import http from 'node:http';
import { ShipClient } from '@ship/sdk';

const JSON_HEADERS = { 'content-type': 'application/json' };
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export function createGitLabIntegrationServer(options = {}) {
  const env = options.env ?? process.env;
  const config = {
    shipApiUrl: env.SHIP_API_URL,
    shipAccessToken: env.SHIP_ACCESS_TOKEN,
    gitlabWebhookSecret: env.GITLAB_WEBHOOK_SECRET,
  };
  const shipClient = options.shipClient ?? new ShipClient({
    baseUrl: config.shipApiUrl ?? '',
    token: config.shipAccessToken,
    fetch: options.fetch,
  });

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/gitlab/webhook') {
        await handleGitLabWebhook(req, res, { config, shipClient });
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'internal_error' });
    }
  });
}

export async function startGitLabIntegrationServer(options = {}) {
  const server = createGitLabIntegrationServer(options);
  const port = Number(options.env?.PORT ?? process.env.PORT ?? 8081);
  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}

async function handleGitLabWebhook(req, res, deps) {
  requireConfig(deps.config.gitlabWebhookSecret, 'GITLAB_WEBHOOK_SECRET');
  const token = headerValue(req.headers, 'x-gitlab-token');
  if (token !== deps.config.gitlabWebhookSecret) {
    sendJson(res, 401, { ok: false, error: 'invalid_gitlab_token' });
    return;
  }

  const event = JSON.parse(await readRequestBody(req));
  if (event.object_kind !== 'merge_request') {
    sendJson(res, 202, { ok: true, linked: 0, ignored: true });
    return;
  }

  const mergeRequest = event.object_attributes ?? {};
  const issueIds = extractShipIssueIds(event);
  const linkInput = gitlabExternalLinkInput(event);
  for (const issueId of issueIds) {
    await deps.shipClient.issues.upsertExternalLink(issueId, linkInput);
  }
  sendJson(res, 202, {
    ok: true,
    linked: issueIds.length,
    merge_request_iid: mergeRequest.iid ?? null,
  });
}

export function extractShipIssueIds(event) {
  const mergeRequest = event.object_attributes ?? {};
  const strings = [
    mergeRequest.title,
    mergeRequest.description,
    mergeRequest.source_branch,
    mergeRequest.target_branch,
    mergeRequest.url,
    event.project?.web_url,
  ].filter((value) => typeof value === 'string');
  const ids = new Set();
  const markerPattern = new RegExp(`ship:issue:(${UUID_PATTERN})`, 'gi');
  const urlPattern = new RegExp(`(?:/api/v1/issues/|/issues/|ship://issues/)(${UUID_PATTERN})`, 'gi');

  for (const value of strings) {
    for (const match of value.matchAll(markerPattern)) ids.add(match[1].toLowerCase());
    for (const match of value.matchAll(urlPattern)) ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

export function gitlabExternalLinkInput(event) {
  const mergeRequest = event.object_attributes ?? {};
  const project = event.project ?? {};
  const projectKey = project.path_with_namespace ?? project.id ?? 'gitlab-project';
  const mrKey = mergeRequest.iid ?? mergeRequest.id ?? mergeRequest.url ?? 'merge-request';
  return {
    provider: 'gitlab',
    external_id: `${projectKey}!${mrKey}`,
    kind: 'merge_request',
    url: mergeRequest.url ?? project.web_url ?? '',
    title: mergeRequest.title ?? `GitLab merge request !${mrKey}`,
    ...(mergeRequest.state ? { status: mergeRequest.state } : {}),
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function requireConfig(value, name) {
  if (!value) throw new Error(`${name}_REQUIRED`);
}

function headerValue(headers, name) {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startGitLabIntegrationServer().then((server) => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : process.env.PORT;
    console.log(`Ship GitLab integration listening on ${port}`);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
