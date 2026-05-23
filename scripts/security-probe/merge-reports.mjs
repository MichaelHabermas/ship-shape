#!/usr/bin/env node
/** Merge multiple security probe reports into one combined report. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport } from './lib/report.mjs';
import { renderMarkdown } from './lib/report.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const [outRunId, ...inputPaths] = process.argv.slice(2);
if (!outRunId || inputPaths.length === 0) {
  console.error('Usage: merge-reports.mjs <out-run-id> <report.json> [...]');
  process.exit(1);
}

const reports = inputPaths.map(readReport);
const probes = [];
const seenProbeIds = new Set();
for (const report of reports) {
  for (const probe of report.probes || []) {
    if (seenProbeIds.has(probe.id)) continue;
    seenProbeIds.add(probe.id);
    const findings = (report.findings || []).filter((f) => f.probeId === probe.id);
    probes.push({ ...probe, findings, findingIds: findings.map((f) => f.id) });
  }
}

const first = reports[0];
const last = reports[reports.length - 1];
const config = {
  runId: outRunId,
  apiUrl: last.run?.apiUrl || first.run?.apiUrl,
  webUrl: last.run?.webUrl || first.run?.webUrl,
  wsUrl: last.run?.wsUrl || first.run?.wsUrl,
  target: first.run?.target || 'local',
  mode: first.run?.mode || 'local-active',
  outDir: resolve(repoRoot, 'my-docs/evidence/security-audit'),
};

const merged = buildReport({
  config,
  probes,
  startedAt: first.run?.startedAt || new Date().toISOString(),
  finishedAt: last.run?.finishedAt || new Date().toISOString(),
});

merged.run.repo = first.run?.repo || repoRoot;
merged.run.id = outRunId;
merged.mergedFrom = inputPaths;

const outDir = resolve(config.outDir, 'runs', outRunId);
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'report.json'), `${JSON.stringify(merged, null, 2)}\n`);
writeFileSync(resolve(outDir, 'report.md'), renderMarkdown(merged));
console.log(`Merged ${inputPaths.length} reports → runs/${outRunId}/report.json`);
console.log(`Probes: ${merged.probes.length}, findings: ${merged.summary.findings}`);
