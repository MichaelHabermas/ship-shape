#!/usr/bin/env node
// Gated SDK verifier benchmark proves verifyWebhook stays below the PlugForge per-call target.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {
  nowIso,
  parseArgs,
  percentile,
  requireNumber,
  rootDir,
  writeJsonReport,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const samples = Number.parseInt(String(args.samples ?? '5000'), 10);
const warmup = Number.parseInt(String(args.warmup ?? '250'), 10);
if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(warmup) || warmup < 0) {
  console.error('Usage: node scripts/plugforge-metrics/verify-webhook-speed.mjs --samples <n> --warmup <n>');
  process.exit(2);
}

const maxP95Ms = requireNumber(args['max-p95-ms'], 1);
const startedAt = Date.now();
const requireFromApi = createRequire(path.join(rootDir, 'api', 'package.json'));
const tsx = requireFromApi('tsx/cjs/api');
const { verifyWebhook } = tsx.require(path.join(rootDir, 'sdk', 'src', 'webhook.ts'), import.meta.url);

const rawBody = JSON.stringify({
  id: 'evt_metric_verify',
  type: 'document.created',
  data: { document: { id: crypto.randomUUID(), title: 'metric' } },
});
const secret = 'ship_whsec_metric_speed';
const timestamp = Math.floor(Date.now() / 1000);
const signature = crypto
  .createHmac('sha256', secret)
  .update(`${timestamp}.${rawBody}`)
  .digest('hex');
const headers = { 'ship-signature': `t=${timestamp},v1=${signature}` };

for (let index = 0; index < warmup; index += 1) {
  verifyWebhook(headers, rawBody, secret);
}

const timings = [];
for (let index = 0; index < samples; index += 1) {
  const sampleStartedAt = performance.now();
  const ok = verifyWebhook(headers, rawBody, secret);
  timings.push(performance.now() - sampleStartedAt);
  if (!ok) throw new Error('verifyWebhook rejected the benchmark signature');
}

const p95 = percentile(timings, 95);
const average = timings.reduce((sum, value) => sum + value, 0) / timings.length;
const ok = typeof p95 === 'number' && p95 < maxP95Ms;
const report = {
  metric: 'verify-webhook-speed',
  status: ok ? 'measured' : 'failed',
  ok,
  generatedAt: nowIso(),
  durationMs: Date.now() - startedAt,
  targets: {
    maxP95Ms,
    samples,
    warmup,
  },
  result: {
    averageMs: average,
    minMs: Math.min(...timings),
    maxMs: Math.max(...timings),
    p50Ms: percentile(timings, 50),
    p95Ms: p95,
  },
};

const outputPath = await writeJsonReport('verify-webhook-speed.json', report, args);
if (outputPath) report.outputPath = path.relative(rootDir, outputPath);
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
