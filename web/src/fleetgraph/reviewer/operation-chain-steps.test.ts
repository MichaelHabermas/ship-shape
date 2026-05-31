// Verifies live operation drawer progress derives from proof-chain step status.
import { describe, expect, it } from 'vitest';
import type { FleetGraphReviewerChain, FleetGraphReviewerStep } from '@ship/shared';
import { activeChainStepIndex, chainStepsForOperation } from './operation-chain-steps';

function step(key: string, status: FleetGraphReviewerStep['status']): FleetGraphReviewerStep {
  return { key, label: key, status, at: null, evidence: '' };
}

function chain(steps: FleetGraphReviewerStep[]): FleetGraphReviewerChain {
  return {
    chainId: 'chain-1',
    scenario: 'week-blocker',
    status: 'in_progress',
    missing: [],
    missingLabels: [],
    productPath: 'partial',
    generatedAt: '2026-05-31T12:00:00.000Z',
    steps,
    links: {},
    latencyMs: {},
    freshness: {
      generatedAt: '2026-05-31T12:00:00.000Z',
      newestRunAt: null,
      newestWorkerTickAt: null,
      proofAgeMs: null,
      workerAgeMs: null,
    },
    humanGate: { required: false, state: 'missing', allowedActions: [] },
    traceQuality: { passed: true, requiredDecisions: [], observedDecisions: [], scores: [] },
    sourceMutationCheck: { passed: true, before: {}, after: {}, changedFields: [] },
    usageSummary: { modelCalls: 0 },
  };
}

describe('chainStepsForOperation', () => {
  it('returns scenario steps in causal order', () => {
    const steps = chainStepsForOperation('scenario', chain([
      step('source', 'pass'),
      step('attention_event', 'pending'),
      step('worker_tick', 'pending'),
    ]));
    expect(steps.map((item) => item.key)).toEqual(['source', 'attention_event', 'worker_tick']);
  });
});

describe('activeChainStepIndex', () => {
  it('highlights the first pending step while running', () => {
    const steps = [
      step('source', 'pass'),
      step('attention_event', 'pending'),
      step('worker_tick', 'pending'),
    ];
    expect(activeChainStepIndex(steps, 'running')).toBe(1);
  });

  it('highlights the last step when all steps already passed while running', () => {
    const steps = [
      step('source', 'pass'),
      step('graph_run', 'pass'),
    ];
    expect(activeChainStepIndex(steps, 'running')).toBe(1);
  });
});
