#!/usr/bin/env node
// Gated TTFE wrapper runs `pnpm drill ttfe`, validates canonical stages, and writes normalized evidence.
import process from 'node:process';
import path from 'node:path';
import { allowsDevShortcuts, failDevShortcut } from '../ci/plugforge-gate-lib.mjs';
import { nowIso, parseArgs, parseTrailingJson, requireNumber, rootDir, runProcess, writeJsonReport } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();
const requiredStages = ['install', 'login', 'subscription', 'create', 'receipt', 'verification', 'total'];
const maxTotalMs = requireNumber(args['max-total-ms'], 60_000);
const command = 'pnpm';
const commandArgs = ['drill', 'ttfe'];
const result = await runProcess(command, commandArgs, {
  cwd: rootDir,
  forwardOutput: Boolean(args.verbose),
});
const drillJson = parseTrailingJson(result.stdout);
const stageNames = Array.isArray(drillJson?.timings)
  ? drillJson.timings.map(timing => timing.stage ?? timing.name)
  : [];
const missingStages = requiredStages.filter(stage => !stageNames.includes(stage));
const totalMs = Array.isArray(drillJson?.timings)
  ? drillJson.timings.find(timing => timing.stage === 'total' || timing.name === 'total')?.ms
  : null;
const ok = result.exitCode === 0
  && drillJson?.ok === true
  && missingStages.length === 0
  && typeof totalMs === 'number'
  && totalMs < maxTotalMs;
const proofClass = allowsDevShortcuts() ? 'dev_shortcut' : 'dev_shortcut';
const behavioralOk = allowsDevShortcuts() && ok;
const report = {
  metric: 'ttfe-timing',
  proofClass,
  behavioralOk,
  status: behavioralOk ? 'measured' : 'failed',
  ok: behavioralOk,
  generatedAt: nowIso(),
  durationMs: Date.now() - startedAt,
  command: [command, ...commandArgs].join(' '),
  targets: {
    requiredStages,
    maxTotalMs,
    cleanMachineDocsOnlyMaxMs: 30 * 60 * 1000,
  },
  result: {
    missingStages,
    totalMs: totalMs ?? null,
  },
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
if (!behavioralOk) {
  failDevShortcut(
    'ttfe-timing',
    ok
      ? 'TTFE stages completed via dev shortcut (SQL device approval), not live /oauth/device UI login.'
      : 'TTFE drill did not complete required stages within the runtime gate.'
  );
}
process.exitCode = behavioralOk ? 0 : 1;
