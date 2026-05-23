#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceRoot = resolve(repoRoot, 'my-docs/evidence/security-audit');
const beforePath = resolve(evidenceRoot, 'runs/baseline-before/summary.json');
const afterPath = resolve(evidenceRoot, 'runs/baseline-after/summary.json');

const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));
const head = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();

const comparison = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString().slice(0, 10),
  metric: 'high_or_critical_dependency_cves',
  tool: 'pnpm audit --json',
  before: {
    label: 'BASELINE branch',
    commit: '072818cf77a54e1a796dd4b878e8564d8af3f1e7',
    high_or_critical_count: before.highOrCriticalCount,
    unique_cve_count: before.uniqueCveCount,
    evidence: 'my-docs/evidence/security-audit/runs/baseline-before/summary.json',
  },
  after: {
    label: 'current master',
    commit: head,
    high_or_critical_count: after.highOrCriticalCount,
    unique_cve_count: after.uniqueCveCount,
    evidence: 'my-docs/evidence/security-audit/runs/baseline-after/summary.json',
  },
  delta_high_or_critical: after.highOrCriticalCount - before.highOrCriticalCount,
  how_before_was_measured:
    'Full repo clone in a sibling folder, BASELINE branch checkout, pnpm audit, results copied here, clone removed.',
};

writeFileSync(resolve(evidenceRoot, 'baseline-comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`);

const md = `# Dependency CVE baseline (Category 8)

Measured: ${comparison.generatedAt}  
Tool: \`pnpm audit --json\` (high + critical only)

## How we measured “before”

We cloned the **entire ship-shape repo** into a **second folder** next to the original, checked out the **BASELINE** branch (old code), ran \`pnpm install\` and \`pnpm audit\`, saved the JSON, then deleted the clone.

Results live in **this repo only** under \`runs/baseline-before/\`.

## Results

| | High + critical CVEs |
| --- | ---: |
| **Before** (BASELINE branch) | **${before.highOrCriticalCount}** |
| **After** (current master) | **${after.highOrCriticalCount}** |

## Proof files

- Before: \`runs/baseline-before/summary.json\`
- After: \`runs/baseline-after/summary.json\`

## Re-run

\`\`\`bash
pnpm security:baseline:deps
\`\`\`

## Current probe (separate)

Live app checks: \`latest.json\`
`;

writeFileSync(resolve(evidenceRoot, 'baseline-measurements.md'), md);
console.log(`Before: ${before.highOrCriticalCount}  After: ${after.highOrCriticalCount}`);
