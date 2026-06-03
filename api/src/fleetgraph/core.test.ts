// Verifies the shared FleetGraph core boundary without real model calls or Ship mutations.
import { resetChatOpenAIMock } from './test/setup-chat-openai-mock.js';
import type { FleetGraphEvidenceItem } from '@ship/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../db/client.js';
import { pgResult } from '../test/pg-result.js';
import { runFleetGraph, shouldAutoCaptureTrace, type FleetGraphPersistencePort } from './core.js';
import { evidenceFromDetectorCandidate, filterEvidenceForActor, visibleOutputForFinding } from './evidence.js';
import type { FleetGraphAttentionCandidate } from './detection/detector.js';
import {
  blockedImportantIssueDedupeKey,
  type FleetGraphFinding,
  type FleetGraphRunRow,
  type RecordFleetGraphRunInput,
} from './persistence.js';
import type { Principal } from '../security/principal.js';
import type { ShipClient } from '@ship/sdk';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const dedupeKey = blockedImportantIssueDedupeKey({ workspaceId, issueId, sprintId });

type TestQueryRunner = Pick<typeof pool, 'query'>;

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
} satisfies FleetGraphAttentionCandidate;

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

function run(decision: FleetGraphRunRow['decision'], outputSnapshot: FleetGraphRunRow['output_snapshot'] = {}): FleetGraphRunRow {
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
    output_snapshot: outputSnapshot,
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

function requireMockInput<TArgs extends unknown[]>(
  mock: { mock: { calls: TArgs[] } },
  callIndex = 0
): TArgs[0] {
  const input = mock.mock.calls[callIndex]?.[0];
  if (input === undefined) throw new Error(`missing mock call ${callIndex}`);
  return input;
}

function readableSourceDb() {
  return {
    query: vi.fn()
      .mockResolvedValueOnce(pgResult([{ role: 'member' }]))
      .mockResolvedValueOnce(pgResult([{
        id: issueId,
        title: 'Blocked issue',
        document_type: 'issue',
        workspace_id: workspaceId,
        created_by: userId,
        visibility: 'workspace',
        properties: { priority: 'urgent', state: 'in_progress' },
        archived_at: null,
        deleted_at: null,
      }]))
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
}

function contextChatDb(): TestQueryRunner {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('workspace_memberships')) {
        return pgResult([{ role: 'member' }]);
      }
      if (sql.includes('document_associations')) {
        return pgResult([]);
      }
      if (sql.includes('FROM documents')) {
        const documentId = String(params?.[0] ?? '');
        if (documentId === issueId) {
          return pgResult([{
            id: issueId,
            title: 'Blocked issue',
            document_type: 'issue',
            properties: { priority: 'urgent', state: 'in_progress' },
            content: null,
            yjs_state: null,
          }]);
        }
        if (documentId === sprintId) {
          return pgResult([{
            id: sprintId,
            title: 'Week 2',
            document_type: 'sprint',
            properties: { sprint_number: 2 },
            content: null,
            yjs_state: null,
          }]);
        }
        return pgResult([]);
      }
      return pgResult([{ role: 'member' }]);
    }) as unknown as TestQueryRunner['query'],
  };
}

