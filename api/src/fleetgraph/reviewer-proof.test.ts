// Verifies reviewer proof command helpers run from the monorepo root.
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import {
  CAUSAL_TIMESTAMP_SKEW_MS,
  normalizeCausalDiffMs,
  preferredReviewerProofChain,
  proofCommandEnv,
  publicReviewerChainProof,
  recordFleetGraphReviewerChatMutationProof,
  fleetGraphReviewerProofEnabled,
  REVIEWER_PROOF_BLOCKER_TEXT,
  reviewerProofRepoRoot,
} from './reviewer-proof.js';
import type { FleetGraphReviewerChain } from '@ship/shared';

describe('reviewerProofRepoRoot', () => {
  const originalCwd = process.cwd;
  const originalProofRoot = process.env.FLEETGRAPH_PROOF_REPO_ROOT;

  afterEach(() => {
    process.cwd = originalCwd;
    if (originalProofRoot === undefined) {
      delete process.env.FLEETGRAPH_PROOF_REPO_ROOT;
    } else {
      process.env.FLEETGRAPH_PROOF_REPO_ROOT = originalProofRoot;
    }
    vi.restoreAllMocks();
  });

  it('uses an explicit proof repo root override', () => {
    process.env.FLEETGRAPH_PROOF_REPO_ROOT = '/tmp/proof-root';
    process.cwd = () => '/tmp/proof-root/api';

    expect(reviewerProofRepoRoot()).toBe('/tmp/proof-root');
  });

  it('runs from the monorepo root when the API process cwd is api', () => {
    delete process.env.FLEETGRAPH_PROOF_REPO_ROOT;
    process.cwd = () => '/workspace/ship-shape/api';

    expect(reviewerProofRepoRoot()).toBe(path.resolve('/workspace/ship-shape'));
  });

  it('keeps the current cwd when already running from the repo root', () => {
    delete process.env.FLEETGRAPH_PROOF_REPO_ROOT;
    process.cwd = () => '/workspace/ship-shape';

    expect(reviewerProofRepoRoot()).toBe('/workspace/ship-shape');
  });
});

describe('reviewer proof scenario copy', () => {
  it('describes a human unblock fixture, not fake platform credentials', () => {
    expect(REVIEWER_PROOF_BLOCKER_TEXT).toBe('Waiting on reviewer proof unblock decision');
    expect(REVIEWER_PROOF_BLOCKER_TEXT).not.toContain('API credentials');
    expect(REVIEWER_PROOF_BLOCKER_TEXT).not.toContain('platform owner');
  });
});

describe('proofCommandEnv', () => {
  it('passes trace URL overrides into the proof subprocess', () => {
    const env = proofCommandEnv({
      DATABASE_URL: 'postgres://ship:ship@localhost:5432/ship_dev',
      FLEETGRAPH_PROOF_TRACE_URLS_JSON: '{"blocked":"https://smith.langchain.com/public/example/r"}',
      SESSION_SECRET: 'do-not-forward',
    });

    expect(env.FLEETGRAPH_PROOF_TRACE_URLS_JSON).toBe('{"blocked":"https://smith.langchain.com/public/example/r"}');
    expect(env.FLEETGRAPH_PROOF_TEST_DATABASE_URL).toBe('postgres://ship:ship@localhost:5432/ship_test_audit');
    expect(env.SESSION_SECRET).toBeUndefined();
  });
});

describe('fleetGraphReviewerProofEnabled', () => {
  const originalFlag = process.env.FLEETGRAPH_REVIEWER_PROOF_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.FLEETGRAPH_REVIEWER_PROOF_ENABLED;
    } else {
      process.env.FLEETGRAPH_REVIEWER_PROOF_ENABLED = originalFlag;
    }
  });

  it('accepts Render-style true and local 1 values', () => {
    process.env.FLEETGRAPH_REVIEWER_PROOF_ENABLED = 'true';
    expect(fleetGraphReviewerProofEnabled()).toBe(true);

    process.env.FLEETGRAPH_REVIEWER_PROOF_ENABLED = '1';
    expect(fleetGraphReviewerProofEnabled()).toBe(true);
  });

  it('keeps the reviewer proof controls disabled by default', () => {
    delete process.env.FLEETGRAPH_REVIEWER_PROOF_ENABLED;

    expect(fleetGraphReviewerProofEnabled()).toBe(false);
  });
});

