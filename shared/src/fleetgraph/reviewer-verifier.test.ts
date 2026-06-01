// Tests shared reviewer proof selection and product-path derivation from chain steps.
import { describe, expect, it } from 'vitest';
import type { FleetGraphReviewerChain, FleetGraphReviewerStep } from '../types/fleetgraph.js';
import {
  enrichReviewerChainPresentation,
  preferredReviewerProofChain,
  productPathForSteps,
  proofGapLabel,
} from './reviewer-verifier.js';

function step(key: string, status: FleetGraphReviewerStep['status']): FleetGraphReviewerStep {
  return { key, label: key, status, at: null, evidence: '' };
}

function chain(overrides: Partial<FleetGraphReviewerChain>): FleetGraphReviewerChain {
  const steps = overrides.steps ?? [];
  const missing = overrides.missing ?? [];
  return enrichReviewerChainPresentation({
    chainId: overrides.chainId ?? 'chain-1',
    scenario: overrides.scenario ?? 'existing',
    status: overrides.status ?? 'broken',
    generatedAt: overrides.generatedAt ?? '2026-05-31T12:00:00.000Z',
    missing,
    missingLabels: missing.map(proofGapLabel),
    productPath: productPathForSteps(steps),
    steps,
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
  });
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

describe('productPathForSteps', () => {
  it('marks working when product-path steps pass', () => {
    const steps = [
      'source',
      'graph_run',
      'trace',
      'finding',
      'notification_projection',
      'chat_human_gate',
    ].map((key) => step(key, 'pass'));
    expect(productPathForSteps(steps)).toBe('working');
  });
});
