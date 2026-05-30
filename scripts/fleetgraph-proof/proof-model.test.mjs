// Verifies FleetGraph proof packet validation catches missing evidence and preserves safety claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProofPacket, REQUIRED_SCENARIOS, validateProofPacket } from './proof-model.mjs';
import {
  artifactPlan,
  shouldPublishPublicProof,
  summarizeDeployedEvidence,
  summarizeTraceEvidence,
  traceUrlFromMetadata,
} from './run.mjs';

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

test('deployed proof blocks without a completed worker output tick', () => {
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
    target: 'deployed',
    git: { branch: 'test', sha: 'abc123', dirty: false },
    goldenCaseIndex,
    executedCaseIds: new Set(REQUIRED_SCENARIOS.map((scenario) => scenario.goldenCaseId)),
    executedScenarioIds: new Set(['context-chat-human-gate', 'source-condition-resolved']),
    productSurface: { summary: { average: { uiProofSeparation: 4 } }, sections: [{ id: 'current', summary: { passCount: 1, failCount: 0 }, results: [] }] },
    environments: [{ id: 'deployed', required: true, status: 'configured' }],
    deployedEvidence: {
      signalTypes: ['at_risk', 'blocked', 'stale'],
      completedWorkerTickCount: 0,
      hasRecentCompletedWorkerOutput: false,
      stuckRunningTickCount: 0,
    },
    commandResults: [],
    artifacts: [
      { label: 'HTML', path: 'my-docs/evidence/fleetgraph-proof/latest.html' },
      { label: 'JSON', path: 'my-docs/evidence/fleetgraph-proof/latest.json' },
      { label: 'MD', path: 'my-docs/evidence/fleetgraph-proof/latest.md' },
    ],
  });

  assert.equal(packet.verdict, 'blocked');
});

test('deployed proof summarizes usage and blocks missing trace links', () => {
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
    target: 'deployed',
    git: { branch: 'test', sha: 'abc123', dirty: false },
    goldenCaseIndex,
    executedCaseIds: new Set(REQUIRED_SCENARIOS.map((scenario) => scenario.goldenCaseId)),
    executedScenarioIds: new Set(['context-chat-human-gate', 'source-condition-resolved']),
    productSurface: { summary: { average: { uiProofSeparation: 4 } }, sections: [{ id: 'current', summary: { passCount: 1, failCount: 0 }, results: [] }] },
    environments: [{ id: 'deployed', required: true, status: 'configured' }],
    deployedEvidence: {
      signalTypes: ['at_risk', 'blocked', 'stale'],
      completedWorkerTickCount: 1,
      hasRecentCompletedWorkerOutput: true,
      stuckRunningTickCount: 0,
      usageSummary: {
        graphInvocationCount: 2,
        modelCallCount: 1,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        deterministicRunCount: 1,
        realModelRunCount: 1,
        estimatedCostUsd: 0.00012,
        projections: {
          100: { monthlyInvocations: 3000, estimatedMonthlyCostUsd: 0.18 },
          1000: { monthlyInvocations: 30000, estimatedMonthlyCostUsd: 1.8 },
          10000: { monthlyInvocations: 300000, estimatedMonthlyCostUsd: 18 },
        },
      },
      traceEvidence: {
        requiredSignals: ['blocked', 'stale', 'at_risk', 'on_demand'],
        bySignal: {
          blocked: { signal: 'blocked', traceUrl: 'https://example.com/blocked' },
          stale: { signal: 'stale', traceUrl: 'https://example.com/stale' },
          at_risk: { signal: 'at_risk', traceUrl: 'https://example.com/risk' },
        },
        missingRequired: ['on_demand'],
      },
    },
    commandResults: [],
    artifacts: [
      { label: 'HTML', path: 'my-docs/evidence/fleetgraph-proof/latest.html' },
      { label: 'JSON', path: 'my-docs/evidence/fleetgraph-proof/latest.json' },
      { label: 'MD', path: 'my-docs/evidence/fleetgraph-proof/latest.md' },
    ],
  });

  assert.equal(packet.costs.graphInvocationCount, 2);
  assert.equal(packet.costs.realModelRunCount, 1);
  assert.equal(packet.costs.estimatedModelCostUsd, 0.00012);
  assert.equal(packet.verdict, 'blocked');
});

