// Verifies FleetGraph API contract serialization does not leak restricted output.
import { describe, expect, it } from 'vitest';
import {
  fleetGraphManualRunResultResponse,
  fleetGraphRunResponse,
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

describe('FleetGraph API contract', () => {
  it('serializes safe finding output without exposing dedupe keys', () => {
    const response = fleetGraphRunResponse(result());

    expect(response.finding?.id).toBe(findingId);
    expect(response.finding?.visibleOutput.recommendedAction?.label).toBe('Confirm the unblock path');
    expect(response.finding?.visibleOutput.recipientRationale).toContain('issue assignee');
    expect(JSON.stringify(response)).not.toContain('blocked-important-issue');
    expect(JSON.stringify(response)).not.toContain('hidden-user');
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
});
