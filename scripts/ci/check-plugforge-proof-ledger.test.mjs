// Tests for atom-specific PlugForge proof-ledger evidence validation.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkerPath = path.join(here, 'check-plugforge-proof-ledger.mjs');
const rootDir = path.resolve(here, '../..');

test('accepts atom-specific TTFE timing evidence for CLI tail proof', () => {
  withTempLedger('W6-CLI-007', ttfeTimingEvidence(), result => {
    assert.equal(result.status, 0, result.stderr);
  });
});

test('rejects generic live JSON for CLI tail proof', () => {
  withTempLedger('W6-CLI-007', { proofClass: 'live', ok: true, status: 'passed' }, result => {
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /metric must be ttfe-timing/);
    assert.match(`${result.stdout}\n${result.stderr}`, /tailEvent must be present/);
  });
});

test('rejects TTFE evidence for Slack live atoms', () => {
  withTempLedger('W6-INT-004', ttfeTimingEvidence(), result => {
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Slack atoms require flow "slack"/);
    assert.match(`${result.stdout}\n${result.stderr}`, /real Slack document\.created message/);
  });
});

test('accepts 20-run live TTFE flake evidence for metric atoms', () => {
  withTempLedger('W6-METRIC-005', ttfeFlakeEvidence(), result => {
    assert.equal(result.status, 0, result.stderr);
  });
});

test('rejects proven live-required atoms without a registered evidence validator', () => {
  withTempLedger('W6-OAUTH-999', ttfeTimingEvidence(), result => {
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /no atom-specific live evidence validator/);
  });
});

function withTempLedger(id, evidence, assertion) {
  const dir = mkdtempSync(path.join(tmpdir(), 'plugforge-ledger-test-'));
  try {
    const evidencePath = path.join(dir, 'evidence.json');
    const ledgerPath = path.join(dir, 'proof-ledger.yaml');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    writeFileSync(ledgerPath, ledgerFor({ id, proofFiles: evidencePath }));
    const result = spawnSync(process.execPath, [checkerPath, `--ledger=${ledgerPath}`], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    assertion(result);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function ledgerFor({ id, proofFiles }) {
  return [
    'requirements:',
    `  - id: ${id}`,
    '    source: test:1',
    '    section: Test',
    '    requirement: Test requirement',
    '    requirement_class: functional',
    '    testability: api',
    '    priority: P0',
    '    status: proven',
    '    proof_tier: live_required',
    '    proof_command: pnpm test-proof',
    `    proof_files: ${proofFiles}`,
    '    pending_test: none',
    '    manual_evidence: none',
    '    covered_by: none',
    '    gap: none',
  ].join('\n');
}

function ttfeTimingEvidence(overrides = {}) {
  const tailEvent = documentCreatedTailEvent();
  return {
    metric: 'ttfe-timing',
    proofClass: 'live',
    approvalMethod: 'oauth_device_ui',
    status: 'measured',
    ok: true,
    targets: { maxTotalMs: 60_000 },
    result: {
      missingStages: [],
      totalMs: 10_000,
      liveApprovalOk: true,
      tailOk: true,
    },
    evidence: {
      approval: { method: 'oauth_device_ui' },
      tailEvent,
    },
    drill: {
      approval: { method: 'oauth_device_ui' },
      tailEvent,
      timings: [
        { stage: 'install', ms: 100 },
        { stage: 'login', ms: 100 },
        { stage: 'subscription', ms: 100 },
        { stage: 'create', ms: 100 },
        { stage: 'receipt', ms: 100 },
        { stage: 'verification', ms: 100 },
        { stage: 'total', ms: 10_000 },
      ],
    },
    ...overrides,
  };
}

function ttfeFlakeEvidence() {
  const runs = Array.from({ length: 20 }, (_, index) => ({
    run: index + 1,
    ok: true,
    proofClass: 'live',
    evidence: {
      tailEvent: documentCreatedTailEvent(),
    },
    timings: [{ stage: 'total', ms: 10_000 }],
  }));
  return {
    metric: 'ttfe-flake-loop',
    proofClass: 'live',
    status: 'measured',
    ok: true,
    targets: { maxP95Ms: 60_000, maxFailedRuns: 0, requiredProofClass: 'live' },
    requestedRuns: 20,
    passedRuns: 20,
    failedRuns: 0,
    totalTimingMs: { min: 10_000, max: 10_000, p50: 10_000, p95: 10_000 },
    runs,
  };
}

function documentCreatedTailEvent() {
  return {
    verified: true,
    event: 'document.created',
    payload: {
      type: 'document.created',
    },
  };
}
