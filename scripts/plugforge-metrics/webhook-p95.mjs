#!/usr/bin/env node
// Report-only webhook P95 placeholder: records why robust webhook delivery latency is not performed by this probe.
import process from 'node:process';
import path from 'node:path';
import { nowIso, parseArgs, rootDir, writeJsonReport } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const report = {
  metric: 'webhook-p95',
  status: 'not_measured',
  ok: false,
  generatedAt: nowIso(),
  reason: 'A robust webhook P95 needs an instrumented receiver, deterministic event generation, retry isolation, and delivery timestamps from enqueue to verified receipt. This placeholder is report-only and does not create webhook traffic.',
  proposedMeasurement: {
    sampleSize: Number.parseInt(String(args.samples ?? '100'), 10),
    path: 'create document events, collect webhook_deliveries timing, verify receiver signatures, then compute delivery p95',
    statistic: 'p95 enqueue-to-verified-receipt latency in milliseconds, with retry and failure counts reported separately',
  },
};

const outputPath = await writeJsonReport('webhook-p95.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exitCode = 0;
