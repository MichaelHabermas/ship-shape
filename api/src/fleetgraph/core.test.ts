// Verifies the shared FleetGraph core boundary without real model calls or Ship mutations.
import { describe, expect, it, vi } from 'vitest';
import { pgResult } from '../test/pg-result.js';
import { runFleetGraph, type FleetGraphPersistencePort } from './core.js';
import { filterEvidenceForActor } from './evidence.js';
import {
  blockedImportantIssueDedupeKey,
  type FleetGraphFinding,
  type FleetGraphRun,
  type RecordFleetGraphRunInput,
} from './persistence.js';
import type { Principal } from '../security/principal.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

const principal: Principal = {
  kind: 'session',
  sessionId: 'session-1',
  userId,
  workspaceId,
  isSuperAdmin: false,
};

const candidate = {
  workspace_id: workspaceId,
  issue_id: issueId,
  issue_title: 'Blocked issue',
  issue_ticket_number: 101,
  issue_state: 'in_progress',
  issue_priority: 'urgent' as const,
  issue_assignee_id: userId,
  sprint_id: sprintId,
  sprint_title: 'Week 2',
  sprint_number: 2,
  sprint_owner_id: null,
  blocker_text: 'Waiting on API credentials.',
  blocker_iteration_id: '66666666-6666-4666-8666-666666666666',
  blocker_iteration_created_at: new Date('2026-05-26T12:00:00Z'),
  dedupeKey,
};

function finding(overrides: Partial<FleetGraphFinding> = {}): FleetGraphFinding {
  return {
    id: findingId,
    workspace_id: workspaceId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    dedupe_key: dedupeKey,
    status: 'needs_confirmation',
    severity: 'urgent',
    confidence: 0.86,
    title: 'Blocked active-week work: Blocked issue',
    summary: 'Blocked issue is urgent/high active-week work with a recorded blocker.',
    evidence_snapshot: [{
      kind: 'source_issue',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Source issue is urgent/high active-week work.',
      visibility: 'internal',
      visibleFields: ['title'],
    }],
    recommended_action: {},
    draft_content: { message: 'Can you confirm the unblock path?' },
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
    ...overrides,
  };
}

function run(decision: FleetGraphRun['decision']): FleetGraphRun {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    workspace_id: workspaceId,
    finding_id: findingId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    mode: 'proactive',
    trigger_reason: 'test',
    decision,
    dedupe_key: dedupeKey,
    input_snapshot: {},
    evidence_snapshot: [],
    output_snapshot: {},
    trace_metadata: {},
    token_metadata: {},
    cost_metadata: {},
    error_metadata: {},
    started_at: new Date(),
    completed_at: new Date(),
    created_at: new Date(),
  };
}

function persistence(existingFinding = finding()): FleetGraphPersistencePort {
  return {
    saveFinding: vi.fn(async () => existingFinding),
    recordRun: vi.fn(async (input: RecordFleetGraphRunInput) => run(input.decision)),
    getFinding: vi.fn(async () => existingFinding),
    refineDraft: vi.fn(async (input: Parameters<FleetGraphPersistencePort['refineDraft']>[0]) =>
      finding({ draft_content: input.draftContent })
    ),
    dismissFinding: vi.fn(async () => finding({ status: 'dismissed' })),
    resolveFinding: vi.fn(async () => finding({ status: 'resolved' })),
    suppressFinding: vi.fn(async () => finding({ status: 'suppressed' })),
  };
}

function requireMockInput<TArgs extends unknown[]>(
  mock: { mock: { calls: TArgs[] } },
  callIndex = 0
): TArgs[0] {
  const input = mock.mock.calls[callIndex]?.[0];
  if (input === undefined) throw new Error(`missing mock call ${callIndex}`);
  return input;
}

