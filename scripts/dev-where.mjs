#!/usr/bin/env node
// Reports where local Ship Shape services are actually reachable.
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portsFile = path.join(repoRoot, '.ports');

const ports = readPortsFile();
const apiPorts = uniqueNumbers([process.env.PORT, ports.API, ...range(3000, 3020), ...range(4000, 4020)]);
const webPorts = uniqueNumbers([process.env.VITE_PORT, ports.WEB, ...range(5173, 5193), ...range(4173, 4193), ...range(3000, 3020), ...range(4000, 4020)]);
const postgresPorts = uniqueNumbers([databaseUrlPort(readDatabaseUrl()), dockerPostgresPort(), 5432, 5433]);

console.log('Ship Shape local service map');
await reportHttp('API', apiPorts, '/health');
await reportHttp('Web', webPorts, '/');
await reportPostgres(postgresPorts);

function readPortsFile() {
  if (!existsSync(portsFile)) return {};
  const entries = {};
  for (const line of readFileSync(portsFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.+)$/.exec(line.trim());
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

async function reportHttp(label, candidates, pathName) {
  const matches = [];
  for (const port of candidates) {
    const url = `http://localhost:${port}${pathName}`;
    const result = await probeHttp(url);
    if (result.ok) matches.push({ port, url: `http://localhost:${port}`, status: result.status });
  }
  if (matches.length === 0) {
    console.log(`${label}: not reachable on ${candidateText(candidates)}`);
    return;
  }
  for (const match of matches) {
    console.log(`${label}: ${match.url} (${match.status})`);
  }
}

async function reportPostgres(candidates) {
  const matches = [];
  for (const port of candidates) {
    if (postgresReady(port)) matches.push(port);
  }
  if (matches.length === 0) {
    console.log(`Postgres: not reachable on ${candidateText(candidates)}`);
    return;
  }
  for (const port of matches) {
    console.log(`Postgres: localhost:${port}`);
  }
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

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(repoRoot, 'api/.env.local');
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

function range(start, endInclusive) {
  const values = [];
  for (let port = start; port <= endInclusive; port += 1) values.push(port);
  return values;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

function candidateText(values) {
  if (values.length <= 8) return values.join(', ');
  return `${values.slice(0, 4).join(', ')}, ... ${values.at(-1)}`;
}
