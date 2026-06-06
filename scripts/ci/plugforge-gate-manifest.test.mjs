// Validates PlugForge gate API test manifest paths exist on disk.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(rootDir, 'api');
const manifestPath = path.join(rootDir, 'scripts/ci/plugforge-api-tests.manifest.json');

test('plugforge API manifest lists existing vitest files', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const tests = manifest.contract_api_tests ?? [];
  assert.ok(tests.length >= 20, 'expected at least 20 contract API tests');

  const missing = tests.filter((relativePath) => !existsSync(path.join(apiRoot, relativePath)));
  assert.deepEqual(missing, [], `missing manifest paths: ${missing.join(', ')}`);
});

test('plugforge API manifest has no duplicate entries', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const tests = manifest.contract_api_tests ?? [];
  const unique = new Set(tests);
  assert.equal(unique.size, tests.length);
});
