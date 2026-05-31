#!/usr/bin/env node
// Reports where local Ship Shape services are actually reachable.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shouldOpen = process.argv.includes('--open');
const sessions = readKnownSessions();
const sessionApiPorts = sessions.map((session) => session.apiPort);
const sessionWebPorts = sessions.map((session) => session.webPort);
const apiPorts = uniqueNumbers([process.env.PORT, ...sessionApiPorts, ...range(3000, 3020), ...range(4000, 4020)]);
const webPorts = uniqueNumbers([
  process.env.VITE_PORT,
  ...sessionWebPorts,
  ...range(5173, 5193),
  ...range(4173, 4193),
  ...range(3000, 3020),
  ...range(4000, 4020),
]);
const postgresPorts = uniqueNumbers([
  ...sessions.map((session) => databaseUrlPort(session.databaseUrl)),
  databaseUrlPort(readDatabaseUrl(repoRoot)),
  dockerPostgresPort(),
  5432,
  5433,
]);

console.log('Ship Shape local service map');

const sessionReports = [];
for (const session of sessions) {
  sessionReports.push(await reportSession(session));
}

if (sessionReports.length > 0) {
  for (const report of sessionReports) {
    printSession(report);
  }
} else {
  console.log('No session files found.');
}

const knownApiPorts = new Set(sessions.map((session) => session.apiPort));
const knownWebPorts = new Set(sessions.map((session) => session.webPort));
const strayApi = (await findHttp('API', apiPorts, '/health')).filter((match) => !knownApiPorts.has(match.port));
const strayWeb = (await findHttp('Web', webPorts, '/')).filter((match) => !knownWebPorts.has(match.port));
const postgres = postgresPorts.filter((port) => postgresReady(port));

if (strayApi.length > 0 || strayWeb.length > 0) {
  console.log('');
  console.log('Other reachable services');
  for (const match of strayApi) console.log(`  API: ${match.url} (${match.status})`);
  for (const match of strayWeb) console.log(`  Web: ${match.url} (${match.status})`);
}

if (postgres.length > 0) {
  console.log('');
  for (const port of postgres) console.log(`Postgres: localhost:${port}`);
} else {
  console.log('');
  console.log(`Postgres: not reachable on ${candidateText(postgresPorts)}`);
}

if (shouldOpen) {
  const target = pickOpenTarget(sessionReports, strayWeb);
  if (!target) {
    console.error('No reachable web server found to open.');
    process.exit(1);
  }
  spawnSync('open', [target], { stdio: 'inherit' });
}

function readKnownSessions() {
  const roots = uniqueStrings([repoRoot, ...siblingRepoRoots(repoRoot)]);
  const sessions = [];

  for (const root of roots) {
    const session = readSession(root) ?? readPortsSession(root);
    if (session) sessions.push(session);
  }

  return sessions.sort((a, b) => {
    if (a.rootDir === repoRoot) return -1;
    if (b.rootDir === repoRoot) return 1;
    return a.rootDir.localeCompare(b.rootDir);
  });
}

function siblingRepoRoots(root) {
  const parent = path.dirname(root);
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name))
      .filter((candidate) => candidate !== root)
      .filter((candidate) => existsSync(path.join(candidate, 'package.json')))
      .filter((candidate) => existsSync(path.join(candidate, '.ports')) || existsSync(path.join(candidate, '.dev/session.json')));
  } catch {
    return [];
  }
}

function readSession(root) {
  const file = path.join(root, '.dev/session.json');
  if (!existsSync(file)) return null;

  try {
    const session = JSON.parse(readFileSync(file, 'utf8'));
    return normalizeSession(root, {
      source: file,
      rootDir: session.rootDir,
      worktree: session.worktree,
      pid: session.pid,
      apiPort: session.apiPort,
      webPort: session.webPort,
      databaseUrl: session.databaseUrl,
      startedAt: session.startedAt,
    });
  } catch {
    return null;
  }
}

function readPortsSession(root) {
  const file = path.join(root, '.ports');
  if (!existsSync(file)) return null;

  const entries = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (match) entries[match[1]] = match[2];
  }

  return normalizeSession(root, {
    source: file,
    rootDir: entries.ROOT || root,
    worktree: entries.WORKTREE || path.basename(root),
    pid: entries.PID,
    apiPort: entries.API,
    webPort: entries.WEB,
    databaseUrl: readDatabaseUrl(root),
    startedAt: entries.STARTED,
  });
}

