#!/usr/bin/env node
// Gated TTFE flake probe runs the timing wrapper repeatedly and fails on any flaky run.
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso, parseArgs, parseTrailingJson, percentile, requireNumber, rootDir, runProcess, writeJsonReport } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const runs = Number.parseInt(String(args.runs ?? args.n ?? '20'), 10);
if (!Number.isInteger(runs) || runs < 1) {
  console.error('Usage: node scripts/plugforge-metrics/ttfe-flake-loop.mjs --runs <positive integer>');
  process.exit(2);
}
const maxP95Ms = requireNumber(args['max-p95-ms'], 60_000);

const startedAt = Date.now();
const wrapperPath = fileURLToPath(new URL('./ttfe-timing.mjs', import.meta.url));
const results = [];

for (let index = 1; index <= runs; index++) {
  const result = await runProcess(process.execPath, [wrapperPath, '--no-write'], {
    cwd: rootDir,
    forwardOutput: Boolean(args.verbose),
  });
  const report = parseTrailingJson(result.stdout);
  results.push({
    run: index,
    ok: result.exitCode === 0 && report?.ok === true,
    exitCode: result.exitCode,
    durationMs: report?.durationMs ?? result.durationMs,
    timings: report?.drill?.timings ?? [],
    stderrTail: result.stderr.slice(-2000),
    stdoutTail: report ? null : result.stdout.slice(-2000),
  });
}

const successfulRuns = results.filter(run => run.ok);
const totalTimings = successfulRuns
  .map(run => run.timings.find(timing => timing.name === 'total' || timing.stage === 'total')?.ms)
  .filter(value => typeof value === 'number');
const totalP95 = percentile(totalTimings, 95);
const ok = successfulRuns.length === runs && typeof totalP95 === 'number' && totalP95 < maxP95Ms;
const report = {
  metric: 'ttfe-flake-loop',
  status: ok ? 'measured' : 'failed',
  ok,
  generatedAt: nowIso(),
  durationMs: Date.now() - startedAt,
  targets: {
    maxP95Ms,
    maxFailedRuns: 0,
  },
  requestedRuns: runs,
  passedRuns: successfulRuns.length,
  failedRuns: runs - successfulRuns.length,
  passRate: successfulRuns.length / runs,
  totalTimingMs: {
    min: totalTimings.length ? Math.min(...totalTimings) : null,
    max: totalTimings.length ? Math.max(...totalTimings) : null,
    p50: percentile(totalTimings, 50),
    p95: totalP95,
  },
  runs: results,
};

const outputPath = await writeJsonReport('ttfe-flake-loop.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
