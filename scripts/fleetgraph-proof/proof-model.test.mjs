// Verifies FleetGraph proof packet validation catches missing evidence and preserves safety claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProofPacket, REQUIRED_SCENARIOS, validateProofPacket } from './proof-model.mjs';

test('buildProofPacket maps required scenarios to a reviewer matrix', () => {
  const goldenCaseIndex = new Map(REQUIRED_SCENARIOS.map((scenario) => [scenario.goldenCaseId, {
    id: scenario.goldenCaseId,
    title: scenario.title,
    mode: scenario.id.startsWith('on-demand') ? 'on_demand' : 'proactive',
    expectedDecision: scenario.expected,
    labels: ['action:human_gate', 'evidence:full'],
  }]));

  const packet = buildProofPacket({
    generatedAt: '2026-05-28T00:00:00.000Z',
    runId: 'test-run',
    target: 'local',
    git: { branch: 'test', sha: 'abc123', dirty: false },
    goldenCaseIndex,
    executedCaseIds: new Set(REQUIRED_SCENARIOS.map((scenario) => scenario.goldenCaseId)),
    executedScenarioIds: new Set(),
    productSurface: { summary: { average: { uiProofSeparation: 4 } }, sections: [{ id: 'current', summary: { passCount: 1, failCount: 0 }, results: [] }] },
    environments: [{ id: 'local', required: false, status: 'configured' }],
    commandResults: [],
    artifacts: [
      { label: 'HTML', path: 'my-docs/evidence/fleetgraph-proof/latest.html' },
      { label: 'JSON', path: 'my-docs/evidence/fleetgraph-proof/latest.json' },
      { label: 'MD', path: 'my-docs/evidence/fleetgraph-proof/latest.md' },
    ],
  });

  assert.equal(packet.scenarios.length, REQUIRED_SCENARIOS.length);
  assert.equal(packet.summary.provenScenarioCount, REQUIRED_SCENARIOS.length);
  assert.equal(packet.safety.find((check) => check.name === 'Human gate before next action')?.status, 'pass');
  assert.deepEqual(validateProofPacket(packet), []);
});

test('buildProofPacket does not count defined-only golden cases as executed proof', () => {
  const goldenCaseIndex = new Map(REQUIRED_SCENARIOS.map((scenario) => [scenario.goldenCaseId, {
    id: scenario.goldenCaseId,
    title: scenario.title,
    mode: 'proactive',
    expectedDecision: scenario.expected,
    labels: [],
  }]));

  const packet = buildProofPacket({
    generatedAt: '2026-05-28T00:00:00.000Z',
    runId: 'test-run',
    target: 'local',
    git: { branch: 'test', sha: 'abc123', dirty: false },
    goldenCaseIndex,
    executedCaseIds: new Set(['fg-create-blocked-visible-issue']),
    productSurface: null,
    environments: [],
    commandResults: [],
    artifacts: [
      { label: 'HTML', path: 'my-docs/evidence/fleetgraph-proof/latest.html' },
      { label: 'JSON', path: 'my-docs/evidence/fleetgraph-proof/latest.json' },
      { label: 'MD', path: 'my-docs/evidence/fleetgraph-proof/latest.md' },
    ],
  });

  assert.equal(packet.summary.provenScenarioCount, 1);
  assert.equal(packet.scenarios.find((scenario) => scenario.id === 'proactive-quiet-exit')?.status, 'defined');
  assert.equal(packet.verdict, 'risk');
});

test('validateProofPacket catches decision drift from required scenarios', () => {
  const goldenCaseIndex = new Map(REQUIRED_SCENARIOS.map((scenario) => [scenario.goldenCaseId, {
    id: scenario.goldenCaseId,
    title: scenario.title,
    mode: 'proactive',
    expectedDecision: scenario.goldenCaseId === 'fg-create-blocked-visible-issue' ? 'quiet_exit' : scenario.expected,
    labels: [],
  }]));

  const packet = buildProofPacket({
    generatedAt: '2026-05-28T00:00:00.000Z',
    runId: 'test-run',
    target: 'local',
    git: { branch: 'test', sha: 'abc123', dirty: false },
    goldenCaseIndex,
    executedCaseIds: new Set(REQUIRED_SCENARIOS.map((scenario) => scenario.goldenCaseId)),
    productSurface: null,
    environments: [],
    commandResults: [],
    artifacts: [
      { label: 'HTML', path: 'my-docs/evidence/fleetgraph-proof/latest.html' },
      { label: 'JSON', path: 'my-docs/evidence/fleetgraph-proof/latest.json' },
      { label: 'MD', path: 'my-docs/evidence/fleetgraph-proof/latest.md' },
    ],
  });

  assert.match(validateProofPacket(packet).join('\n'), /expected create_finding but found quiet_exit/);
  assert.equal(packet.verdict, 'fail');
});

test('validateProofPacket reports missing required scenario', () => {
  const packet = {
    generatedAt: '2026-05-28T00:00:00.000Z',
    runId: 'test-run',
    scenarios: [],
    safety: [],
    artifacts: [
      { path: 'my-docs/evidence/fleetgraph-proof/latest.html' },
      { path: 'my-docs/evidence/fleetgraph-proof/latest.json' },
      { path: 'my-docs/evidence/fleetgraph-proof/latest.md' },
    ],
  };

  assert.match(validateProofPacket(packet).join('\n'), /missing required scenario/);
});
