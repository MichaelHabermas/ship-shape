import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  findInvalidIntegrationEvidence,
  isAllowedPassedIntegrationEvidence,
  liveProofGaps,
  parseLedger,
} from './plugforge-gate-lib.mjs';

test('liveProofGaps returns missing live_required atoms', () => {
  const gaps = liveProofGaps(parseLedger([
    'requirements:',
    '  - id: W6-INT-004',
    '    status: missing',
    '    proof_tier: live_required',
    '    requirement: Slack posts document.created',
    '  - id: W6-INT-007',
    '    status: proven',
    '    proof_tier: unit_ok',
    '    requirement: import boundary',
  ].join('\n')));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.id, 'W6-INT-004');
});

test('isAllowedPassedIntegrationEvidence allows contract and live only', () => {
  assert.equal(isAllowedPassedIntegrationEvidence({ status: 'failed' }), true);
  assert.equal(isAllowedPassedIntegrationEvidence({ status: 'passed', proof_class: 'live' }), true);
  assert.equal(isAllowedPassedIntegrationEvidence({ status: 'passed', proof_class: 'contract' }), true);
  assert.equal(isAllowedPassedIntegrationEvidence({ status: 'passed', proof_class: 'dev_shortcut' }), false);
  assert.equal(isAllowedPassedIntegrationEvidence({ status: 'passed' }), false);
});

test('findInvalidIntegrationEvidence flags passed JSON without allowed proof_class', () => {
  const evidenceDir = mkdtempSync(path.join(tmpdir(), 'plugforge-evidence-'));
  writeFileSync(path.join(evidenceDir, 'slack.json'), JSON.stringify({ status: 'passed' }));
  writeFileSync(path.join(evidenceDir, 'boundary.json'), JSON.stringify({ status: 'passed', proof_class: 'contract' }));
  const problems = findInvalidIntegrationEvidence(evidenceDir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /slack\.json/);
});
