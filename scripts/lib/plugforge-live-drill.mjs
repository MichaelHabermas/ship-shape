// Shared helpers for PlugForge live external integration proof drills.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const evidenceDir = path.join(rootDir, 'my-docs/evidence/plugforge-integrations');
export const liveEvidenceDir = path.join(evidenceDir, 'live');

export function parseArgs(argv = process.argv.slice(2)) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const inline = arg.indexOf('=');
    if (inline !== -1) {
      args.set(arg.slice(2, inline), arg.slice(inline + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, 'true');
    }
  }
  return args;
}

export function requireEnv(names, env = process.env) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
  return Object.fromEntries(names.map((name) => [name, env[name]]));
}

export function runId(prefix) {
  return process.env.PLUGFORGE_INTEGRATION_RUN_ID ?? `${prefix}-${Date.now().toString(36)}`;
}

export async function writeEvidence(fileName, payload, outputPath) {
  const target = outputPath
    ? path.resolve(rootDir, outputPath)
    : path.join(evidenceDir, `${fileName}.json`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

export async function writeLiveEvidence(fileName, payload, outputPath) {
  return writeEvidence(
    fileName,
    payload,
    outputPath ?? path.join('my-docs/evidence/plugforge-integrations/live', `${fileName}.json`)
  );
}

export async function ensureSdkBuild() {
  await runCommand('pnpm', ['--filter', '@ship/shared', 'build'], { timeoutMs: 90_000 });
  await runCommand('pnpm', ['--filter', '@ship/sdk', 'build'], { timeoutMs: 90_000 });
}

export function importBuiltSdk() {
  return import(pathToFileURL(path.join(rootDir, 'sdk/dist/index.js')).toString());
}

export async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: options.env ?? process.env,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
  const stdout = createTailCollector();
  const stderr = createTailCollector();
  let killTimeout = null;
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    killTimeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  }, options.timeoutMs ?? 120_000);
  child.stdout?.on('data', (chunk) => stdout.push(chunk));
  child.stderr?.on('data', (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  clearTimeout(timeout);
  if (killTimeout) clearTimeout(killTimeout);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit ${code}\n${stderr.text() || stdout.text()}`);
  }
  return { stdout: stdout.text(), stderr: stderr.text() };
}

export async function waitFor(predicate, label, timeoutMs = 60_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    lastValue = value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(lastValue)}`);
}

export function listen(server, port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
}

export function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

export function isLocalUrl(value) {
  try {
    const host = new URL(value).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch {
    return false;
  }
}

export function isRealExternalHttpsUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '::1', 'example.com', 'example.org', 'example.net'].includes(hostname) &&
      !hostname.endsWith('.example.com') &&
      !hostname.endsWith('.example.org') &&
      !hostname.endsWith('.example.net') &&
      !hostname.endsWith('.test') &&
      !hostname.endsWith('.example') &&
      !hostname.endsWith('.invalid');
  } catch {
    return false;
  }
}

export function absoluteUrl(base, pathname) {
  return new URL(pathname, base.endsWith('/') ? base : `${base}/`).toString();
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function truncate(value, max = 240) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function openUrl(url) {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    await runCommand(command, args, { timeoutMs: 10_000, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {
    console.error(`Open this URL manually: ${url}`);
  }
}

function createTailCollector(maxChars = 6_000) {
  let value = '';
  return {
    push(chunk) {
      value += chunk.toString();
      if (value.length > maxChars) value = value.slice(-maxChars);
    },
    text() {
      return value;
    },
  };
}