describe('publicReviewerChainProof', () => {
  it('keeps proof shape while stripping private chain evidence', () => {
    const chain: FleetGraphReviewerChain = {
      chainId: 'chain-1',
      scenario: 'week-blocker',
      status: 'complete',
      missing: [],
      generatedAt: '2026-05-30T00:00:00.000Z',
      freshness: {
        generatedAt: '2026-05-30T00:00:00.000Z',
        newestRunAt: '2026-05-30T00:00:00.000Z',
        newestWorkerTickAt: '2026-05-30T00:00:00.000Z',
        proofAgeMs: 1000,
        workerAgeMs: 1000,
      },
      latencyMs: { total: 1000 },
      links: {
        runId: 'run-1',
        traceId: 'private-trace-id',
        traceUrl: 'https://trace.example/private-trace-id',
        findingId: 'finding-1',
      },
      steps: [
        {
          key: 'source',
          label: 'Ship source',
          status: 'pass',
          at: '2026-05-30T00:00:00.000Z',
          evidence: 'Raw issue title with customer@example.com and hidden source note.',
        },
        {
          key: 'trace',
          label: 'Trace',
          status: 'broken',
          at: '2026-05-30T00:00:01.000Z',
          evidence: 'Trace URL missing or unsafe',
        },
      ],
      visibleOutput: {
        title: 'Private reviewer finding',
        summary: 'Contains private evidence.',
        severity: 'high',
        confidence: 0.9,
        evidence: [{ kind: 'source', claim: 'secret claim', visibility: 'actor_visible' }],
        recommendedActions: [],
        proposedRecipients: [],
        humanGate: { approvalRequired: true },
      },
      humanGate: { required: true, state: 'present', allowedActions: ['approve after review'] },
      traceQuality: {
        passed: false,
        requiredDecisions: ['create_finding'],
        observedDecisions: ['create_finding'],
        scores: [
          { name: 'traceUrl', passed: false, value: 'https://trace.example/private-trace-id', comment: 'Trace URL missing.' },
          { name: 'modelCalls', passed: true, value: 1, comment: 'Usage persisted.' },
        ],
      },
      sourceMutationCheck: {
        passed: false,
        before: { state: 'blocked', private_note: 'do not leak' },
        after: { state: 'done', private_note: 'do not leak' },
        changedFields: ['state'],
      },
      usageSummary: { modelCalls: 1, costCurrency: 'USD' },
    };

    const proof = publicReviewerChainProof(chain);
    const serialized = JSON.stringify(proof);

    expect(proof.chainId).toBe('chain-1');
    expect(proof.steps.map((step) => step.key)).toEqual(['source', 'trace']);
    expect(proof.steps[0]?.evidence).toBe('Reviewer-safe evidence present.');
    expect(proof.steps[1]?.evidence).toBe('Trace URL missing or unsafe');
    expect(proof.sourceMutationCheck).toEqual({
      passed: false,
      before: {},
      after: {},
      changedFields: ['state'],
    });
    expect(proof.traceQuality.scores[0]?.value).toBeNull();
    expect(proof.traceQuality.scores[1]?.value).toBe(1);
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('private-trace-id');
    expect(serialized).not.toContain('Private reviewer finding');
    expect(serialized).not.toContain('do not leak');
  });
});

