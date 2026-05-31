// Verifies FleetGraph reviewer chain display helpers use server missingLabels.
import { describe, expect, it } from 'vitest';
import type { FleetGraphReviewerChain } from '@ship/shared';
import { chainMissingLabels, chainTooltip } from './chain-helpers';

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

describe('chainMissingLabels', () => {
  it('returns server missingLabels', () => {
    const labels = chainMissingLabels(chain({
      missing: ['chat_human_gate'],
      missingLabels: ['Human gate missing'],
    }));
    expect(labels).toEqual(['Human gate missing']);
  });
});

describe('chainTooltip', () => {
  it('includes missingLabels in tooltip text', () => {
    const text = chainTooltip(chain({
      missing: ['source'],
      missingLabels: ['Ship source'],
      scenario: 'week-blocker',
      status: 'broken',
    }));
    expect(text).toContain('Ship source');
  });
});
