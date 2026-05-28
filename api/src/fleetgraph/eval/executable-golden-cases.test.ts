// Executes representative FleetGraph golden cases against the shared core with mocked model/persistence.
import { describe, expect, it, vi } from 'vitest';
import { pgResult } from '../../test/pg-result.js';
import { runFleetGraph, type FleetGraphPersistencePort } from '../core.js';
import {
  blockedImportantIssueDedupeKey,
  type FleetGraphFinding,
  type FleetGraphRun,
  type RecordFleetGraphRunInput,
} from '../persistence.js';
import type { FleetGraphInput } from '../types.js';
import type { Principal } from '../../security/principal.js';
import { fleetGraphGoldenCases } from './golden-cases.js';

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
  issue_state: 'blocked',
  issue_priority: 'urgent' as const,
  issue_assignee_id: userId,
  issue_assignee_name: 'Casey Engineer',
  sprint_id: sprintId,
  sprint_title: 'Week 2',
  sprint_number: 2,
  sprint_owner_id: null,
  sprint_owner_name: null,
  project_id: null,
  project_title: null,
  project_owner_id: null,
  project_owner_name: null,
  program_id: null,
  program_title: null,
  program_owner_id: null,
  program_owner_name: null,
  blocker_text: 'Waiting on API credentials.',
  blocker_iteration_id: '66666666-6666-4666-8666-666666666666',
  blocker_iteration_created_at: new Date('2026-05-26T12:00:00Z'),
  dedupeKey,
};

function requireGoldenCase(id: string) {
  const testCase = fleetGraphGoldenCases.find((candidateCase) => candidateCase.id === id);
  if (!testCase) throw new Error(`missing golden case: ${id}`);
  return testCase;
}

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
    title: 'Blocked issue: Blocked issue',
    summary: 'Blocked issue is blocked with a recorded blocker.',
    evidence_snapshot: [{
      kind: 'source_issue',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Source issue is blocked.',
      visibility: 'internal',
      visibleFields: ['title'],
    }, {
      kind: 'blocker',
      sourceDocumentId: issueId,
      sourceType: 'issue',
      claim: 'Latest iteration has blocker text.',
      excerpt: 'Waiting on API credentials.',
      visibility: 'internal',
      visibleFields: ['blockers_encountered'],
    }],
    recommended_action: { requiresHumanApproval: true },
    draft_content: { message: 'Can you confirm the unblock path?' },
    proposed_recipient: { role: 'issue_assignee' },
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
    trigger_reason: 'golden-case',
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
    listFindingsForSource: vi.fn(async () => [existingFinding]),
    listAnchorRuns: vi.fn(async () => []),
    refineDraft: vi.fn(async (input: Parameters<FleetGraphPersistencePort['refineDraft']>[0]) =>
      finding({ draft_content: input.draftContent })
    ),
    dismissFinding: vi.fn(async () => finding({ status: 'dismissed' })),
    resolveFinding: vi.fn(async () => finding({ status: 'resolved' })),
    suppressFinding: vi.fn(async () => finding({ status: 'suppressed' })),
  };
}

function expectSafeTrace(runInput: Parameters<FleetGraphPersistencePort['recordRun']>[0]) {
  const serialized = JSON.stringify(runInput.traceMetadata);
  expect(serialized).not.toMatch(/prompt|completion|authorization|cookie|apiKey|session/i);
}

function requireMockInput<TArgs extends unknown[]>(
  mock: { mock: { calls: TArgs[] } },
  callIndex = 0
): TArgs[0] {
  const input = mock.mock.calls[callIndex]?.[0];
  if (input === undefined) throw new Error(`missing mock call ${callIndex}`);
  return input;
}

describe('FleetGraph executable golden cases', () => {
  it('executes proactive create with mocked model and human gate', async () => {
    const testCase = requireGoldenCase('fg-create-blocked-visible-issue');
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: testCase.mode,
      trigger: {
        type: 'detector_decision',
        detectorDecision: { decision: 'create_finding', candidate, existingFindingId: null },
      },
    }, { persistence: port });

    expect(result.decision).toBe(testCase.expectedDecision);
    expect(result.findingInput?.humanGate).toEqual(expect.objectContaining({ required: true }));
    expect(result.findingInput?.evidenceSnapshot).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'blocker' }),
    ]));
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'create_finding',
      tokenMetadata: { modelCalls: 0 },
    }));
    expectSafeTrace(requireMockInput(vi.mocked(port.recordRun)));
  });

  it('executes duplicate update without creating a second open-finding path', async () => {
    const testCase = requireGoldenCase('fg-update-duplicate-open-finding');
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: testCase.mode,
      trigger: {
        type: 'detector_decision',
        detectorDecision: { decision: 'update_finding', candidate, existingFindingId: findingId },
      },
    }, { persistence: port });

    expect(result.decision).toBe(testCase.expectedDecision);
    expect(port.saveFinding).toHaveBeenCalledTimes(1);
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'update_finding',
      dedupeKey,
    }));
  });

  it('executes restricted-context quiet exit without model calls or finding writes', async () => {
    const testCase = requireGoldenCase('fg-restricted-source-hidden');
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: testCase.mode,
      trigger: { type: 'quiet_exit', quietExits: [{ reason: 'insufficient_visible_evidence', count: 1 }] },
    }, { persistence: port });

    expect(result.decision).toBe(testCase.expectedDecision);
    expect(port.saveFinding).not.toHaveBeenCalled();
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'quiet_exit',
      tokenMetadata: { modelCalls: 0 },
    }));
  });

  it('executes explain existing finding with visible evidence and no model call', async () => {
    const testCase = requireGoldenCase('fg-explain-existing-finding');
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: testCase.mode,
      trigger: { type: 'explain_finding', findingId },
    }, { persistence: port });

    expect(result.decision).toBe(testCase.expectedDecision);
    expect(result.visibleOutput?.summary).toContain('Blocked issue');
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'explain',
      tokenMetadata: { modelCalls: 0 },
    }));
  });

  it('executes dismiss finding as FleetGraph-only status update', async () => {
    const testCase = requireGoldenCase('fg-dismiss-finding');
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: testCase.mode,
      trigger: {
        type: 'dismiss_finding',
        findingId,
        dismissedBy: userId,
      },
    }, { persistence: port });

    expect(result.decision).toBe(testCase.expectedDecision);
    expect(port.saveFinding).not.toHaveBeenCalled();
    expect(port.dismissFinding).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      findingId,
      dismissedBy: userId,
    }));
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'dismiss',
      tokenMetadata: { modelCalls: 0 },
    }));
  });

  it('executes restricted-source hidden case as no-safe-output', async () => {
    const testCase = requireGoldenCase('fg-restricted-source-hidden');
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
      mode: 'on_demand',
      principal,
      trigger: { type: 'explain_finding', findingId },
    } satisfies FleetGraphInput, { persistence: port, db });

    expect(result.decision).toBe(testCase.expectedDecision);
    expect(result.visibleOutput?.noSafeOutput).toBe(true);
    expect(JSON.stringify(result.visibleOutput)).not.toContain('Waiting on API credentials');
    expect(JSON.stringify(result.visibleOutput)).not.toContain(issueId);
  });
});
