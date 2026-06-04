#!/usr/bin/env node
// PlugForge metrics runner executes every platform metric probe and fails on malformed or failed reports.
import path from 'node:path';
import process from 'node:process';
import {
  nowIso,
  parseArgs,
  parseTrailingJson,
  rootDir,
  runProcess,
  writeJsonReport,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const flakeRuns = String(args['flake-runs'] ?? '20');
const samples = String(args.samples ?? '20');
const webhookSamples = String(args['webhook-samples'] ?? args.samples ?? '25');
const childPassthroughArgs = [
  ...(args['no-write'] ? ['--no-write'] : []),
  ...(args['output-dir'] ? ['--output-dir', String(args['output-dir'])] : []),
];
const probes = [
  ['ttfe', ['ttfe-timing.mjs', ...childPassthroughArgs]],
  ['ttfe-flake-loop', ['ttfe-flake-loop.mjs', '--runs', flakeRuns, ...childPassthroughArgs]],
  ['oauth-p95', ['oauth-p95.mjs', '--samples', samples, ...childPassthroughArgs]],
  ['webhook-p95', ['webhook-p95.mjs', '--samples', webhookSamples, ...childPassthroughArgs]],
  ['sdk-size', ['sdk-size.mjs', ...childPassthroughArgs]],
  ['verify-webhook-speed', ['verify-webhook-speed.mjs', ...childPassthroughArgs]],
  ['baseline-comparator', ['baseline-comparator.mjs', ...childPassthroughArgs]],
];

const results = [];
for (const [name, commandArgs] of probes) {
  const result = await runProcess(process.execPath, [
    path.join(rootDir, 'scripts', 'plugforge-metrics', commandArgs[0]),
    ...commandArgs.slice(1),
  ], {
    cwd: rootDir,
    forwardOutput: Boolean(args.verbose),
  });
  const report = parseTrailingJson(result.stdout);
  results.push({
    name,
    ok: result.exitCode === 0 && isValidMetricReport(report),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    metric: report?.metric ?? null,
    status: report?.status ?? null,
    outputPath: report?.outputPath ?? null,
    malformed: !isValidMetricReport(report),
    timedOut: Boolean(result.timedOut),
    stderrTail: result.stderr.slice(-2000),
    stdoutTail: report ? null : result.stdout.slice(-2000),
  });
}

const failed = results.filter(result => !result.ok);
const report = {
  metric: 'plugforge-metrics-summary',
  status: failed.length === 0 ? 'measured' : 'failed',
  ok: failed.length === 0,
  generatedAt: nowIso(),
  durationMs: Date.now() - startedAt,
  probes: results,
};

const outputPath = await writeJsonReport('summary.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

function isValidMetricReport(report) {
  return Boolean(
    report &&
    typeof report === 'object' &&
    typeof report.metric === 'string' &&
    typeof report.status === 'string' &&
    typeof report.ok === 'boolean' &&
    typeof report.generatedAt === 'string'
  );
}
