// Verifies FleetGraph API contract serialization does not leak restricted output.
import { describe, expect, it } from 'vitest';
import {
  FleetGraphChatContextSchema,
  FleetGraphReviewerChainsResponseSchema,
  fleetGraphManualRunResultResponse,
  fleetGraphRunResponse,
  sendFleetGraphChangeSummaryResponse,
  fleetGraphFindingIsSafeToSerialize,
  serializeFleetGraphVisibleOutput,
} from './api-contract.js';
import type { FleetGraphFinding } from './persistence.js';
import type { FleetGraphResult, FleetGraphVisibleOutput } from './types.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';

function finding(): FleetGraphFinding {
  return {
    id: findingId,
    workspace_id: workspaceId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    dedupe_key: `blocked-important-issue:${workspaceId}:${issueId}:${sprintId}`,
    status: 'needs_confirmation',
    severity: 'urgent',
    confidence: 0.86,
    title: 'Blocked work',
    summary: 'Visible summary',
    evidence_snapshot: [],
    recommended_action: {},
    draft_content: {},
    proposed_recipient: {},
    human_gate: { required: true },
    trace_metadata: {},
    run_metadata: {},
    first_detected_at: new Date(),
    last_detected_at: new Date(),
    resolved_at: null,
    dismissed_at: null,
    dismissed_by: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function visibleOutput(overrides: Partial<FleetGraphVisibleOutput> = {}): FleetGraphVisibleOutput {
  return {
    title: 'Blocked work',
    summary: 'Visible summary',
    severity: 'urgent',
    confidence: 0.86,
    recommendedAction: { label: 'Confirm the unblock path', internalTargetUserId: 'hidden-user' },
    recipientRationale: 'Recipient is the issue assignee, falling back to the sprint owner.',
    uncertaintyNotes: ['A human must confirm the current unblock path.'],
    evidence: [{
      kind: 'source_issue',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Visible claim',
      visibility: 'actor_visible',
      visibleFields: ['title'],
    }],
    humanGate: { required: true },
    ...overrides,
  };
}

function result(output = visibleOutput()): FleetGraphResult {
  return {
    decision: 'explain',
    finding: finding(),
    run: {} as never,
    runInput: {} as never,
    visibleOutput: output,
    evidence: output.evidence,
    traceMetadata: { mode: 'on_demand', decision: 'explain', nodePath: ['produceOutput'] },
    tokenMetadata: { modelCalls: 0 },
    costMetadata: {},
    errorMetadata: {},
  };
}

function changeResult(): FleetGraphResult {
  return {
    ...result(),
    decision: 'summarize_changes',
    changeSummary: {
      headline: 'Priority raised',
      rows: [
        { label: 'Changed', text: 'Priority High -> Urgent.' },
        { label: 'Not done', text: 'No issue changed. No message sent.' },
      ],
    },
    traceMetadata: { mode: 'on_demand', decision: 'summarize_changes', nodePath: ['compareAnchor'] },
  };
}

describe('FleetGraph API contract', () => {
  it('serializes safe finding output without exposing dedupe keys', () => {
    const response = fleetGraphRunResponse(result());

    expect(response.finding?.id).toBe(findingId);
    expect(response.finding?.kind).toBe('blocker');
    expect(response.finding?.visibleOutput.recommendedAction?.label).toBe('Confirm the unblock path');
    expect(response.finding?.visibleOutput.recipientRationale).toContain('issue assignee');
    expect(JSON.stringify(response)).not.toContain('blocked-important-issue');
    expect(JSON.stringify(response)).not.toContain('hidden-user');
  });

  it('omits usage metadata when no model calls were recorded', () => {
    const response = fleetGraphRunResponse(result());
    expect(response.usageMetadata).toBeUndefined();
    expect('usageMetadata' in response).toBe(false);
  });

  it('omits usage metadata when graph result metadata fields are absent', () => {
    const partial = result();
    const response = fleetGraphRunResponse({
      ...partial,
      tokenMetadata: undefined as never,
      costMetadata: undefined as never,
    });
    expect(response.usageMetadata).toBeUndefined();
  });

  it('serializes safe usage metadata on run responses', () => {
    const response = fleetGraphRunResponse({
      ...result(),
      tokenMetadata: {
        modelCalls: 1,
        inputTokens: 100,
        cachedInputTokens: 10,
        billableInputTokens: 90,
        outputTokens: 20,
        totalTokens: 120,
        usageSource: 'model_response',
      },
      costMetadata: {
        estimatedCostUsd: 0.00012,
        inputCostUsd: 0.00009,
        outputCostUsd: 0.00003,
        currency: 'USD',
        costSource: 'catalog_estimate',
      },
    });

    expect(response.usageMetadata).toEqual({
      modelCalls: 1,
      inputTokens: 100,
      cachedInputTokens: 10,
      billableInputTokens: 90,
      outputTokens: 20,
      totalTokens: 120,
      estimatedCostUsd: 0.00012,
      costCurrency: 'USD',
      usageSource: 'model_response',
      costSource: 'catalog_estimate',
    });
  });

  it('treats no-safe-output findings as unsafe to serialize', () => {
    const restricted = result(visibleOutput({ noSafeOutput: true, evidence: [] }));

    expect(fleetGraphFindingIsSafeToSerialize(restricted)).toBe(false);
    expect(fleetGraphRunResponse(restricted).finding).toBeUndefined();
    expect(fleetGraphManualRunResultResponse(restricted).findingId).toBeUndefined();
    expect(fleetGraphManualRunResultResponse(restricted).visibleOutput).toBeUndefined();
  });

  it('copies visible field arrays when serializing output', () => {
    const output = visibleOutput();
    const serialized = serializeFleetGraphVisibleOutput(output);

    serialized.evidence[0]?.visibleFields.push('state');

    expect(output.evidence[0]?.visibleFields).toEqual(['title']);
  });

  it('serializes change summaries without finding internals', () => {
    const json = viResponseJson();
    sendFleetGraphChangeSummaryResponse(json.res as never, changeResult());

    expect(json.statusCode).toBe(200);
    expect(json.body).toMatchObject({
      headline: 'Priority raised',
      rows: [
        { label: 'Changed', text: 'Priority High -> Urgent.' },
        { label: 'Not done', text: 'No issue changed. No message sent.' },
      ],
      traceMetadata: { decision: 'summarize_changes' },
    });
    expect(JSON.stringify(json.body)).not.toContain('blocked-important-issue');
  });

  it('accepts bounded page context without a document id', () => {
    const parsed = FleetGraphChatContextSchema.parse({
      kind: 'workspace',
      sourcePath: '/issues?state=blocked',
      pageContext: {
        route: '/issues?state=blocked',
        surface: 'issues_list',
        title: 'Issues',
        filters: { state: 'blocked' },
        counts: { total: 30, filtered: 12, selected: 2 },
        visibleItems: Array.from({ length: 25 }, (_, index) => ({
          kind: 'issue',
          id: index < 2 ? [issueId, sprintId][index] : undefined,
          title: `Issue ${index + 1}`,
        })),
        selectedItemIds: [issueId, sprintId],
      },
    });

    expect(parsed.pageContext?.visibleItems).toHaveLength(25);
    expect(() => FleetGraphChatContextSchema.parse({
      kind: 'workspace',
      pageContext: {
        route: '/issues',
        surface: 'issues_list',
        title: 'Issues',
        visibleItems: Array.from({ length: 26 }, (_, index) => ({ kind: 'issue', title: `Issue ${index}` })),
      },
    })).toThrow();
  });

  it('accepts reviewer chains while preserving safe visible output only', () => {
    const parsed = FleetGraphReviewerChainsResponseSchema.parse({
      summary: {
        generatedAt: '2026-05-29T00:00:00.000Z',
        status: 'broken',
        chainCount: 1,
        completeCount: 0,
        brokenCount: 1,
        requiredGates: [{ name: 'traceUrl', passed: false, value: null, comment: 'Trace URL missing.' }],
        costSummary: { modelCalls: 0, costCurrency: 'USD' },
      },
      chains: [{
        chainId: findingId,
        scenario: 'week-blocker',
        status: 'broken',
        missing: ['trace_quality'],
        generatedAt: '2026-05-29T00:00:00.000Z',
        freshness: {
          generatedAt: '2026-05-29T00:00:00.000Z',
          newestRunAt: null,
          newestWorkerTickAt: null,
          proofAgeMs: null,
          workerAgeMs: null,
        },
        latencyMs: {},
        links: { runId: issueId },
        steps: [{
          key: 'trace',
          label: 'Trace',
          status: 'broken',
          at: null,
          evidence: 'Trace URL missing',
        }],
        humanGate: { required: false, state: 'missing', allowedActions: [] },
        traceQuality: {
          passed: false,
          requiredDecisions: ['create_finding'],
          observedDecisions: ['quiet_exit'],
          scores: [{ name: 'createTraceNotQuiet', passed: false, value: 'quiet_exit', comment: 'Quiet exit cannot prove create.' }],
        },
        sourceMutationCheck: { passed: true, before: {}, after: {}, changedFields: [] },
        usageSummary: { modelCalls: 0, costCurrency: 'USD' },
      }],
    });

    expect(parsed.chains[0]?.status).toBe('broken');
    expect(JSON.stringify(parsed)).not.toContain('dedupe');
    expect(JSON.stringify(parsed)).not.toContain('rawPrompt');
  });
});

function viResponseJson() {
  const result = {
    statusCode: 200,
    body: undefined as unknown,
    res: {
      status(code: number) {
        result.statusCode = code;
        return this;
      },
      json(body: unknown) {
        result.body = body;
        return this;
      },
    },
  };
  return result;
}
