import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { streamSpawn, RUN_MODES, jobTitleForMode } from '../src/console/job-runner.mjs';

test('RUN_MODES includes run check ci', () => {
  assert.equal(RUN_MODES.has('run'), true);
  assert.equal(RUN_MODES.has('check'), true);
  assert.equal(RUN_MODES.has('ci'), true);
  assert.equal(RUN_MODES.has('bogus'), false);
});

test('jobTitleForMode', () => {
  assert.equal(jobTitleForMode('ci'), 'CI gate');
  assert.equal(jobTitleForMode('check'), 'Findings check');
  assert.equal(jobTitleForMode('run'), 'Security probe');
});

test('streamSpawn emits line-delimited output', async () => {
  const lines = [];
  const { exitCode } = await streamSpawn(process.execPath, ['-e', "console.log('a'); console.log('b')"], {}, (line) =>
    lines.push(line)
  );
  assert.equal(exitCode, 0);
  assert.deepEqual(lines, ['a', 'b']);
});

test('streamSpawn maps non-zero exit', async () => {
  const { exitCode } = await streamSpawn(process.execPath, ['-e', 'process.exit(3)'], {}, () => {});
  assert.equal(exitCode, 3);
});