function restrictedSourceDb() {
  return {
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
}

function restrictedSprintDb() {
  return {
    query: vi.fn()
      .mockResolvedValueOnce(pgResult([{ role: 'member' }]))
      .mockResolvedValueOnce(pgResult([{
        id: issueId,
        title: 'Blocked issue',
        document_type: 'issue',
        workspace_id: workspaceId,
        created_by: userId,
        visibility: 'workspace',
        properties: { priority: 'urgent', state: 'in_progress' },
        archived_at: null,
        deleted_at: null,
      }]))
      .mockResolvedValueOnce(pgResult([{ role: 'member' }]))
      .mockResolvedValueOnce(pgResult([])),
  };
}

describe('FleetGraph shared core', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.FLEETGRAPH_MODEL = 'gpt-4o-mini';
    resetChatOpenAIMock();
  });

  it('does not auto-trace scheduled worker quiet exits', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousLangSmithTracing = process.env.LANGSMITH_TRACING;
    const previousFleetGraphTracing = process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;

    process.env.NODE_ENV = 'production';
    process.env.LANGSMITH_TRACING = 'true';
    process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = 'true';

    try {
      expect(shouldAutoCaptureTrace({
        workspaceId,
        mode: 'proactive',
        trigger: { type: 'quiet_exit', quietExits: [] },
        triggerReason: 'scheduled-worker',
      }, {})).toBe(false);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousLangSmithTracing === undefined) {
        delete process.env.LANGSMITH_TRACING;
      } else {
        process.env.LANGSMITH_TRACING = previousLangSmithTracing;
      }
      if (previousFleetGraphTracing === undefined) {
        delete process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
      } else {
        process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = previousFleetGraphTracing;
      }
    }
  });

  it('keeps auto-tracing enabled for useful production FleetGraph runs', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousLangSmithTracing = process.env.LANGSMITH_TRACING;
    const previousFleetGraphTracing = process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;

    process.env.NODE_ENV = 'production';
    process.env.LANGSMITH_TRACING = 'true';
    process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = 'true';

    try {
      expect(shouldAutoCaptureTrace({
        workspaceId,
        mode: 'proactive',
        trigger: {
          type: 'detector_decision',
          detectorDecision: { decision: 'create_finding', candidate, existingFindingId: null },
        },
        triggerReason: 'scheduled-worker',
      }, {})).toBe(true);
      expect(shouldAutoCaptureTrace({
        workspaceId,
        mode: 'proactive',
        trigger: { type: 'quiet_exit', quietExits: [] },
        triggerReason: 'trace_smoke',
      }, {})).toBe(true);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousLangSmithTracing === undefined) {
        delete process.env.LANGSMITH_TRACING;
      } else {
        process.env.LANGSMITH_TRACING = previousLangSmithTracing;
      }
      if (previousFleetGraphTracing === undefined) {
        delete process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
      } else {
        process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = previousFleetGraphTracing;
      }
    }
  });

  it('does not auto-trace in-memory evaluation runs', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousLangSmithTracing = process.env.LANGSMITH_TRACING;
    const previousFleetGraphTracing = process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;

    process.env.NODE_ENV = 'production';
    process.env.LANGSMITH_TRACING = 'true';
    process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = 'true';

    try {
      expect(shouldAutoCaptureTrace({
        workspaceId,
        mode: 'proactive',
        trigger: {
          type: 'detector_decision',
          detectorDecision: { decision: 'create_finding', candidate, existingFindingId: null },
        },
      }, { persistence: persistence() })).toBe(false);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousLangSmithTracing === undefined) {
        delete process.env.LANGSMITH_TRACING;
      } else {
        process.env.LANGSMITH_TRACING = previousLangSmithTracing;
      }
      if (previousFleetGraphTracing === undefined) {
        delete process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
      } else {
        process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = previousFleetGraphTracing;
      }
    }
  });

  it('allows reviewer-forced tracing without enabling global FleetGraph tracing', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFleetGraphTracing = process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
    const previousReviewerTracing = process.env.FLEETGRAPH_REVIEWER_TRACING_ENABLED;
    const previousLangfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const previousLangfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;

    process.env.NODE_ENV = 'production';
    process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = 'false';
    process.env.FLEETGRAPH_REVIEWER_TRACING_ENABLED = 'true';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';

    try {
      const input = {
        workspaceId,
        mode: 'proactive' as const,
        trigger: {
          type: 'detector_decision' as const,
          detectorDecision: { decision: 'create_finding' as const, candidate, existingFindingId: null },
        },
        triggerReason: 'reviewer-week-blocker-scenario',
      };

      expect(shouldAutoCaptureTrace(input, {})).toBe(false);
      expect(shouldAutoCaptureTrace(input, { forceReviewerTrace: true })).toBe(true);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousFleetGraphTracing === undefined) {
        delete process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
      } else {
        process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = previousFleetGraphTracing;
      }
      if (previousReviewerTracing === undefined) {
        delete process.env.FLEETGRAPH_REVIEWER_TRACING_ENABLED;
      } else {
        process.env.FLEETGRAPH_REVIEWER_TRACING_ENABLED = previousReviewerTracing;
      }
      if (previousLangfusePublicKey === undefined) {
        delete process.env.LANGFUSE_PUBLIC_KEY;
      } else {
        process.env.LANGFUSE_PUBLIC_KEY = previousLangfusePublicKey;
      }
      if (previousLangfuseSecretKey === undefined) {
        delete process.env.LANGFUSE_SECRET_KEY;
      } else {
        process.env.LANGFUSE_SECRET_KEY = previousLangfuseSecretKey;
      }
    }
  });

  it('allows reviewer-forced tracing without a separate reviewer env flag', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFleetGraphTracing = process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
    const previousReviewerTracing = process.env.FLEETGRAPH_REVIEWER_TRACING_ENABLED;
    const previousLangfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const previousLangfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;

    process.env.NODE_ENV = 'production';
    process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = 'false';
    delete process.env.FLEETGRAPH_REVIEWER_TRACING_ENABLED;
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';

    try {
      const input = {
        workspaceId,
        mode: 'proactive' as const,
        trigger: {
          type: 'detector_decision' as const,
          detectorDecision: { decision: 'create_finding' as const, candidate, existingFindingId: null },
        },
        triggerReason: 'reviewer-week-blocker-scenario',
      };

      expect(shouldAutoCaptureTrace(input, {})).toBe(false);
      expect(shouldAutoCaptureTrace(input, { forceReviewerTrace: true })).toBe(true);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousFleetGraphTracing === undefined) {
        delete process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
      } else {
        process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = previousFleetGraphTracing;
      }
      if (previousReviewerTracing === undefined) {
        delete process.env.FLEETGRAPH_REVIEWER_TRACING_ENABLED;
      } else {
        process.env.FLEETGRAPH_REVIEWER_TRACING_ENABLED = previousReviewerTracing;
      }
      if (previousLangfusePublicKey === undefined) {
        delete process.env.LANGFUSE_PUBLIC_KEY;
      } else {
        process.env.LANGFUSE_PUBLIC_KEY = previousLangfusePublicKey;
      }
      if (previousLangfuseSecretKey === undefined) {
        delete process.env.LANGFUSE_SECRET_KEY;
      } else {
        process.env.LANGFUSE_SECRET_KEY = previousLangfuseSecretKey;
      }
    }
  });

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
    }, { persistence: port, db: readableSourceDb() });

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

  it('routes blocked issue findings to the smallest connected Ship audience', async () => {
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
    }, { persistence: port, db: readableSourceDb() });

    expect(result.visibleOutput?.proposedRecipient).toMatchObject({
      role: 'issue_assignee',
      userId,
      displayName: 'Casey Engineer',
    });
    expect(result.visibleOutput?.recommendedAction?.text).toBe('Ask Casey Engineer to confirm owner and next step for Week 2.');
  });

  it('routes missing blocker text to project owner before assignee', async () => {
    const port = persistence();
    const projectOwnerCandidate = {
      ...candidate,
      blocker_text: '',
      issue_assignee_id: userId,
      issue_assignee_name: 'Casey Engineer',
      project_owner_id: '88888888-8888-4888-8888-888888888888',
      project_owner_name: 'Morgan PM',
    };

    const result = await runFleetGraph({
      workspaceId,
      mode: 'proactive',
      trigger: {
        type: 'detector_decision',
        detectorDecision: {
          decision: 'create_finding',
          candidate: projectOwnerCandidate,
          existingFindingId: null,
        },
      },
    }, { persistence: port, db: readableSourceDb() });

    expect(result.visibleOutput?.proposedRecipient).toMatchObject({
      role: 'project_owner',
      userId: '88888888-8888-4888-8888-888888888888',
      displayName: 'Morgan PM',
    });
    expect(result.visibleOutput?.recommendedAction?.text).toBe('Ask Morgan PM to add the blocker reason.');
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
    }, { persistence: port, db: readableSourceDb() });

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
      principal,
      mode: 'on_demand',
      trigger: { type: 'explain_finding', findingId },
    }, { persistence: port, db: readableSourceDb() });

    expect(result.decision).toBe('explain');
    expect(result.visibleOutput?.summary).toContain('Blocked issue');
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({ decision: 'explain' }));
    expect(requireMockInput(vi.mocked(port.recordRun)).tokenMetadata).toMatchObject({ modelCalls: 0 });
  });

  it('records caller-provided external trace identity in run metadata', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: { type: 'explain_finding', findingId },
    }, {
      persistence: port,
      db: readableSourceDb(),
      externalTrace: {
        traceId: '88888888-8888-4888-8888-888888888888',
        traceUrl: 'https://smith.langchain.com/public/trace-id/r',
      },
    });

    expect(result.traceMetadata).toMatchObject({
      traceId: '88888888-8888-4888-8888-888888888888',
      traceUrl: 'https://smith.langchain.com/public/trace-id/r',
    });
    const runInput = requireMockInput(vi.mocked(port.recordRun));
    expect(runInput.traceMetadata).toMatchObject({
      traceId: '88888888-8888-4888-8888-888888888888',
      traceUrl: 'https://smith.langchain.com/public/trace-id/r',
    });
  });

  it('answers typed notification chat through the model path with human gate', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: 'Who can unblock this?',
        context: {
          kind: 'notification',
          findingId,
          sourcePath: `/documents/${issueId}`,
        },
      },
    }, { persistence: port, db: contextChatDb() });

    expect(result.decision).toBe('needs_confirmation');
    expect(result.visibleOutput?.summary).toContain('Blocked issue');
    expect(result.traceMetadata.nodePath).toContain('contextChat');
    expect(port.getFinding).toHaveBeenCalledWith(workspaceId, findingId);
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'needs_confirmation',
      triggerReason: 'context_chat',
      inputSnapshot: { triggerType: 'context_chat' },
    }));
    expect(requireMockInput(vi.mocked(port.recordRun)).tokenMetadata).toMatchObject({ modelCalls: 1 });
  });

  it('answers natural current-context prompts from an attached finding', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: "What's happening here?",
        context: {
          kind: 'document',
          documentId: issueId,
          sourcePath: `/documents/${issueId}`,
        },
      },
    }, { persistence: port, db: contextChatDb() });

    expect(result.decision).toBe('explain');
    expect(result.visibleOutput?.summary).toContain('Blocked issue');
    expect(port.listFindingsForSource).toHaveBeenCalledWith({ workspaceId, sourceIssueId: issueId });
  });

  it('treats a greeting as chat, not a request for the finding summary', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: 'hi',
        context: {
          kind: 'notification',
          findingId,
          sourcePath: `/documents/${issueId}`,
        },
      },
    }, { persistence: port, db: contextChatDb() });

    expect(result.decision).toBe('explain');
    const runInput = requireMockInput(vi.mocked(port.recordRun));
    const answerBody = (runInput.outputSnapshot as { answer?: { body?: string } }).answer?.body ?? '';
    expect(answerBody).toMatch(/what would you like to talk about/i);
    expect(answerBody).not.toMatch(/cleanup debt|sample integration approval/i);
    expect(requireMockInput(vi.mocked(port.recordRun)).tokenMetadata).toMatchObject({ modelCalls: 1 });
  });

  it('answers broad-but-context-bound chat from the document instead of the signal template', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: 'What else is weird in this project?',
        context: {
          kind: 'notification',
          findingId,
          sourcePath: `/documents/${issueId}`,
        },
      },
    }, { persistence: port, db: contextChatDb() });

    expect(result.decision).toBe('explain');
    const runInput = requireMockInput(vi.mocked(port.recordRun));
    expect(runInput.outputSnapshot).toMatchObject({
      answer: {
        title: 'Blocked issue',
      },
    });
    expect(JSON.stringify(runInput.outputSnapshot)).not.toContain('From this attached context');
  });

  it('changes shape when the user asks for a simpler summary', async () => {
    const port = persistence();

    await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: 'Summarize it simpler.',
        context: {
          kind: 'document',
          documentId: issueId,
          sourcePath: `/documents/${issueId}`,
        },
      },
    }, { persistence: port, db: contextChatDb() });

    const runInput = requireMockInput(vi.mocked(port.recordRun));
    expect(runInput.outputSnapshot).toMatchObject({
      answer: {
        title: 'Blocked issue',
      },
    });
    const answerBody = JSON.stringify(runInput.outputSnapshot);
    expect(answerBody).toMatch(/sample integration approval|Blocked issue/i);
    expect(answerBody).not.toContain('It is connected to');
  });

  it('answers from a readable document when no finding is attached', async () => {
    const port = persistence();
    vi.mocked(port.listFindingsForSource).mockResolvedValue([]);

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: 'What should I do next?',
        context: {
          kind: 'document',
          documentId: issueId,
          sourcePath: `/documents/${issueId}`,
        },
      },
    }, { persistence: port, db: contextChatDb() });

    expect(result.decision).toBe('needs_confirmation');
    expect(result.visibleOutput).toBeUndefined();
    const runInput = requireMockInput(vi.mocked(port.recordRun));
    expect(runInput.outputSnapshot).toMatchObject({
      answer: {
        title: 'Blocked issue',
      },
    });
  });

  it('keeps one model call when chat source reads use the public SDK', async () => {
    const port = persistence();
    vi.mocked(port.listFindingsForSource).mockResolvedValue([]);
    const db = contextChatDb();
    const publicDocumentGet = vi.fn(async () => ({
      id: issueId,
      workspace_id: workspaceId,
      document_type: 'issue' as const,
      title: 'Blocked issue',
      parent_id: null,
      ticket_number: 101,
      properties: { priority: 'urgent', state: 'in_progress' },
      content: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: userId,
      visibility: 'workspace' as const,
    }));
    const publicSourceClient = {
      documents: {
        get: publicDocumentGet,
      },
    } as unknown as ShipClient;

    await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: 'What should I do next?',
        context: {
          kind: 'document',
          documentId: issueId,
          sourcePath: `/documents/${issueId}`,
        },
      },
    }, { persistence: port, db, publicSourceClient });

    expect(publicDocumentGet).toHaveBeenCalledWith(issueId);
    expect(vi.mocked(db.query).mock.calls.map(([sql]) => String(sql)).join('\n')).not.toContain('FROM documents');
    expect(requireMockInput(vi.mocked(port.recordRun)).tokenMetadata).toMatchObject({ modelCalls: 1 });
  });

  it('enriches page context through authorized visible item ids only', async () => {
    const port = persistence();
    vi.mocked(port.listFindingsForSource).mockResolvedValue([]);

    await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: 'What am I looking at?',
        context: {
          kind: 'workspace',
          sourcePath: '/issues',
          pageContext: {
            route: '/issues',
            surface: 'issues_list',
            title: 'Issues',
            visibleItems: [
              { kind: 'issue', id: issueId, title: 'Blocked issue' },
              { kind: 'issue', id: '77777777-7777-4777-8777-777777777777', title: 'Hidden issue' },
            ],
            selectedItemIds: [issueId],
          },
        },
      },
    }, { persistence: port, db: contextChatDb() });

    const runInput = requireMockInput(vi.mocked(port.recordRun));
    expect(runInput.outputSnapshot).toMatchObject({
      answer: {
        title: 'Blocked issue',
      },
    });
    expect(JSON.stringify(runInput.outputSnapshot)).toContain('"label":"Current issues list page","kind":"issues_list"');
    expect(JSON.stringify(runInput.outputSnapshot)).toContain('"label":"Blocked issue","kind":"issue"');
    expect(JSON.stringify(runInput.outputSnapshot)).not.toContain('Hidden issue');
  });

  it('preserves process-level LangSmith env flags during graph runs', async () => {
    const port = persistence();
    const previousLangSmithTracing = process.env.LANGSMITH_TRACING;
    const previousLangChainTracing = process.env.LANGCHAIN_TRACING_V2;
    const previousFleetGraphTracing = process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGCHAIN_TRACING_V2 = 'true';
    process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = 'true';

    try {
      await runFleetGraph({
        workspaceId,
        principal,
        mode: 'on_demand',
        trigger: { type: 'explain_finding', findingId },
      }, { persistence: port, db: readableSourceDb() });

      expect(process.env.LANGSMITH_TRACING).toBe('true');
      expect(process.env.LANGCHAIN_TRACING_V2).toBe('true');
      expect(process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED).toBe('true');
    } finally {
      if (previousLangSmithTracing === undefined) {
        delete process.env.LANGSMITH_TRACING;
      } else {
        process.env.LANGSMITH_TRACING = previousLangSmithTracing;
      }
      if (previousLangChainTracing === undefined) {
        delete process.env.LANGCHAIN_TRACING_V2;
      } else {
        process.env.LANGCHAIN_TRACING_V2 = previousLangChainTracing;
      }
      if (previousFleetGraphTracing === undefined) {
        delete process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
      } else {
        process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = previousFleetGraphTracing;
      }
    }
  });

  it('records trace capture failures in run error metadata', async () => {
    const port = persistence();

    await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: { type: 'explain_finding', findingId },
    }, {
      persistence: port,
      db: readableSourceDb(),
      observabilityError: 'LangSmith shareRun timed out',
    });

    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      errorMetadata: {
        observability: {
          traceCapture: 'failed',
          message: 'LangSmith shareRun timed out',
        },
      },
    }));
  });

  it('records caller-provided external trace identity for resolve runs', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      mode: 'on_demand',
      trigger: { type: 'resolve_finding', findingId },
    }, {
      persistence: port,
      externalTrace: {
        traceId: '99999999-9999-4999-8999-999999999999',
        traceUrl: 'https://smith.langchain.com/public/resolve-trace/r',
      },
    });

    expect(result.decision).toBe('resolve');
    expect(result.traceMetadata).toMatchObject({
      traceId: '99999999-9999-4999-8999-999999999999',
      traceUrl: 'https://smith.langchain.com/public/resolve-trace/r',
    });
    const runInput = requireMockInput(vi.mocked(port.recordRun));
    expect(runInput.traceMetadata).toMatchObject({
      traceId: '99999999-9999-4999-8999-999999999999',
      traceUrl: 'https://smith.langchain.com/public/resolve-trace/r',
    });
  });

  it('summarizes only anchored meaningful changes', async () => {
    const currentFinding = finding({
      summary: 'Blocked issue is blocked with a recorded blocker: Waiting on API credentials.',
      severity: 'urgent',
      recommended_action: { label: 'Confirm the unblock path' },
    });
    const port = persistence(currentFinding);
    vi.mocked(port.listAnchorRuns).mockResolvedValue([
      run('update_finding', {
        title: currentFinding.title,
        summary: currentFinding.summary,
        severity: 'urgent',
        recommendedAction: { label: 'Confirm the unblock path' },
        evidence: [],
        humanGate: { required: true },
      }),
      run('create_finding', {
        title: currentFinding.title,
        summary: 'Blocked issue is high active-week work with a recorded blocker: Waiting on security approval.',
        severity: 'high',
        recommendedAction: { label: 'Confirm the unblock path' },
        evidence: [],
        humanGate: { required: true },
      }),
    ]);

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: { type: 'summarize_changes', findingId },
    }, { persistence: port, db: readableSourceDb() });

    expect(result.decision).toBe('summarize_changes');
    expect(result.changeSummary).toEqual({
      headline: 'Waiting on API credentials',
      rows: [
        { label: 'Now', text: 'Waiting on API credentials' },
        { label: 'Changed', text: 'Priority High -> Urgent.' },
        { label: 'Not done', text: 'No issue changed. No message sent.' },
      ],
    });
    expect(result.traceMetadata.nodePath).toContain('compareAnchor');
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'summarize_changes',
      outputSnapshot: result.changeSummary,
    }));
  });

  it('refines only FleetGraph-owned draft state', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'refine_draft',
        findingId,
        instruction: 'Make it shorter.',
      },
    }, { persistence: port, db: readableSourceDb() });

    expect(result.decision).toBe('refine_draft');
    const refineInput = requireMockInput(vi.mocked(port.refineDraft));
    expect(refineInput).toMatchObject({ workspaceId, findingId });
    expect(refineInput.draftContent).toMatchObject({
      refinementInstruction: 'Make it shorter.',
    });
  });

  it('does not refine draft state when the actor cannot read the source issue', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'refine_draft',
        findingId,
        instruction: 'Reveal the blocker.',
      },
    }, { persistence: port, db: restrictedSourceDb() });

    expect(result.decision).toBe('quiet_exit');
    expect(result.visibleOutput?.noSafeOutput).toBe(true);
    expect(result.visibleOutput?.draftContent).toBeUndefined();
    expect(port.refineDraft).not.toHaveBeenCalled();
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'quiet_exit',
    }));
  });

  it('does not dismiss a finding when the actor cannot read the source issue', async () => {
    const port = persistence();

    const result = await runFleetGraph({
      workspaceId,
      principal,
      mode: 'on_demand',
      trigger: {
        type: 'dismiss_finding',
        findingId,
        dismissedBy: userId,
      },
    }, { persistence: port, db: restrictedSourceDb() });

    expect(result.decision).toBe('quiet_exit');
    expect(result.visibleOutput?.noSafeOutput).toBe(true);
    expect(port.dismissFinding).not.toHaveBeenCalled();
    expect(port.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'quiet_exit',
    }));
  });

  it('returns a not-found error before dismiss mutation when a finding is missing', async () => {
    const port = persistence();
    vi.mocked(port.getFinding).mockResolvedValueOnce(null);

    const result = await runFleetGraph({
      workspaceId,
      mode: 'on_demand',
      trigger: {
        type: 'dismiss_finding',
        findingId,
        dismissedBy: userId,
      },
    }, { persistence: port });

    expect(result.decision).toBe('error');
    expect(result.errorMetadata.category).toBe('not_found');
    expect(port.dismissFinding).not.toHaveBeenCalled();
  });

  it('returns an error instead of dismiss success when the status update affects no row', async () => {
    const port = persistence();
    vi.mocked(port.dismissFinding).mockResolvedValueOnce(null);

    const result = await runFleetGraph({
      workspaceId,
      mode: 'on_demand',
      trigger: {
        type: 'dismiss_finding',
        findingId,
        dismissedBy: userId,
      },
    }, { persistence: port });

    expect(result.decision).toBe('error');
    expect(result.errorMetadata.category).toBe('not_found');
    expect(port.recordRun).toHaveBeenLastCalledWith(expect.objectContaining({
      decision: 'error',
    }));
  });

  it('restricts output when the current actor cannot read the source issue', async () => {
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
      db: restrictedSourceDb(),
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

  it('restricts output when the current actor cannot read the source sprint', async () => {
    const bundle = await filterEvidenceForActor({
      principal,
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      evidence: evidenceFromDetectorCandidate(candidate),
      db: restrictedSprintDb(),
    });

    expect(bundle.noSafeOutput).toBe(true);
    expect(JSON.stringify(bundle.evidence)).not.toContain(sprintId);
    expect(JSON.stringify(bundle.evidence)).not.toContain(dedupeKey);
  });

  it('strips dedupe evidence before actor-visible output', async () => {
    const bundle = await filterEvidenceForActor({
      principal,
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      evidence: evidenceFromDetectorCandidate(candidate),
      db: readableSourceDb(),
    });

    expect(bundle.noSafeOutput).toBe(false);
    expect(bundle.evidence.some((item: FleetGraphEvidenceItem) => item.kind === 'dedupe')).toBe(false);
    expect(JSON.stringify(bundle.evidence)).not.toContain(dedupeKey);
  });

  it('maps persisted finding fields into safe visible output', async () => {
    const { output } = await visibleOutputForFinding({
      workspaceId,
      finding: finding({
        recommended_action: { label: 'Confirm the unblock path', internalTargetUserId: 'hidden-user' },
        proposed_recipient: { role: 'issue_assignee', userId, displayName: 'Casey Engineer' },
        run_metadata: { uncertaintyNotes: ['A human must confirm the current unblock path.'] },
      }),
    });

    expect(output.severity).toBe('urgent');
    expect(output.confidence).toBe(0.86);
    expect(output.recommendedAction?.label).toBe('Confirm the unblock path');
    expect(output.proposedRecipient).toEqual({ role: 'issue_assignee', userId, displayName: 'Casey Engineer' });
    expect(output.recipientRationale).toBe('Recipient is the issue assignee.');
    expect(output.uncertaintyNotes).toEqual(['A human must confirm the current unblock path.']);
    expect(JSON.stringify(output)).not.toContain('hidden-user');
  });
});
