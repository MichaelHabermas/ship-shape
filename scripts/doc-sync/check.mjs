#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const strict = process.argv.includes('--strict');
const dir = dirname(fileURLToPath(import.meta.url));
const args = strict ? ['--strict'] : [];

const checks = ['check-doc-paths.mjs', 'check-facts.mjs', 'check-activation-refs.mjs'];

for (const script of checks) {
  const result = spawnSync(process.execPath, [join(dir, script), ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nDoc sync checks passed.');
