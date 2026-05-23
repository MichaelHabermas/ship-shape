import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, parseArgs, validateRunId } from './lib/cli.mjs';
import { buildReport } from './lib/report.mjs';
import { runSelectedProbes } from './lib/probe-selection.mjs';

test('parseArgs supports flags and values', () => {
  assert.deepEqual(parseArgs(['--quick', '--api-url', 'http://localhost:3000', '--fail-on=high']), {
    quick: true,
    apiUrl: 'http://localhost:3000',
    failOn: 'high',
  });
});

test('validateRunId rejects path-like values', () => {
  assert.throws(() => validateRunId('../bad'));
  assert.equal(validateRunId('cat8-good_1'), 'cat8-good_1');
});

test('buildReport counts required surfaces', () => {
  const report = buildReport({
    config: {
      runId: 'cat8-test',
      target: 'local',
      mode: 'local-active',
      apiUrl: 'http://localhost:3000',
      webUrl: 'http://localhost:5173',
      wsUrl: 'ws://localhost:3000',
    },
    startedAt: 'start',
    finishedAt: 'finish',
    probes: [
      { id: 'auth-session-demo', status: 'passed', findingIds: [] },
      { id: 'websocket-demo', status: 'passed', findingIds: [] },
      { id: 'input-demo', status: 'passed', findingIds: [] },
      { id: 'dependency-demo', status: 'passed', findingIds: [] },
    ],
  });
  assert.equal(report.summary.attackSurfacesMeasured, 4);
});

test('buildConfig accepts boolean-like flag values', () => {
  const config = buildConfig(['--quick=true', '--api-url', 'https://example.test', '--allow-write=true', '--allow-stress=1', '--run-id', 'bools'], {});
  assert.equal(config.quick, true);
  assert.equal(config.allowWrite, true);
  assert.equal(config.allowStress, true);
});

test('runSelectedProbes skips disabled write and stress probes centrally', async () => {
  const results = await runSelectedProbes(
    { config: { allowWrite: false, allowStress: false, probe: null } },
    [
      { id: 'write-demo', name: 'write demo', requiresWrite: true, run: async () => assert.fail('write probe ran') },
      { id: 'stress-demo', name: 'stress demo', requiresStress: true, run: async () => assert.fail('stress probe ran') },
    ]
  );
  assert.deepEqual(results.map((result) => result.status), ['skipped', 'skipped']);
});

test('buildReport does not count skipped-only surfaces as measured', () => {
  const report = buildReport({
    config: {
      runId: 'cat8-test',
      target: 'remote',
      mode: 'safe',
      apiUrl: 'https://example.test',
      webUrl: 'https://example.test',
      wsUrl: 'wss://example.test',
    },
    startedAt: 'start',
    finishedAt: 'finish',
    probes: [
      { id: 'input-write-demo', status: 'skipped', findingIds: [] },
    ],
  });
  assert.equal(report.summary.attackSurfacesMeasured, 0);
  assert.equal(report.surfaces.inputSanitization.status, 'skipped');
});
