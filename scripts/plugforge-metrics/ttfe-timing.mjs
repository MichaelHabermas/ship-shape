#!/usr/bin/env node
// Report-only TTFE wrapper: runs `pnpm drill ttfe`, preserves its timing JSON, and writes a normalized report.
import process from 'node:process';
import path from 'node:path';
import { nowIso, parseArgs, parseTrailingJson, rootDir, runProcess, writeJsonReport } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const command = 'pnpm';
const commandArgs = ['drill', 'ttfe'];
const result = await runProcess(command, commandArgs, {
  cwd: rootDir,
  forwardOutput: Boolean(args.verbose),
});
const drillJson = parseTrailingJson(result.stdout);
const report = {
  metric: 'ttfe-timing',
  status: result.exitCode === 0 && drillJson?.ok === true ? 'measured' : 'failed',
  ok: result.exitCode === 0 && drillJson?.ok === true,
  generatedAt: nowIso(),
  durationMs: Date.now() - startedAt,
  command: [command, ...commandArgs].join(' '),
  process: {
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    error: result.error,
  },
  drill: drillJson,
  stderrTail: result.stderr.slice(-4000),
  stdoutTail: drillJson ? null : result.stdout.slice(-4000),
};

const outputName = args.name ? `${args.name}.json` : 'ttfe-timing.json';
const outputPath = await writeJsonReport(outputName, report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exitCode = result.exitCode === 0 ? 0 : 1;