test('deployed proof accepts required public trace links for all claimed signals', () => {
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
    target: 'deployed',
    git: { branch: 'test', sha: 'abc123', dirty: false },
    goldenCaseIndex,
    executedCaseIds: new Set(REQUIRED_SCENARIOS.map((scenario) => scenario.goldenCaseId)),
    executedScenarioIds: new Set(['context-chat-human-gate', 'source-condition-resolved']),
    productSurface: { summary: { average: { uiProofSeparation: 4 } }, sections: [{ id: 'current', summary: { passCount: 1, failCount: 0 }, results: [] }] },
    environments: [{ id: 'deployed', required: true, status: 'configured' }],
    deployedEvidence: {
      signalTypes: ['at_risk', 'blocked', 'stale'],
      completedWorkerTickCount: 1,
      hasRecentCompletedWorkerOutput: true,
      stuckRunningTickCount: 0,
      usageSummary: {
        graphInvocationCount: 4,
        modelCallCount: 1,
        deterministicRunCount: 3,
        realModelRunCount: 1,
        estimatedCostUsd: 0.00012,
        projections: {},
      },
      traceEvidence: {
        requiredSignals: ['blocked', 'stale', 'at_risk', 'on_demand'],
        bySignal: {
          blocked: { signal: 'blocked', traceUrl: 'https://example.com/blocked' },
          stale: { signal: 'stale', traceUrl: 'https://example.com/stale' },
          at_risk: { signal: 'at_risk', traceUrl: 'https://example.com/risk' },
          on_demand: { signal: 'on_demand', traceUrl: 'https://example.com/chat' },
        },
        missingRequired: [],
      },
    },
    commandResults: [],
    artifacts: [
      { label: 'HTML', path: 'my-docs/evidence/fleetgraph-proof/latest.html' },
      { label: 'JSON', path: 'my-docs/evidence/fleetgraph-proof/latest.json' },
      { label: 'MD', path: 'my-docs/evidence/fleetgraph-proof/latest.md' },
    ],
  });

  assert.equal(packet.verdict, 'pass');
});

test('deployed proof blocks skipped focused e2e and validates public artifacts', () => {
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
    target: 'deployed',
    git: { branch: 'test', sha: 'abc123', dirty: false },
    goldenCaseIndex,
    executedCaseIds: new Set(REQUIRED_SCENARIOS.map((scenario) => scenario.goldenCaseId)),
    executedScenarioIds: new Set(['context-chat-human-gate', 'source-condition-resolved']),
    productSurface: { summary: { average: { uiProofSeparation: 4 } }, sections: [{ id: 'current', summary: { passCount: 1, failCount: 0 }, results: [] }] },
    environments: [{ id: 'deployed', required: true, status: 'configured' }],
    deployedEvidence: deployedEvidenceFixture(),
    commandResults: [{ name: 'FleetGraph attention loop E2E', status: 'skipped' }],
    artifacts: artifactPlan('test-run', 'deployed'),
  });

  assert.equal(packet.verdict, 'blocked');
  assert.deepEqual(validateProofPacket(packet), []);
  assert.equal(shouldPublishPublicProof(packet), false);
});

