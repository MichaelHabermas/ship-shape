#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, statSync, renameSync } from 'node:fs';
import { resolve, normalize, relative, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { enrichFindingForDisplay } from '../core/finding-display.mjs';
import { markdownToHtml } from '../core/markdown-lite.mjs';
import {
  loadSecurityFindings,
  saveSecurityFindings,
  setFindingStatus,
  getFindingById,
  GENERATED_LEDGER_PATH,
} from '../core/security-findings-store.mjs';
import { renderSecurityFindingsLedger } from '../core/security-findings-render.mjs';
import { repoRoot, evidenceDir } from '../core/paths.mjs';
import { RUN_MODES, runConsoleJob, streamSpawn } from './job-runner.mjs';
import { attachJobStream, formatSseMessage } from './job-stream.mjs';
import { createJobQueue } from './job-queue.mjs';
import { loadSecurityConsolePayload } from './payload-api.mjs';
import { safeNarrativePath } from './narrative-paths.mjs';

const dashboardPath = resolve(repoRoot, 'my-docs/reviewer-dashboard.html');
const renderDashboardScript = resolve(repoRoot, 'scripts/submission/render-dashboard.mjs');
const consoleUiDist = resolve(repoRoot, 'packages/shipshape-security/console-ui/dist');
const defaultPort = Number(process.env.SHIP_SECURITY_CONSOLE_PORT || 9876);
const host = process.env.SHIP_SECURITY_CONSOLE_HOST || '127.0.0.1';
const allowRemote = process.env.SHIP_SECURITY_CONSOLE_ALLOW_REMOTE === '1';

const { jobs, getRunningJobId, tryStart } = createJobQueue();
const MAX_BODY_BYTES = 2_000_000;

/**
 * @typedef {object} JobState
 * @property {Set<(msg: object) => void>} listeners
 * @property {boolean} done
 * @property {string[]} logs
 * @property {object | null} result
 * @property {number} cleanupMs
 */

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function pushJob(jobId, message) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (message.type === 'log' && message.line) job.logs.push(message.line);
  for (const listener of job.listeners) listener(message);
}

function finishJob(jobId, payload) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.done = true;
  job.result = payload;
  pushJob(jobId, { type: 'done', ...payload });
}

async function runJob(jobId, mode, options) {
  const log = (line) => pushJob(jobId, { type: 'log', line: String(line) });
  try {
    const result = await runConsoleJob(mode, { cat8Perimeter: options.cat8Perimeter, cwd: repoRoot }, log);
    finishJob(jobId, result);
  } catch (error) {
    log(error?.message || String(error));
    finishJob(jobId, {
      ok: false,
      title: mode === 'ci' ? 'CI gate' : mode === 'check' ? 'Findings check' : 'Security probe',
      exitCode: 1,
    });
  }
}

function startJob(mode, options) {
  const cleanupMs = mode === 'ci' ? 2 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const kind = mode === 'ci' ? 'ci' : mode === 'check' ? 'check' : 'run';
  return tryStart(kind, {
    cleanupMs,
    run: (jobId) => runJob(jobId, mode, options),
  });
}

function safeEvidencePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.replace(/^\/evidence\//, ''));
  const full = normalize(resolve(evidenceDir, decoded));
  const rel = relative(evidenceDir, full);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  if (!existsSync(full)) return null;
  try {
    if (!statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  return full;
}

function injectConsoleApiBase(html, port) {
  const base = `http://${host}:${port}`;
  const id = 'ship-security-payload';
  const open = html.indexOf(`id="${id}"`);
  if (open === -1) return html;
  const close = html.indexOf('</script>', open);
  if (close === -1) return html;
  const raw = html.slice(open, close);
  const gt = raw.indexOf('>');
  if (gt === -1) return html;
  try {
    const payload = JSON.parse(raw.slice(gt + 1));
    payload.consoleApiBase = base;
    const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
    return html.slice(0, open + gt + 1) + serialized + html.slice(close);
  } catch {
    return html.replace(/"consoleApiBase"\s*:\s*""/, `"consoleApiBase":"${base}"`);
  }
}

function serveFile(res, filePath, contentType) {
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, { 'content-type': contentType });
    res.end(body);
  } catch (error) {
    json(res, 500, { error: error.message || String(error) });
  }
}

function contentTypeForPath(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const types = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    md: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    map: 'application/json',
  };
  return types[ext] || 'application/octet-stream';
}

