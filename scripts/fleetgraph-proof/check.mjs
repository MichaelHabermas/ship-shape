#!/usr/bin/env node
// Checks that generated FleetGraph proof artifacts are present and internally consistent.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SCENARIOS, validateProofPacket } from './proof-model.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outputRoot = path.join(repoRoot, 'my-docs/evidence/fleetgraph-proof');
const publicRoot = path.join(repoRoot, 'web/public/fleetgraph-observability/proof');

const packet = JSON.parse(await readFile(path.join(outputRoot, 'latest.json'), 'utf8'));
const html = await readFile(path.join(outputRoot, 'latest.html'), 'utf8');
const markdown = await readFile(path.join(outputRoot, 'latest.md'), 'utf8');
const issues = validateProofPacket(packet);
const options = new Set(process.argv.slice(2));
const allowedVerdicts = new Set(['pass']);
if (options.has('--allow-risk')) allowedVerdicts.add('risk');
if (options.has('--allow-blocked')) allowedVerdicts.add('blocked');

if (!allowedVerdicts.has(packet.verdict)) {
  issues.push(`proof verdict is ${packet.verdict}; rerun with --allow-risk or --allow-blocked only for non-submission inspection`);
}

for (const scenario of REQUIRED_SCENARIOS) {
  if (!html.includes(scenario.id)) issues.push(`latest.html does not mention ${scenario.id}`);
  if (!markdown.includes(scenario.title)) issues.push(`latest.md does not mention ${scenario.title}`);
}

if (!html.includes('<script type="application/json" id="proof-data">')) {
  issues.push('latest.html is missing embedded proof JSON');
} else {
  const embedded = html.match(/<script type="application\/json" id="proof-data">([\s\S]*?)<\/script>/)?.[1];
  if (!embedded) {
    issues.push('latest.html proof JSON could not be parsed');
  } else if (JSON.stringify(JSON.parse(embedded)) !== JSON.stringify(packet)) {
    issues.push('latest.html embedded proof JSON does not match latest.json');
  }
}
if (/Bearer\s+[A-Za-z0-9._~+/=-]+|postgres(?:ql)?:\/\/[^@\s]+@|PASSWORD=/.test(JSON.stringify(packet))) {
  issues.push('latest.json appears to contain an unredacted secret-like value');
}
const staleThresholdDays = await readStaleIssueDays();
if (staleThresholdDays !== null) {
  const stalePattern = /No meaningful update for (\d+)\+ days/g;
  for (const [label, text] of [['latest.json', JSON.stringify(packet)], ['latest.html', html], ['latest.md', markdown]]) {
    for (const match of text.matchAll(stalePattern)) {
      if (Number(match[1]) !== staleThresholdDays) {
        issues.push(`${label} contains stale threshold ${match[1]}+ days but code uses ${staleThresholdDays}+ days`);
      }
    }
  }
}
if (packet.target !== 'local') {
  await checkPublicArtifacts(packet, issues);
}

if (issues.length) {
  console.error('FleetGraph proof check failed:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('FleetGraph proof artifacts are internally consistent.');

async function readStaleIssueDays() {
  const source = await readFile(path.join(repoRoot, 'api/src/fleetgraph/detection/attention-policy.ts'), 'utf8');
  const match = source.match(/export const STALE_ISSUE_DAYS = (\d+);/);
  return match ? Number(match[1]) : null;
}

async function checkPublicArtifacts(localPacket, issues) {
  let publicPacket;
  let publicMarkdown;
  try {
    publicPacket = JSON.parse(await readFile(path.join(publicRoot, 'latest.json'), 'utf8'));
    publicMarkdown = await readFile(path.join(publicRoot, 'latest.md'), 'utf8');
  } catch (error) {
    issues.push(`public proof artifacts are missing or unreadable: ${error.message}`);
    return;
  }
  for (const key of ['generatedAt', 'runId', 'target', 'verdict']) {
    if (publicPacket[key] !== localPacket[key]) {
      issues.push(`public latest.json ${key} disagrees with local latest.json`);
    }
  }
  if (JSON.stringify(publicPacket.summary?.deployedSignals ?? []) !== JSON.stringify(localPacket.summary?.deployedSignals ?? [])) {
    issues.push('public latest.json deployed signals disagree with local latest.json');
  }
  if (JSON.stringify(publicPacket.traceEvidence?.bySignal ?? {}) !== JSON.stringify(localPacket.traceEvidence?.bySignal ?? {})) {
    issues.push('public latest.json trace evidence disagrees with local latest.json');
  }
  if (!publicMarkdown.includes('## Reviewer Test Cases')) {
    issues.push('public latest.md is missing Reviewer Test Cases');
  }
}