describe('reviewer proof causality', () => {
  it('accepts same-execution persistence skew without hiding real backward causality', () => {
    expect(normalizeCausalDiffMs(-3)).toBe(0);
    expect(normalizeCausalDiffMs(-CAUSAL_TIMESTAMP_SKEW_MS)).toBe(0);
    expect(normalizeCausalDiffMs(-CAUSAL_TIMESTAMP_SKEW_MS - 1)).toBe(-CAUSAL_TIMESTAMP_SKEW_MS - 1);
  });

  it('prefers a complete create-path week blocker over a newer mutation proof run', () => {
    const completeCreateChain = reviewerChain({
      chainId: 'create-chain',
      status: 'complete',
      missing: [],
    });
    const laterMutationProofChain = reviewerChain({
      chainId: 'mutation-proof-chain',
      status: 'broken',
      missing: ['causal_ordering'],
    });

    expect(preferredReviewerProofChain([laterMutationProofChain, completeCreateChain])?.chainId)
      .toBe('create-chain');
  });
});

describe('recordFleetGraphReviewerChatMutationProof', () => {
  function insertedChangedFields(query: ReturnType<typeof vi.fn>): unknown {
    const params = query.mock.calls[0]?.[1] as unknown;
    return Array.isArray(params) ? params[6] : undefined;
  }

  it('does not report structurally equal nested source snapshots as changed', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const state = {
      title: 'Reviewer issue',
      properties: { state: 'blocked', nested: { owner: 'reviewer' } },
      content: { type: 'doc', content: [{ type: 'paragraph', text: 'same' }] },
      associations: [{ relationshipType: 'sprint', relatedId: 'week-1' }],
    };

    await recordFleetGraphReviewerChatMutationProof({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      before: {
        sourceIssueId: '22222222-2222-4222-8222-222222222222',
        findingId: '33333333-3333-4333-8333-333333333333',
        state,
      },
      after: {
        sourceIssueId: '22222222-2222-4222-8222-222222222222',
        findingId: '33333333-3333-4333-8333-333333333333',
        state: structuredClone(state),
      },
      chatRunId: '44444444-4444-4444-8444-444444444444',
      db: { query },
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(insertedChangedFields(query)).toEqual([]);
  });

  it('reports real nested source snapshot changes', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await recordFleetGraphReviewerChatMutationProof({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      before: {
        sourceIssueId: '22222222-2222-4222-8222-222222222222',
        findingId: '33333333-3333-4333-8333-333333333333',
        state: { properties: { state: 'blocked' }, associations: [] },
      },
      after: {
        sourceIssueId: '22222222-2222-4222-8222-222222222222',
        findingId: '33333333-3333-4333-8333-333333333333',
        state: { properties: { state: 'done' }, associations: [] },
      },
      chatRunId: '44444444-4444-4444-8444-444444444444',
      db: { query },
    });

    expect(insertedChangedFields(query)).toEqual(['properties']);
  });
});

function reviewerChain(overrides: Partial<FleetGraphReviewerChain> = {}): FleetGraphReviewerChain {
  return {
    chainId: 'chain-1',
    scenario: 'week-blocker',
    status: 'complete',
    missing: [],
    generatedAt: '2026-05-30T00:00:00.000Z',
    freshness: {
      generatedAt: '2026-05-30T00:00:00.000Z',
      newestRunAt: '2026-05-30T00:00:00.000Z',
      newestWorkerTickAt: '2026-05-30T00:00:00.000Z',
      proofAgeMs: 1000,
      workerAgeMs: 1000,
    },
    latencyMs: { total: 1000 },
    links: { runId: 'run-1' },
    steps: [],
    humanGate: { required: true, state: 'present', allowedActions: ['approve after review'] },
    traceQuality: { passed: true, requiredDecisions: [], observedDecisions: [], scores: [] },
    sourceMutationCheck: { passed: true, before: {}, after: {}, changedFields: [] },
    usageSummary: { modelCalls: 0, costCurrency: 'USD' },
    ...overrides,
  };
}
