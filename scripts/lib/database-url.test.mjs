// Contract tests for Postgres URL resolution scripts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const resolveScript = path.join(rootDir, 'scripts/resolve-database-url.sh');

test('resolve-database-url.sh prints a reachable postgresql URL for ship_test_audit', () => {
  const url = execFileSync('bash', [resolveScript, 'ship_test_audit'], {
    cwd: rootDir,
    encoding: 'utf8',
  }).trim();

  assert.match(url, /^postgresql:\/\//);
  assert.match(url, /ship_test_audit/);

  const ready = execFileSync('pg_isready', ['-d', url], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  assert.match(ready, /accepting connections/i);
});
