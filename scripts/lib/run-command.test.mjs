// Boundary tests for scripts/lib/run-command.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCommand } from './run-command.mjs';

test('runCommand succeeds with throwOnFail true', async () => {
  const result = await runCommand(process.execPath, ['-e', 'console.log("ok")'], {
    throwOnFail: true,
    timeoutMs: 5_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /ok/);
});

test('runCommand returns on failure when throwOnFail is false', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.exit(2)'], {
    throwOnFail: false,
    timeoutMs: 5_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 2);
});

test('runCommand throws on non-zero exit by default', async () => {
  await assert.rejects(
    () => runCommand(process.execPath, ['-e', 'process.exit(3)'], { timeoutMs: 5_000 }),
    /failed with exit 3/,
  );
});

test('runCommand times out', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    throwOnFail: false,
    timeoutMs: 200,
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 124);
});
