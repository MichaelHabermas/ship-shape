// Shared PlugForge metric helpers centralize subprocess execution and JSON evidence writing.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const evidenceDir = path.join(rootDir, 'my-docs', 'evidence', 'plugforge-metrics');

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._ ||= [];
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index++;
  }
  return args;
}

export function nowIso() {
  return new Date().toISOString();
}

export async function writeJsonReport(defaultName, report, args = {}) {
  const outputPath = args.output
    ? path.resolve(rootDir, args.output)
    : path.join(args['output-dir'] ? path.resolve(rootDir, args['output-dir']) : evidenceDir, defaultName);

  if (args['no-write']) {
    return null;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return outputPath;
}

export function runProcess(command, args, options = {}) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const timeoutMs = requireNumber(options.timeoutMs, 15 * 60_000);
    let timedOut = false;
    let forceKillTimer = null;
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeoutTimer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        forceKillTimer.unref?.();
      }, timeoutMs)
      : null;
    timeoutTimer?.unref?.();
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (options.forwardOutput) process.stdout.write(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (options.forwardOutput) process.stderr.write(chunk);
    });
    child.on('error', error => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({
        command,
        args,
        exitCode: timedOut ? 124 : null,
        signal: null,
        stdout,
        stderr,
        error: timedOut ? `Process timed out after ${timeoutMs}ms` : error instanceof Error ? error.message : String(error),
        timedOut,
        timeoutMs,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', (exitCode, signal) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({
        command,
        args,
        exitCode: timedOut ? 124 : exitCode,
        signal,
        stdout,
        stderr,
        error: timedOut ? `Process timed out after ${timeoutMs}ms` : null,
        timedOut,
        timeoutMs,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export function parseTrailingJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (let index = trimmed.lastIndexOf('{'); index >= 0; index = trimmed.lastIndexOf('{', index - 1)) {
    try {
      return JSON.parse(trimmed.slice(index));
    } catch {}
  }
  return null;
}

export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

export function requireNumber(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function resolveMetricDatabaseUrl(name = 'ship_test_audit') {
  return process.env.PLUGFORGE_METRICS_DATABASE_URL
    ?? execFileSync(path.join(rootDir, 'scripts', 'resolve-database-url.sh'), [name], {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();
}

export function relativeMetricPath(outputPath) {
  return outputPath ? path.relative(rootDir, outputPath) : null;
}
