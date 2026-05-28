// Verifies FleetGraph observability scores stay deterministic and reviewer-safe.
import { describe, expect, it } from 'vitest';
import { scoreFleetGraphObservabilityResult, summarizeFleetGraphObservabilityScores } from './observability-scores.js';
import type { FleetGraphResult } from './types.js';

describe('scoreFleetGraphObservabilityResult', () => {
  it('passes no-model quiet exits with explicit zero-cost usage', () => {
    const scores = scoreFleetGraphObservabilityResult(result({
      decision: 'quiet_exit',
      tokenMetadata: { modelCalls: 0 },
      costMetadata: {},
    }));

    expect(scoreValue(scores, 'usage_present')).toBe(1);
    expect(scoreValue(scores, 'quiet_exit_zero_cost')).toBe(1);
    expect(scoreValue(scores, 'decision_shape_valid')).toBe(1);
    expect(summarizeFleetGraphObservabilityScores(scores)).toMatchObject({
      failed: 0,
    });
  });

  it('passes model paths with tokens and cost metadata', () => {
    const scores = scoreFleetGraphObservabilityResult(result({
      decision: 'create_finding',
      tokenMetadata: {
        modelCalls: 1,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        inputTokens: 90,
        outputTokens: 90,
        totalTokens: 180,
      },
      costMetadata: { estimatedCostUsd: 0.0000675 },
      evidence: [{
        kind: 'blocker',
        sourceDocumentId: '00000000-0000-4000-8000-000000000003',
        sourceType: 'issue',
        claim: 'Blocked on cert window approval.',
        excerpt: 'Blocked on cert window approval.',
        visibility: 'actor_visible',
        visibleFields: ['claim', 'excerpt'],
      }],
      visibleOutput: {
        title: 'Blocked issue',
        summary: 'Blocked on cert window approval.',
        recommendedAction: { label: 'Confirm owner', text: 'Ask the dependency owner to confirm the approval window.' },
        evidence: [],
        humanGate: { required: true },
      },
    }));

    expect(scoreValue(scores, 'usage_present')).toBe(1);
    expect(scoreValue(scores, 'quiet_exit_zero_cost')).toBe(1);
    expect(scoreValue(scores, 'human_gate_present')).toBe(1);
    expect(scoreValue(scores, 'output_actionability')).toBe(1);
    expect(scoreValue(scores, 'output_groundedness')).toBe(1);
  });

  it('fails sensitive reviewer payloads', () => {
    const scores = scoreFleetGraphObservabilityResult(result({
      decision: 'explain',
      visibleOutput: {
        title: 'Blocked issue',
        summary: 'Prompt leaked: user@example.com',
        evidence: [],
        humanGate: { required: false },
      },
    }));

    expect(scoreValue(scores, 'trace_safety')).toBe(0);
  });

  it('fails fake mutation claims and missing human gates', () => {
    const scores = scoreFleetGraphObservabilityResult(result({
      decision: 'create_finding',
      visibleOutput: {
        title: 'Blocked issue',
        summary: 'Notified the owner and closed the blocker.',
        evidence: [],
        humanGate: {},
      },
    }));

    expect(scoreValue(scores, 'no_fake_mutation_claim')).toBe(0);
    expect(scoreValue(scores, 'human_gate_present')).toBe(0);
  });
});

function scoreValue(scores: ReturnType<typeof scoreFleetGraphObservabilityResult>, name: string): number {
  const score = scores.find((item) => item.name === name);
  if (!score) throw new Error(`Missing score ${name}`);
  return score.value;
}

function result(input: Partial<FleetGraphResult>): FleetGraphResult {
  const traceMetadata = {
    mode: 'proactive' as const,
    decision: input.decision ?? 'quiet_exit',
    nodePath: ['normalizeTrigger', 'produceOutput'],
  };
  return {
    decision: input.decision ?? 'quiet_exit',
    finding: null,
    run: {
      id: '00000000-0000-4000-8000-000000000001',
      workspace_id: '00000000-0000-4000-8000-000000000002',
      finding_id: null,
      source_issue_id: null,
      source_sprint_id: null,
      mode: 'proactive',
      trigger_reason: 'test',
      decision: input.decision ?? 'quiet_exit',
      dedupe_key: null,
      input_snapshot: {},
      evidence_snapshot: [],
      output_snapshot: {},
      trace_metadata: traceMetadata,
      token_metadata: input.tokenMetadata ?? { modelCalls: 0 },
      cost_metadata: input.costMetadata ?? {},
      error_metadata: {},
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
    },
    runInput: {
      workspaceId: '00000000-0000-4000-8000-000000000002',
      mode: 'proactive',
      triggerReason: 'test',
      decision: input.decision ?? 'quiet_exit',
      inputSnapshot: {},
      evidenceSnapshot: [],
      outputSnapshot: {},
      traceMetadata,
      tokenMetadata: input.tokenMetadata ?? { modelCalls: 0 },
      costMetadata: input.costMetadata ?? {},
      errorMetadata: {},
    },
    visibleOutput: input.visibleOutput ?? {
      title: 'Quiet exit',
      summary: 'No action needed.',
      evidence: [],
      humanGate: { required: false },
    },
    evidence: input.evidence ?? [],
    traceMetadata,
    tokenMetadata: input.tokenMetadata ?? { modelCalls: 0 },
    costMetadata: input.costMetadata ?? {},
    errorMetadata: input.errorMetadata ?? {},
  };
}
