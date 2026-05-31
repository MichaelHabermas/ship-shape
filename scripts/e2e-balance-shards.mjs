#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const valueAfter = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
};

const shardCount = Number(valueAfter('--shards', process.env.E2E_SHARDS || '4'));
const bucketOnly = valueAfter('--bucket', '');
const json = args.has('--json');

if (!Number.isInteger(shardCount) || shardCount < 1) {
  console.error(`Invalid --shards value: ${shardCount}`);
  process.exit(2);
}

function listSpecs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSpecs(entryPath);
    return entry.name.endsWith('.spec.ts') ? [entryPath] : [];
  });
}

function specScore(file) {
  const text = fs.readFileSync(file, 'utf8');
  const tests = [...text.matchAll(/\btest(?:\.\w+)?\s*\(/g)].length;
  const waits = [...text.matchAll(/waitForTimeout\((\d+)/g)]
    .reduce((total, match) => total + Number(match[1] || 0), 0);
  const lines = text.split('\n').length;
  return {
    file: path.relative(root, file),
    tests,
    waits,
    lines,
    score: tests * 1000 + waits + Math.ceil(lines / 10),
  };
}

const specs = listSpecs(path.join(root, 'e2e'))
  .map(specScore)
  .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

const buckets = Array.from({ length: shardCount }, (_, index) => ({
  index: index + 1,
  score: 0,
  tests: 0,
  waits: 0,
  specs: [],
}));

for (const spec of specs) {
  buckets.sort((a, b) => a.score - b.score || a.specs.length - b.specs.length);
  const bucket = buckets[0];
  bucket.score += spec.score;
  bucket.tests += spec.tests;
  bucket.waits += spec.waits;
  bucket.specs.push(spec.file);
}

buckets.sort((a, b) => a.index - b.index);

if (bucketOnly) {
  const bucket = buckets[Number(bucketOnly) - 1];
  if (!bucket) {
    console.error(`Invalid --bucket value: ${bucketOnly}`);
    process.exit(2);
  }
  process.stdout.write(`${bucket.specs.join('\n')}\n`);
  process.exit(0);
}

if (json) {
  process.stdout.write(`${JSON.stringify({ shardCount, buckets }, null, 2)}\n`);
  process.exit(0);
}

for (const bucket of buckets) {
  console.log(`Shard ${bucket.index}/${shardCount}: ${bucket.specs.length} specs, ${bucket.tests} test declarations, ${(bucket.waits / 1000).toFixed(1)}s fixed waits`);
  for (const spec of bucket.specs) {
    console.log(`  ${spec}`);
  }
}