function serveConsoleUiAsset(res, urlPath) {
  if (!existsSync(consoleUiDist)) {
    res.writeHead(404);
    return res.end();
  }
  const rel = urlPath.replace(/^\/console\//, '');
  const full = normalize(resolve(consoleUiDist, rel));
  const relPath = relative(consoleUiDist, full);
  if (relPath.startsWith('..') || relPath.includes(`..${sep}`)) {
    res.writeHead(403);
    return res.end();
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  return serveFile(res, full, contentTypeForPath(full));
}

async function regenerateDashboard(jobId) {
  const log = (line) => pushJob(jobId, { type: 'log', line: String(line) });
  log('Regenerating reviewer dashboard…');
  const { exitCode } = await streamSpawn(process.execPath, [renderDashboardScript], { cwd: repoRoot }, log);
  return exitCode === 0;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      service: 'shipshape-security-console',
      runningJobId: getRunningJobId(),
      consoleUiBuilt: existsSync(resolve(consoleUiDist, 'index.html')),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/payload') {
    try {
      const payload = await loadSecurityConsolePayload();
      payload.consoleApiBase = `http://${host}:${defaultPort}`;
      return json(res, 200, payload);
    } catch (error) {
      return json(res, 500, { error: error.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/dashboard/regenerate') {
    const started = tryStart('regen', {
      cleanupMs: 60 * 60 * 1000,
      run: async (jobId) => {
        try {
          const ok = await regenerateDashboard(jobId);
          finishJob(jobId, { ok, title: 'Dashboard regenerate', exitCode: ok ? 0 : 1 });
        } catch (error) {
          pushJob(jobId, { type: 'log', line: error?.message || String(error) });
          finishJob(jobId, { ok: false, title: 'Dashboard regenerate', exitCode: 1 });
        }
      },
    });
    if (started.conflict) {
      return json(res, 409, { error: 'A job is already running', jobId: started.jobId });
    }
    return json(res, 202, { jobId: started.jobId });
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    try {
      const body = await readBody(req);
      const mode = body.mode || 'run';
      if (!RUN_MODES.has(mode)) {
        return json(res, 400, { error: `Invalid mode: ${mode}. Use run, check, or ci.` });
      }
      const started = startJob(mode, { cat8Perimeter: Boolean(body.cat8Perimeter) });
      if (started.conflict) {
        return json(res, 409, {
          error: 'A security console job is already running',
          jobId: started.jobId,
        });
      }
      return json(res, 202, { jobId: started.jobId });
    } catch (error) {
      return json(res, 400, { error: error.message || String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/run/') && url.pathname.endsWith('/events')) {
    const parts = url.pathname.split('/');
    const jobId = parts[3];
    const job = jobs.get(jobId);
    if (!job) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (msg) => res.write(formatSseMessage(msg));
    const detach = attachJobStream(job, send);
    req.on('close', detach);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/findings/') && url.pathname.endsWith('/narrative')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const store = loadSecurityFindings();
    const finding = getFindingById(store, id);
    if (!finding) return json(res, 404, { error: `Finding not found: ${id}` });
    const fullPath = safeNarrativePath(finding.narrativePath);
    if (!fullPath) return json(res, 404, { error: 'No narrative file linked' });
    const markdown = readFileSync(fullPath, 'utf8');
    return json(res, 200, {
      id,
      path: finding.narrativePath,
      markdown,
      html: markdownToHtml(markdown),
    });
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/findings/') && url.pathname.endsWith('/narrative')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    try {
      const body = await readBody(req);
      const markdown = String(body.markdown ?? '');
      const store = loadSecurityFindings();
      const finding = getFindingById(store, id);
      if (!finding) return json(res, 404, { error: `Finding not found: ${id}` });
      const fullPath = safeNarrativePath(finding.narrativePath);
      if (!fullPath) return json(res, 404, { error: 'No narrative file linked' });
      const tempPath = `${fullPath}.tmp`;
      writeFileSync(tempPath, markdown, 'utf8');
      renameSync(tempPath, fullPath);
      return json(res, 200, {
        id,
        path: finding.narrativePath,
        markdown,
        html: markdownToHtml(markdown),
      });
    } catch (error) {
      return json(res, 400, { error: error.message || String(error) });
    }
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/findings/') && url.pathname.endsWith('/status')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    try {
      const body = await readBody(req);
      const status = body.status;
      const valid = new Set(['open', 'fixed', 'deferred', 'accepted_risk', 'in-progress']);
      if (!valid.has(status)) return json(res, 400, { error: 'Invalid status' });
      const store = loadSecurityFindings();
      if (!getFindingById(store, id)) return json(res, 404, { error: `Finding not found: ${id}` });
      setFindingStatus(store, id, status, body.note || 'set via security console');
      const saved = saveSecurityFindings(store);
      writeFileSync(GENERATED_LEDGER_PATH, renderSecurityFindingsLedger(saved));
      const finding = getFindingById(saved, id);
      const enriched = enrichFindingForDisplay(finding);
      return json(res, 200, {
        ok: true,
        id,
        status,
        activeLabel: enriched.activeLabel,
        active: enriched.active,
      });
    } catch (error) {
      return json(res, 400, { error: error.message || String(error) });
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/evidence/')) {
    const filePath = safeEvidencePath(url.pathname);
    if (!filePath) {
      res.writeHead(404);
      return res.end();
    }
    return serveFile(res, filePath, contentTypeForPath(filePath));
  }

  if (req.method === 'GET' && url.pathname.startsWith('/console/')) {
    return serveConsoleUiAsset(res, url.pathname);
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    if (!existsSync(dashboardPath)) {
      return json(res, 500, {
        error: `Missing ${dashboardPath}. Run pnpm submission:render-dashboard first.`,
      });
    }
    let html = readFileSync(dashboardPath, 'utf8');
    html = injectConsoleApiBase(html, defaultPort);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, jobId) => {
  const job = jobs.get(jobId);
  if (!job) {
    ws.close(4404, 'Job not found');
    return;
  }
  const send = (msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const detach = attachJobStream(job, send);
  ws.on('close', detach);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/api\/run\/([^/]+)\/ws$/);
  if (!match) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, match[1]);
  });
});

if (host !== '127.0.0.1' && host !== 'localhost' && !allowRemote) {
  console.error(
    `Refusing to bind to ${host}. Set SHIP_SECURITY_CONSOLE_ALLOW_REMOTE=1 only if you understand the risk.`
  );
  process.exit(1);
}

server.listen(defaultPort, host, () => {
  const url = `http://${host}:${defaultPort}/`;
  console.log(`ShipShape Security Console: ${url}`);
  console.log('Security Console tab: Run probe, Findings check, or CI gate (local preflight).');
  console.log('Grader canonical path: pnpm security:probe:ci');
  if (existsSync(resolve(consoleUiDist, 'index.html'))) {
    console.log('Vite console-ui assets available at /console/');
  }
});
