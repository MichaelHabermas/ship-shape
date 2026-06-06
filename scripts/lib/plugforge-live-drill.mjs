// Shared helpers for PlugForge live external integration proof drills.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freePort } from './net.mjs';
import { parseArgsMap } from './parse-args.mjs';
import { runCommand as runCommandCore } from './run-command.mjs';
import { sleep } from './process-utils.mjs';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const evidenceDir = path.join(rootDir, 'my-docs/evidence/plugforge-integrations');
export const liveEvidenceDir = path.join(evidenceDir, 'live');

export function parseArgs(argv = process.argv.slice(2)) {
  return parseArgsMap(argv);
}

export { freePort };

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
  const result = await runCommandCore(command, args, {
    ...options,
    cwd: options.cwd ?? rootDir,
    tailChars: options.tailChars ?? 6_000,
    throwOnFail: true,
  });
  return { stdout: result.stdout, stderr: result.stderr };
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

export async function probeHttpUrl(url, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: truncate(body, 500),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertHttpReachable(url, label, options = {}) {
  const result = await probeHttpUrl(url, options);
  if (result.ok) return result;
  const status = result.status ? `${result.status} ${result.statusText ?? ''}`.trim() : 'request failed';
  const detail = result.body || result.error || 'no response body';
  throw new Error(`${label} is not reachable: ${url}
Result: ${status}
Detail: ${detail}

Nothing was run. Fix the tunnel or deployed integration URL, then retry.`);
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

export function isLocalUrl(value) {
  try {
    const host = new URL(value).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch {
    return false;
  }
}

export function isHostedIntegrationUrl(value) {
  if (!isRealExternalHttpsUrl(value)) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.endsWith('.onrender.com');
  } catch {
    return false;
  }
}

/** True when a webhook/integration URL still points at an ephemeral tunnel. */
export function isTunnelUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.includes('trycloudflare.com') ||
      hostname.endsWith('.ngrok-free.app') ||
      hostname.endsWith('.ngrok.io') ||
      hostname.endsWith('.loca.lt');
  } catch {
    return false;
  }
}

export const defaultSlackIntegrationUrl = 'https://ship-shape-slack-integration.onrender.com';

export const defaultGitlabWebhookUrl = 'https://ship-shape-gitlab-integration.onrender.com/gitlab/webhook';

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

export { sleep };

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

