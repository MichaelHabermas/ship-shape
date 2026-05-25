import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fingerprintForFinding,
  loadSecurityFindings,
  saveSecurityFindings,
  setFindingStatus,
  linkProbe,
  appendProbeVerifications,
  toFlatRegistryEntries,
} from '../../packages/shipshape-security/src/core/security-findings-store.mjs';
import { triageFindings } from '../../packages/shipshape-security/src/core/security-findings-triage.mjs';
import { validateSecurityFindings } from '../../packages/shipshape-security/src/core/security-findings-check.mjs';

test('fingerprintForFinding is stable', () => {
  const a = fingerprintForFinding('authorization-demo', 'probe-demo');
  assert.equal(a, fingerprintForFinding('authorization-demo', 'probe-demo'));
  assert.match(a, /^sha256:/);
});

test('setFindingStatus and linkProbe persist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-store-'));
  const path = join(dir, 'security-findings.json');
  const store = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    discovery: { date: '2026-05-22', method: 'test', sessionNote: null },
    clusters: [],
    findings: [
      {
        id: 'SS-FIND-001',
        title: 'Test',
        severity: 'high',
        status: 'open',
        discoveredAt: '2026-05-22',
        probes: [],
        verifications: [],
      },
    ],
  };
  saveSecurityFindings(store, path);
  const loaded = loadSecurityFindings(path);
  linkProbe(loaded, 'SS-FIND-001', {
    probeId: 'authorization-demo',
    findingId: 'probe-demo',
    role: 'regression',
  });
  setFindingStatus(loaded, 'SS-FIND-001', 'fixed', 'unit test');
  saveSecurityFindings(loaded, path);
  const again = loadSecurityFindings(path);
  assert.equal(again.findings[0].status, 'fixed');
  assert.equal(again.findings[0].probes.length, 1);
  assert.ok(again.findings[0].verifications.length >= 1);
});

test('toFlatRegistryEntries maps control vs regression', () => {
  const store = {
    findings: [
      {
        id: 'SS-FIND-010',
        status: 'open',
        title: 'Dashboard',
        probes: [
          {
            fingerprint: fingerprintForFinding('authorization-dashboard-private-metadata', 'probe-dashboard-private-metadata'),
            probeId: 'authorization-dashboard-private-metadata',
            findingId: 'probe-dashboard-private-metadata',
            role: 'control',
          },
        ],
      },
    ],
  };
  const entries = toFlatRegistryEntries(store);
  assert.equal(entries[0].status, 'control');
});

test('appendProbeVerifications appends pass events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-append-'));
  const path = join(dir, 'isolated-security-findings.json');
  const fp = fingerprintForFinding('authorization-demo', 'probe-demo');
  const store = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    discovery: {},
    clusters: [],
    findings: [
      {
        id: 'SS-FIND-001',
        title: 'Demo',
        severity: 'high',
        status: 'open',
        probes: [
          {
            fingerprint: fp,
            probeId: 'authorization-demo',
            findingId: 'probe-demo',
            role: 'regression',
          },
        ],
        verifications: [],
      },
    ],
  };
  saveSecurityFindings(store, path);
  const loaded = loadSecurityFindings(path);
  appendProbeVerifications(loaded, {
    runId: 'test-run',
    probes: [{ id: 'authorization-demo', status: 'passed', findings: [] }],
    storePath: path,
  });
  const saved = loadSecurityFindings(path);
  assert.equal(saved.findings[0].verifications.length, 1);
  assert.equal(saved.findings[0].verifications[0].result, 'pass');
});

test('triageFindings buckets known open vs regression', () => {
  const fp = fingerprintForFinding('authorization-demo', 'probe-demo');
  const registry = {
    entries: [
      {
        fingerprint: fp,
        probeId: 'authorization-demo',
        findingId: 'probe-demo',
        ledgerId: 'SS-FIND-001',
        status: 'fixed',
        title: 'Demo',
      },
    ],
  };
  const triage = triageFindings({
    registry,
    probes: [
      {
        id: 'authorization-demo',
        status: 'failed',
        findings: [{ id: 'probe-demo', probeId: 'authorization-demo', title: 'Demo', severity: 'high' }],
      },
    ],
  });
  assert.equal(triage.regression.length, 1);
});

test('validateSecurityFindings rejects bad status', () => {
  const result = validateSecurityFindings({
    schemaVersion: 1,
    findings: [{ id: 'SS-FIND-001', title: 'x', severity: 'high', status: 'bogus', probes: [] }],
  });
  assert.equal(result.ok, false);
});
