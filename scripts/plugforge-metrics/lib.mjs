// Shared PlugForge metric helpers centralize subprocess execution and JSON evidence writing.
import { execFileSync } from 'node:child_process';
import { parseArgsFlat } from '../lib/parse-args.mjs';
import { runCommand } from '../lib/run-command.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const evidenceDir = path.join(rootDir, 'my-docs', 'evidence', 'plugforge-metrics');

export function parseArgs(argv) {
  return parseArgsFlat(argv);
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
  const timeoutMs = requireNumber(options.timeoutMs, 15 * 60_000);
  return runCommand(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    timeoutMs,
    forwardOutput: options.forwardOutput,
    throwOnFail: false,
    tailChars: null,
  }).then((result) => ({
    command: result.command,
    args: result.args,
    exitCode: result.code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    timedOut: result.timedOut,
    timeoutMs: result.timeoutMs,
    durationMs: result.durationMs,
  }));
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
