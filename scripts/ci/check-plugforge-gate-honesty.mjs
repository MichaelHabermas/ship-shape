#!/usr/bin/env node
// PlugForge gate honesty — fail loudly while live proof is open or mock evidence claims pass.
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  findInvalidIntegrationEvidence,
  formatLiveProofGaps,
  liveProofGaps,
  readLedger,
} from './plugforge-gate-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const policyPath = path.join(rootDir, 'scripts/ci/plugforge-gate-policy.yaml');
const args = new Set(process.argv.slice(2));
const strictEvidence = !args.has('--allow-mock-evidence');

const ledger = readLedger();
const gaps = liveProofGaps(ledger);
const problems = [];

if (gaps.length > 0) {
  problems.push(`${gaps.length} live_required ledger atom(s) are not proven`);
}

if (strictEvidence) {
  problems.push(...findInvalidIntegrationEvidence());
}

if (!existsSync(policyPath)) {
  problems.push('plugforge-gate-policy.yaml is missing');
}

const summary = {
  gate: 'plugforge:gate-honesty',
  ok: problems.length === 0,
  live_proof_gaps: gaps.map((entry) => ({
    id: entry.id,
    status: entry.status,
    section: entry.section,
    gap: entry.gap,
  })),
  problems,
  policy: path.relative(rootDir, policyPath),
};

console.log(JSON.stringify(summary, null, 2));

if (problems.length > 0) {
  console.error(formatLiveProofGaps(gaps));
  if (strictEvidence && problems.some(problem => problem.includes('proof_class'))) {
    console.error('');
    console.error('Remove or move mock integration evidence that claims status "passed".');
    console.error('Archived mocks live under my-docs/evidence/plugforge-integrations/_invalidated-mock-*/');
  }
  console.error('');
  console.error('Gate honesty FAILED. Behavior gates stay red until live user-visible proof exists.');
  process.exit(1);
}

console.log('Gate honesty OK — no open live_required gaps and no mock passed integration evidence.');
