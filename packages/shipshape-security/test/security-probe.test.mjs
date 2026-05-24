import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig, parseArgs, validateRunId } from '../src/core/cli.mjs';
import { buildReport } from '../src/core/report.mjs';
import { runSelectedProbes } from '../src/core/probe-selection.mjs';
import { MEASURED_SURFACE_COUNT } from '../src/core/registry.mjs';
import { fingerprintForFinding, triageFindings } from '../src/core/finding-registry.mjs';
import { shouldFailSecurityProbeRun } from '../src/core/ci-fail.mjs';

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

test('fingerprintForFinding is stable', () => {
  const a = fingerprintForFinding('authorization-demo', 'probe-demo');
  const b = fingerprintForFinding('authorization-demo', 'probe-demo');
  assert.equal(a, b);
  assert.match(a, /^sha256:/);
});

test('buildReport counts five measured surfaces when authorization probes run', () => {
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
      { id: 'authorization-demo', status: 'passed', findingIds: [] },
      { id: 'websocket-demo', status: 'passed', findingIds: [] },
      { id: 'input-demo', status: 'passed', findingIds: [] },
      { id: 'dependency-demo', status: 'passed', findingIds: [] },
    ],
    registry: { version: 1, entries: [] },
  });
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.summary.attackSurfacesMeasured, 5);
  assert.equal(report.summary.attackSurfacesTotal, MEASURED_SURFACE_COUNT);
});

test('buildReport triage buckets known open vs new', () => {
  const fingerprint = fingerprintForFinding('authorization-demo', 'probe-demo');
  const registry = {
    version: 1,
    entries: [{ fingerprint, probeId: 'authorization-demo', findingId: 'probe-demo', status: 'open', title: 'Demo' }],
  };
  const probes = [
    {
      id: 'authorization-demo',
      status: 'failed',
      findings: [
        {
          id: 'probe-demo',
          probeId: 'authorization-demo',
          title: 'Demo',
          severity: 'high',
        },
      ],
    },
  ];
  const report = buildReport({
    config: {
      runId: 'triage-test',
      target: 'local',
      mode: 'local-active',
      apiUrl: 'http://localhost:3000',
      webUrl: 'http://localhost:5173',
      wsUrl: 'ws://localhost:3000',
    },
    startedAt: 'start',
    finishedAt: 'finish',
    probes,
    registry,
  });
  assert.equal(report.triage.counts.knownOpen, 1);
  assert.equal(report.triage.counts.new, 0);
  const triage = triageFindings({ registry, probes });
  assert.equal(triage.knownOpen.length, 1);
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

test('shouldFailSecurityProbeRun fails on new and regression when fail-on=new', () => {
  assert.equal(
    shouldFailSecurityProbeRun({ failOn: 'new', triage: { counts: { new: 1, regression: 0 } } }).fail,
    true
  );
  assert.equal(
    shouldFailSecurityProbeRun({ failOn: 'new', triage: { counts: { new: 0, regression: 1 } } }).fail,
    true
  );
  assert.equal(
    shouldFailSecurityProbeRun({ failOn: 'new', triage: { counts: { new: 0, regression: 0 } } }).fail,
    false
  );
  assert.equal(
    shouldFailSecurityProbeRun({ failOn: 'none', triage: { counts: { new: 3, regression: 2 } } }).fail,
    false
  );
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
    probes: [{ id: 'input-write-demo', status: 'skipped', findingIds: [] }],
    registry: { version: 1, entries: [] },
  });
  assert.equal(report.summary.attackSurfacesMeasured, 0);
  assert.equal(report.surfaces.inputSanitization.status, 'skipped');
});