describe('FleetGraph shared core', () => {
  it('turns a proactive create detector decision into a human-gated finding and run', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: 'proactive',
      trigger: {
        type: 'detector_decision',
        detectorDecision: {
          decision: 'create_finding',
          candidate,
          existingFindingId: null,
        },
      },
    }, { persistence: port });

    expect(result.decision).toBe('create_finding');
    const savedInput = requireMockInput(vi.mocked(port.saveFinding));
    expect(savedInput).toMatchObject({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      status: 'needs_confirmation',
    });
    expect(savedInput.humanGate?.required).toBe(true);
    const runInput = requireMockInput(vi.mocked(port.recordRun));
    expect(runInput).toMatchObject({
      decision: 'create_finding',
      tokenMetadata: { modelCalls: 0 },
    });
    expect(runInput.traceMetadata?.mode).toBe('proactive');
    expect(runInput.traceMetadata?.nodePath).toContain('reasonProactiveCreate');
  });

  it('updates duplicate detector decisions without a second open finding contract', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: 'proactive',
      trigger: {
        type: 'detector_decision',
        detectorDecision: {
          decision: 'update_finding',
          candidate,
          existingFindingId: findingId,
        },
      },
    }, { persistence: port });

    expect(result.decision).toBe('update_finding');
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'update_finding',
      dedupeKey,
    }));
  });

  it('explains existing findings from re-filtered visible evidence without model calls', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: 'on_demand',
      trigger: { type: 'explain_finding', findingId },
    }, { persistence: port });

    expect(result.decision).toBe('explain');
    expect(result.visibleOutput?.summary).toContain('Blocked issue');
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'explain',
      tokenMetadata: { modelCalls: 0 },
    }));
  });

  it('refines only FleetGraph-owned draft state', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: 'on_demand',
      trigger: {
        type: 'refine_draft',
        findingId,
        instruction: 'Make it shorter.',
      },
    }, { persistence: port });

    expect(result.decision).toBe('refine_draft');
    const refineInput = requireMockInput(vi.mocked(port.refineDraft));
    expect(refineInput).toMatchObject({ workspaceId, findingId });
    expect(refineInput.draftContent).toMatchObject({
      refinementInstruction: 'Make it shorter.',
    });
  });

  it('does not refine draft state when the actor cannot read the source issue', async () => {
    const port = persistence();
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(pgResult([{ role: 'member' }]))
        .mockResolvedValueOnce(pgResult([]))
        .mockResolvedValueOnce(pgResult([{ role: 'member' }]))
        .mockResolvedValueOnce(pgResult([{
          id: sprintId,
          title: 'Week 2',
          document_type: 'sprint',
          workspace_id: workspaceId,
          created_by: userId,
          visibility: 'workspace',
          properties: { sprint_number: 2 },
          archived_at: null,
          deleted_at: null,
        }])),
    };

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'refine_draft',
        findingId,
        instruction: 'Reveal the blocker.',
      },
    }, { persistence: port, db });

    expect(result.decision).toBe('quiet_exit');
    expect(result.visibleOutput?.noSafeOutput).toBe(true);
    expect(result.visibleOutput?.draftContent).toBeUndefined();
    expect(port.refineDraft).not.toHaveBeenCalled();
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'quiet_exit',
    }));
  });

  it('restricts output when the current actor cannot read the source issue', async () => {
    const db = {
      query: vi.fn()
        .mockResolvedValueOnce(pgResult([{ role: 'member' }]))
        .mockResolvedValueOnce(pgResult([]))
        .mockResolvedValueOnce(pgResult([{ role: 'member' }]))
        .mockResolvedValueOnce(pgResult([{
          id: sprintId,
          title: 'Week 2',
          document_type: 'sprint',
          workspace_id: workspaceId,
          created_by: userId,
          visibility: 'workspace',
          properties: { sprint_number: 2 },
          archived_at: null,
          deleted_at: null,
        }])),
    };

    const bundle = await filterEvidenceForActor({
      principal,
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      evidence: [{
        kind: 'blocker',
        sourceDocumentId: issueId,
        sourceType: 'issue',
        claim: 'Hidden blocker',
        excerpt: 'secret',
        visibility: 'internal',
        visibleFields: ['blockers_encountered'],
      }],
      db,
    });

    expect(bundle.noSafeOutput).toBe(true);
    expect(bundle.evidence).toEqual([
      expect.objectContaining({
        kind: 'restricted',
        visibility: 'restricted',
        visibleFields: [],
      }),
    ]);
    expect(JSON.stringify(bundle.evidence)).not.toContain('secret');
  });
});
