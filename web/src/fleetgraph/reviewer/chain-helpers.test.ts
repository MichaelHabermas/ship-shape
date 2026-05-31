// Verifies FleetGraph reviewer chain selection prefers complete week-blocker proof chains.
import { describe, expect, it } from 'vitest';
import type { FleetGraphReviewerChain } from '@ship/shared';
import { preferredReviewerProofChain } from './chain-helpers';

function chain(overrides: Partial<FleetGraphReviewerChain>): FleetGraphReviewerChain {
  return {
    chainId: overrides.chainId ?? 'chain-1',
    scenario: overrides.scenario ?? 'existing',
    status: overrides.status ?? 'broken',
    generatedAt: overrides.generatedAt ?? '2026-05-31T12:00:00.000Z',
    missing: overrides.missing ?? [],
    steps: overrides.steps ?? [],
    links: overrides.links ?? {},
    visibleOutput: overrides.visibleOutput,
    latencyMs: overrides.latencyMs ?? { total: 0 },
    freshness: overrides.freshness ?? { proofAgeMs: 0, workerAgeMs: 0 },
    traceQuality: overrides.traceQuality ?? { scores: [] },
    sourceMutationCheck: overrides.sourceMutationCheck ?? { passed: false, changedFields: [] },
    humanGate: overrides.humanGate ?? { state: 'required', allowedActions: [] },
  } as FleetGraphReviewerChain;
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
