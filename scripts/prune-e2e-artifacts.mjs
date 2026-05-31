#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const testResultsDir = path.join(root, 'test-results');
const args = process.argv.slice(2);

function valueAfter(flag, fallback) {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
}

const apply = args.includes('--apply');
const olderThanDays = Number(valueAfter('--older-than-days', '7'));
const now = Date.now();
const cutoffMs = now - olderThanDays * 24 * 60 * 60 * 1000;

if (!Number.isFinite(olderThanDays) || olderThanDays < 1) {
  console.error(`Invalid --older-than-days value: ${olderThanDays}`);
  process.exit(2);
}

const keepPathParts = new Set([
  'e2e-shards',
  'features-real-fast',
  'test-all',
]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return [entryPath, ...walk(entryPath)];
    return [entryPath];
  });
}

function directorySize(dir) {
  let total = 0;
  for (const entryPath of walk(dir)) {
    if (fs.existsSync(entryPath) && fs.statSync(entryPath).isFile()) {
      total += fs.statSync(entryPath).size;
    }
  }
  return total;
}

function formatBytes(bytes) {
  const units = ['B', 'K', 'M', 'G'];
  let value = bytes;
  let unit = units.shift() ?? 'B';
  while (value >= 1024 && units.length > 0) {
    value /= 1024;
    unit = units.shift() ?? unit;
  }
  return `${value.toFixed(value >= 10 || unit === 'B' ? 0 : 1)}${unit}`;
}

function isInsideKeptPath(dir) {
  const relative = path.relative(testResultsDir, dir);
  return relative.split(path.sep).some((part) => keepPathParts.has(part));
}

function isArchiveDirectory(dir) {
  return path.basename(path.dirname(dir)) === 'archive';
}

function isOldEnough(dir) {
  return fs.statSync(dir).mtimeMs < cutoffMs;
}

function findPruneTargets() {
  const dirs = walk(testResultsDir).filter((entryPath) => {
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isDirectory()) return false;
    if (!isArchiveDirectory(entryPath)) return false;
    if (isInsideKeptPath(entryPath)) return false;
    return isOldEnough(entryPath);
  });

  return dirs
    .map((dir) => ({
      dir,
      relative: path.relative(root, dir),
      size: directorySize(dir),
      mtimeMs: fs.statSync(dir).mtimeMs,
    }))
    .sort((a, b) => a.relative.localeCompare(b.relative));
}

const beforeSize = fs.existsSync(testResultsDir) ? directorySize(testResultsDir) : 0;
const targets = findPruneTargets();
const totalBytes = targets.reduce((sum, target) => sum + target.size, 0);

console.log(`${apply ? 'Pruning' : 'Dry run'} E2E artifacts older than ${olderThanDays} day(s).`);
console.log(`Scope: old archive directories under test-results/`);
console.log(`Keeping paths containing: ${[...keepPathParts].join(', ')}`);
console.log(`Targets: ${targets.length}`);
console.log(`Potential space: ${formatBytes(totalBytes)}`);
console.log('');

for (const target of targets) {
  const date = new Date(target.mtimeMs).toISOString().slice(0, 10);
  console.log(`${formatBytes(target.size).padStart(6)}  ${date}  ${target.relative}`);
}

if (!apply) {
  console.log('');
  console.log('No files deleted. Re-run with --apply to delete these targets.');
  process.exit(0);
}

for (const target of targets) {
  fs.rmSync(target.dir, { recursive: true, force: true });
}

const afterSize = fs.existsSync(testResultsDir) ? directorySize(testResultsDir) : 0;
console.log('');
console.log(`Deleted ${targets.length} archive director${targets.length === 1 ? 'y' : 'ies'}.`);
console.log(`test-results size: ${formatBytes(beforeSize)} -> ${formatBytes(afterSize)}`);
