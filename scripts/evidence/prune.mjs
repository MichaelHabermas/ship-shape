#!/usr/bin/env node
import { rm, readdir, readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parseArgs, validateRunId } from './lib/cli.mjs';
import { exists, readJson, repoRelative, repoRoot } from './lib/fs-utils.mjs';

const RUNS_DIR = resolve(repoRoot, 'my-docs/evidence-runs');
const PROTECTION_FILES = [
  'my-docs/evidence/submission-ledger.json',
  'my-docs/project-weeks-sot/week-4/SUBMISSION_CHECKLIST.md',
  'my-docs/project-weeks-sot/week-4/IMPROVEMENT_REPORT.md',
  'my-docs/project-weeks-sot/week-4/reviewer-dashboard.html',
];

async function readTextIfExists(path) {
  if (!(await exists(path))) return '';
  return readFile(path, 'utf8');
}

async function protectedRunIds() {
  const haystack = (
    await Promise.all(PROTECTION_FILES.map((path) => readTextIfExists(resolve(repoRoot, path))))
  ).join('\n');
  const matches = haystack.matchAll(/my-docs\/evidence-runs\/([^/"'\s<>)]+)/g);
  return new Set([...matches].map((match) => match[1]));
}

async function listRuns() {
  if (!(await exists(RUNS_DIR))) return [];
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = validateRunId(entry.name);
    const runDir = resolve(RUNS_DIR, runId);
    const manifestPath = resolve(runDir, 'manifest.json');
    let manifest = null;
    if (await exists(manifestPath)) {
      manifest = await readJson(manifestPath);
    }
    const stats = await stat(runDir);
    runs.push({
      runId,
      runDir,
      manifest,
      mtimeMs: stats.mtimeMs,
      retentionKind: manifest?.retention?.kind || 'legacy',
    });
  }
  return runs.sort((left, right) => left.runId.localeCompare(right.runId));
}

function parseKeepLatest(value) {
  if (value === undefined || value === true) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid --keep-latest value "${value}". Use a non-negative integer.`);
  }
  return parsed;
}

function keepLatestRunIds(runs, count) {
  if (count === 0) return new Set();
  return new Set(
    [...runs]
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, count)
      .map((run) => run.runId)
  );
}

function isInsideRunsDir(path) {
  const relative = repoRelative(path);
  return relative === 'my-docs/evidence-runs' || relative.startsWith(`my-docs${sep}evidence-runs${sep}`);
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2));
  const apply = options.apply === true;
  const includeSourceEvidence = options.includeSourceEvidence === true;
  const keepLatest = parseKeepLatest(options.keepLatest);
  const runs = await listRuns();
  const protectedIds = await protectedRunIds();
  const latestIds = keepLatestRunIds(runs, keepLatest);

  const decisions = runs.map((run) => {
    const reasons = [];
    if (protectedIds.has(run.runId)) reasons.push('referenced');
    if (latestIds.has(run.runId)) reasons.push('keep-latest');
    if (run.retentionKind === 'source-evidence' && !includeSourceEvidence) reasons.push('source-evidence');
    if (run.retentionKind === 'generated-package') reasons.push('generated-package');

    return {
      run,
      action: reasons.length > 0 ? 'keep' : 'delete',
      reasons,
    };
  });

  for (const decision of decisions) {
    const label = decision.action === 'delete' ? (apply ? 'deleted' : 'would-delete') : 'keep';
    const reason = decision.reasons.length > 0 ? ` (${decision.reasons.join(', ')})` : '';
    console.log(`${label.padEnd(12)} ${decision.run.runId} [${decision.run.retentionKind}]${reason}`);
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to delete unprotected runs.');
    return;
  }

  for (const decision of decisions) {
    if (decision.action !== 'delete') continue;
    if (!isInsideRunsDir(decision.run.runDir)) {
      throw new Error(`Refusing to delete outside evidence runs: ${decision.run.runDir}`);
    }
    await rm(decision.run.runDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
