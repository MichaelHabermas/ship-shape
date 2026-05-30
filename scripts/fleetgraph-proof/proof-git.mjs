// FleetGraph proof git metadata and golden-case index readers.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repoRoot } from './proof-repo.mjs';

export function gitInfo() {
  return {
    branch: gitValue(['branch', '--show-current']),
    sha: gitValue(['rev-parse', 'HEAD']),
    dirty: gitValue(['status', '--short', '--untracked-files=all']).length > 0,
  };
}

export async function readGoldenCaseIndex() {
  const source = await readFile(path.join(repoRoot, 'api/src/fleetgraph/eval/golden-cases.ts'), 'utf8');
  const entries = new Map();
  const caseBlocks = source.split(/\n  \{\n/).slice(1);
  for (const block of caseBlocks) {
    const id = match(block, /id: '([^']+)'/);
    if (!id) continue;
    entries.set(id, {
      id,
      title: match(block, /title: '([^']+)'/) ?? id,
      mode: match(block, /mode: '([^']+)'/) ?? 'unknown',
      expectedDecision: match(block, /expectedDecision: '([^']+)'/) ?? 'unknown',
      labels: [...block.matchAll(/'((?:mode|branch|action|evidence|permission|difficulty):[^']+)'/g)].map((item) => item[1]),
    });
  }
  return entries;
}

export async function readExecutableGoldenCaseIds() {
  const source = await readFile(path.join(repoRoot, 'api/src/fleetgraph/eval/executable-golden-cases.test.ts'), 'utf8');
  return new Set([...source.matchAll(/requireGoldenCase\('([^']+)'\)/g)].map((item) => item[1]));
}

export async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function gitValue(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function match(text, pattern) {
  return pattern.exec(text)?.[1] ?? null;
}