test('deployed evidence summarizes usage and chooses older valid public traces', () => {
  const evidence = summarizeDeployedEvidence({
    evidenceSource: 'test',
    workerTicks: [],
    completedWorkerTicks: [],
    stuckTicks: [{ count: 0 }],
    eventCounts: [],
    signalRows: [{ signal_type: 'blocked', count: 1 }, { signal_type: 'stale', count: 1 }, { signal_type: 'at_risk', count: 1 }],
    runRows: [],
    runEvidenceRows: [
      runRow({ id: 'new-blocked', signal_type: 'blocked', trace_metadata: {} }),
      runRow({ id: 'old-blocked', signal_type: 'blocked', trace_metadata: { traceUrl: 'https://smith.langchain.com/public/blocked/r' } }),
      runRow({ id: 'stale', signal_type: 'stale', trace_metadata: { observability: { traceUrl: 'https://cloud.langfuse.com/project/trace' } } }),
      runRow({ id: 'risk', signal_type: 'at_risk', trace_metadata: { langfuseUrl: 'https://us.cloud.langfuse.com/trace/risk' } }),
      runRow({ id: 'chat', decision: 'explain', trigger_reason: 'explain_finding', trace_metadata: { url: 'https://smith.langchain.com/public/chat/r' }, token_metadata: { modelCalls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15 }, cost_metadata: { estimatedCostUsd: 0.00001 } }),
    ],
  });

  assert.equal(evidence.usageSummary.graphInvocationCount, 5);
  assert.equal(evidence.usageSummary.modelCallCount, 1);
  assert.equal(evidence.usageSummary.inputTokens, 10);
  assert.equal(evidence.usageSummary.outputTokens, 5);
  assert.equal(evidence.usageSummary.estimatedCostUsd, 0.00001);
  assert.equal(evidence.traceEvidence.bySignal.blocked.runId, 'old-blocked');
  assert.deepEqual(evidence.traceEvidence.missingRequired, []);
});

test('trace URL extraction rejects private or malformed links', () => {
  assert.equal(traceUrlFromMetadata({ traceUrl: 'http://localhost:3000/trace' }), null);
  assert.equal(traceUrlFromMetadata({ traceUrl: 'not-a-url' }), null);
  assert.equal(traceUrlFromMetadata({ traceUrl: 'file:///tmp/trace' }), null);
  assert.equal(traceUrlFromMetadata({ traceUrl: 'https://smith.langchain.com/public/trace/r' }), 'https://smith.langchain.com/public/trace/r');
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

function deployedEvidenceFixture() {
  return {
    signalTypes: ['at_risk', 'blocked', 'stale'],
    completedWorkerTickCount: 1,
    hasRecentCompletedWorkerOutput: true,
    stuckRunningTickCount: 0,
    usageSummary: {
      graphInvocationCount: 4,
      modelCallCount: 1,
      deterministicRunCount: 3,
      realModelRunCount: 1,
      estimatedCostUsd: 0.00012,
      projections: {},
    },
    traceEvidence: {
      requiredSignals: ['blocked', 'stale', 'at_risk', 'on_demand'],
      bySignal: {
        blocked: { signal: 'blocked', traceUrl: 'https://example.com/blocked' },
        stale: { signal: 'stale', traceUrl: 'https://example.com/stale' },
        at_risk: { signal: 'at_risk', traceUrl: 'https://example.com/risk' },
        on_demand: { signal: 'on_demand', traceUrl: 'https://example.com/chat' },
      },
      missingRequired: [],
    },
  };
}

function runRow(overrides) {
  return {
    id: overrides.id ?? 'run',
    decision: overrides.decision ?? 'create_finding',
    trigger_reason: overrides.trigger_reason ?? 'scheduled-worker',
    signal_type: overrides.signal_type ?? 'blocked',
    created_at: overrides.created_at ?? '2026-05-28T00:00:00.000Z',
    trace_metadata: JSON.stringify(overrides.trace_metadata ?? {}),
    token_metadata: JSON.stringify(overrides.token_metadata ?? { modelCalls: 0 }),
    cost_metadata: JSON.stringify(overrides.cost_metadata ?? { estimatedCostUsd: 0 }),
  };
}