function normalizeSession(root, session) {
  const apiPort = Number(session.apiPort);
  const webPort = Number(session.webPort);
  if (!Number.isInteger(apiPort) || !Number.isInteger(webPort)) return null;

  return {
    source: session.source,
    rootDir: session.rootDir || root,
    worktree: session.worktree || path.basename(root),
    pid: Number(session.pid) || null,
    apiPort,
    webPort,
    apiUrl: `http://localhost:${apiPort}`,
    webUrl: `http://localhost:${webPort}`,
    databaseUrl: session.databaseUrl || readDatabaseUrl(root),
    startedAt: session.startedAt || '',
    isCurrent: path.resolve(root) === repoRoot,
  };
}

async function reportSession(session) {
  const [api, web] = await Promise.all([
    probeHttp(`${session.apiUrl}/health`),
    probeHttp(`${session.webUrl}/`),
  ]);

  return {
    ...session,
    api,
    web,
    pidLive: session.pid ? isLivePid(session.pid) : null,
  };
}

function printSession(report) {
  const label = report.isCurrent ? `${report.worktree} (current)` : report.worktree;
  const live = report.api.ok || report.web.ok;
  const stale = !live && report.pidLive === false;

  console.log('');
  console.log(`${label}${stale ? ' [stale]' : ''}`);
  console.log(`  Web: ${formatHttp(report.webUrl, report.web)}`);
  console.log(`  API: ${formatHttp(report.apiUrl, report.api)}`);
  console.log(`  DB:  ${formatDatabase(report.databaseUrl)}`);
  if (report.pid) console.log(`  PID: ${report.pid}${report.pidLive === false ? ' (not running)' : ''}`);
  if (report.startedAt) console.log(`  Started: ${report.startedAt}`);
}

function formatHttp(url, result) {
  if (result.ok) return `${url} (${result.status})`;
  return `${url} (not reachable)`;
}

function formatDatabase(value) {
  if (!value) return 'unknown';

  try {
    const parsed = new URL(value);
    return `${parsed.pathname.replace(/^\//, '') || '<default>'} on ${parsed.hostname}:${parsed.port || 5432}`;
  } catch {
    return 'configured';
  }
}

async function findHttp(_label, candidates, pathName) {
  const matches = [];
  for (const port of candidates) {
    const url = `http://localhost:${port}${pathName}`;
    const result = await probeHttp(url);
    if (result.ok) matches.push({ port, url: `http://localhost:${port}`, status: result.status });
  }
  return matches;
}

async function probeHttp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return { ok: response.status < 400, status: response.status };
  } catch {
    const port = Number(new URL(url).port);
    return { ok: await portOpen(port), status: 'tcp-open' };
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 600 });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

function postgresReady(port) {
  const result = spawnSync('pg_isready', ['-h', 'localhost', '-p', String(port)], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

function dockerPostgresPort() {
  const direct = spawnSync('docker', ['port', 'ship-shape-postgres-1', '5432/tcp'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const match = /:(\d+)\s*$/.exec(direct.stdout.trim());
  return match ? Number(match[1]) : null;
}

function readDatabaseUrl(root) {
  if (root === repoRoot && process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(root, 'api/.env.local');
  if (!existsSync(envFile)) return '';
  const match = /^DATABASE_URL=(.+)$/m.exec(readFileSync(envFile, 'utf8'));
  return match?.[1] ?? '';
}

function databaseUrlPort(value) {
  if (!value) return null;
  try {
    return Number(new URL(value).port || 5432);
  } catch {
    return null;
  }
}

function isLivePid(pid) {
  const result = spawnSync('kill', ['-0', String(pid)], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

function pickOpenTarget(sessionReports, strayWeb) {
  const current = sessionReports.find((report) => report.isCurrent && report.web.ok);
  if (current) return current.webUrl;

  const firstKnown = sessionReports.find((report) => report.web.ok);
  if (firstKnown) return firstKnown.webUrl;

  return strayWeb[0]?.url ?? null;
}

function range(start, endInclusive) {
  const values = [];
  for (let port = start; port <= endInclusive; port += 1) values.push(port);
  return values;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function candidateText(values) {
  if (values.length <= 8) return values.join(', ');
  return `${values.slice(0, 4).join(', ')}, ... ${values.at(-1)}`;
}
