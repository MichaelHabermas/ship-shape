#!/usr/bin/env node
// Report-only OAuth Auth Code P95 placeholder records why robust latency measurement is not performed here.
import process from 'node:process';
import path from 'node:path';
import { nowIso, parseArgs, rootDir, writeJsonReport } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const report = {
  metric: 'oauth-p95',
  status: 'not_measured',
  ok: false,
  generatedAt: nowIso(),
  reason: 'A robust OAuth Auth Code + PKCE P95 needs controlled load, stable app fixtures, browser/consent timing, and endpoint-level timing around authorization and token exchange. This placeholder is report-only and does not synthesize traffic.',
  proposedMeasurement: {
    sampleSize: Number.parseInt(String(args.samples ?? '100'), 10),
    endpoints: [
      'GET /oauth/authorize',
      'POST /oauth/consent/approve',
      'POST /oauth/token',
    ],
    statistic: 'p95 browser round-trip latency in milliseconds for successful Authorization Code + PKCE flows, with failure count reported separately',
  },
};

const outputPath = await writeJsonReport('oauth-p95.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exitCode = 0;
