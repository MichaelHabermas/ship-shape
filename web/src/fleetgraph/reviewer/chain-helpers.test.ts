// Verifies FleetGraph reviewer chain selection prefers complete week-blocker proof chains.
import { describe, expect, it } from 'vitest';
import type { FleetGraphReviewerChain } from '@ship/shared';
import { preferredReviewerProofChain } from '@ship/shared';

function chain(overrides: Partial<FleetGraphReviewerChain>): FleetGraphReviewerChain {
  return {
    chainId: overrides.chainId ?? 'chain-1',
    scenario: overrides.scenario ?? 'existing',
    status: overrides.status ?? 'broken',
    generatedAt: overrides.generatedAt ?? '2026-05-31T12:00:00.000Z',
    missing: overrides.missing ?? [],
    missingLabels: overrides.missingLabels ?? [],
    productPath: overrides.productPath ?? 'partial',
    steps: overrides.steps ?? [],
    links: overrides.links ?? {},
    latencyMs: overrides.latencyMs ?? {},
    freshness: overrides.freshness ?? {
      generatedAt: '2026-05-31T12:00:00.000Z',
      newestRunAt: null,
      newestWorkerTickAt: null,
      proofAgeMs: null,
      workerAgeMs: null,
    },
    humanGate: overrides.humanGate ?? { required: false, state: 'missing', allowedActions: [] },
    traceQuality: overrides.traceQuality ?? {
      passed: true,
      requiredDecisions: [],
      observedDecisions: [],
      scores: [],
    },
    sourceMutationCheck: overrides.sourceMutationCheck ?? {
      passed: true,
      before: {},
      after: {},
      changedFields: [],
    },
    usageSummary: overrides.usageSummary ?? { modelCalls: 0 },
    ...overrides,
  };
}

describe('preferredReviewerProofChain', () => {
  it('prefers complete week-blocker chains', () => {
    const chains = [
      chain({ chainId: 'historical', scenario: 'existing', status: 'complete' }),
      chain({ chainId: 'canonical', scenario: 'week-blocker', status: 'complete' }),
    ];
    expect(preferredReviewerProofChain(chains)?.chainId).toBe('canonical');
  });
});
