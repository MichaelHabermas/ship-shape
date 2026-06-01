// Verifies FleetGraph routes preserve bounded graph and visible-evidence contracts.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fleetgraphRoutes from './fleetgraph/index.js';
import { fleetGraphConfig } from '../config/fleetgraph.js';
import { authorizeRequest } from '../security/route-capability.js';
import { getFleetGraphBlastRadius } from '../fleetgraph/blast-radius.js';
import { runFleetGraph } from '../fleetgraph/core.js';
import { visibleOutputForFinding } from '../fleetgraph/evidence.js';
import { runFleetGraphManualTick } from '../fleetgraph/execution/manual-run.js';
import { runFleetGraphWorkerTick } from '../fleetgraph/execution/worker.js';
import {
  listFleetGraphFindingsForSource,
  listFleetGraphFindingsByIds,
  listFleetGraphNotificationFindings,
  markFleetGraphNotificationRead,
  markVisibleFleetGraphNotificationsRead,
  type FleetGraphFinding,
  type FleetGraphNotificationFinding,
} from '../fleetgraph/persistence.js';
import {
  fleetGraphReviewerProofEnabled,
  generateFleetGraphReviewerProof,
  getFleetGraphReviewerChain,
  listFleetGraphReviewerChains,
  recordFleetGraphReviewerChatMutationProof,
  repairFleetGraphReviewerProof,
  ReviewerProofCommandError,
  runFleetGraphReviewerWeekBlockerScenario,
  runFleetGraphReviewerWorkerTick,
  sourceSnapshotForReviewerChat,
} from '../fleetgraph/reviewer-proof/index.js';
import { noModelCostMetadata, noModelTokenMetadata } from '../fleetgraph/usage-metadata.js';
import type { FleetGraphResult, FleetGraphVisibleOutput } from '../fleetgraph/types.js';
import type { FleetGraphReviewerChain, FleetGraphReviewerProofVerdict } from '@ship/shared';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';
const CHAT_RUN_ID = '66666666-6666-4666-8666-666666666666';
const attentionEventId = '77777777-7777-4777-8777-777777777777';
const authMock = vi.hoisted(() => ({ useApiToken: false }));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.userId = USER_ID;
    req.workspaceId = workspaceId;
    req.sessionId = authMock.useApiToken ? undefined : 'session-1';
    req.apiTokenId = authMock.useApiToken ? 'api-token-1' : undefined;
    req.apiTokenScopes = authMock.useApiToken ? ['admin:workspace'] : undefined;
    req.isApiToken = authMock.useApiToken;
    req.isSuperAdmin = false;
    req.principal = authMock.useApiToken
      ? {
          kind: 'api_token',
          tokenId: 'api-token-1',
          userId: req.userId,
          workspaceId: req.workspaceId,
          isSuperAdmin: false,
          scopes: ['admin:workspace'],
        }
      : {
          kind: 'session',
          sessionId: 'session-1',
          userId: req.userId,
          workspaceId: req.workspaceId,
          isSuperAdmin: false,
        };
    next();
  },
}));

vi.mock('../fleetgraph/core.js', () => ({
  runFleetGraph: vi.fn(),
}));

vi.mock('../config/fleetgraph.js', () => ({
  fleetGraphConfig: vi.fn(() => ({ manualRunApiEnabled: true })),
}));

vi.mock('../security/route-capability.js', () => ({
  authorizeRequest: vi.fn(),
}));

vi.mock('../fleetgraph/blast-radius.js', () => ({
  getFleetGraphBlastRadius: vi.fn(),
}));

vi.mock('../fleetgraph/evidence.js', () => ({
  visibleOutputForFinding: vi.fn(),
}));

vi.mock('../fleetgraph/execution/manual-run.js', () => ({
  runFleetGraphManualTick: vi.fn(),
}));

vi.mock('../fleetgraph/execution/worker.js', () => ({
  runFleetGraphWorkerTick: vi.fn(),
}));

vi.mock('../fleetgraph/persistence.js', () => ({
  listFleetGraphFindingsForSource: vi.fn(),
  listFleetGraphFindingsByIds: vi.fn(),
  listFleetGraphNotificationFindings: vi.fn(),
  markFleetGraphNotificationRead: vi.fn(),
  markVisibleFleetGraphNotificationsRead: vi.fn(),
  signalTypeFromDedupeKey: (dedupeKey: string) => {
    if (dedupeKey.startsWith('stale-issue:')) return 'stale';
    if (dedupeKey.startsWith('at-risk-issue:')) return 'at_risk';
    return 'blocked';
  },
  signalLabelForType: (signalType: string) => signalType === 'stale' ? 'Stale' : signalType === 'at_risk' ? 'At risk' : 'Blocked',
}));

vi.mock('../fleetgraph/reviewer-proof/index.js', () => ({
  fleetGraphReviewerProofEnabled: vi.fn(() => false),
  generateFleetGraphReviewerProof: vi.fn(),
  getFleetGraphReviewerChain: vi.fn(),
  listFleetGraphReviewerChains: vi.fn(),
  recordFleetGraphReviewerChatMutationProof: vi.fn(),
  repairFleetGraphReviewerProof: vi.fn(),
  ReviewerProofCommandError: class ReviewerProofCommandError extends Error {
    readonly command = 'pnpm fleetgraph:proof -- --mode local --no-refresh-evals';
    constructor(message: string, readonly outputTail: string[]) {
      super(message);
      this.name = 'ReviewerProofCommandError';
    }
  },
  runFleetGraphReviewerWeekBlockerScenario: vi.fn(),
  runFleetGraphReviewerWorkerTick: vi.fn(),
  sourceSnapshotForReviewerChat: vi.fn(),
}));

type FleetGraphFindingsTestBody = {
  findings: Array<{
    dedupeKey?: string;
    visibleOutput: { summary: string };
  }>;
};

type FleetGraphBlastRadiusTestBody = {
  summary: string;
  nodes: Array<{ id: string; kind: string; title: string }>;
  edges: Array<{ from: string; to: string; kind: string; label: string }>;
};

type FleetGraphNotificationsTestBody = {
  notifications: Array<{
    id: string;
    findingId: string;
    title: string;
    context: string;
    owner: string | null;
    blockerText: string;
    signalType: string;
    signalLabel: string;
    reason: string;
    notificationText: string;
    sourcePath: string;
    isRead: boolean;
    readAt: string | null;
  }>;
};

type FleetGraphRunTestBody = {
  decision: string;
  finding?: unknown;
  visibleOutput?: {
    noSafeOutput?: boolean;
    summary?: string;
  };
  usageMetadata?: {
    modelCalls: number;
    estimatedCostUsd?: number;
  };
};

type FleetGraphManualRunTestBody = {
  mode: 'proactive';
  detectorDecisions: number;
  results: Array<{
    decision: string;
    findingId?: string;
    visibleOutput?: { noSafeOutput?: boolean };
    usageMetadata?: unknown;
  }>;
};

type FleetGraphManualRunUsageTestBody = {
  results: Array<{
    usageMetadata?: FleetGraphRunTestBody['usageMetadata'];
  }>;
};

type FleetGraphReviewerChainsTestBody = {
  chains: FleetGraphReviewerChain[];
};

type FleetGraphReviewerScenarioTestBody = {
  chain: FleetGraphReviewerChain;
};

type FleetGraphReviewerRepairTestBody = {
  repaired: string[];
  unsupported: string[];
  chain: FleetGraphReviewerChain;
};

type FleetGraphReviewerProofTestBody = {
  verdict: FleetGraphReviewerProofVerdict;
  chainId: string;
};

function reviewerChain(overrides: Partial<FleetGraphReviewerChain> = {}): FleetGraphReviewerChain {
  return {
    chainId: findingId,
    scenario: 'week-blocker',
    status: 'complete',
    missing: [],
    missingLabels: [],
    productPath: 'working',
    generatedAt: '2026-05-29T00:00:00.000Z',
    freshness: {
      generatedAt: '2026-05-29T00:00:00.000Z',
      newestRunAt: '2026-05-29T00:00:00.000Z',
      newestWorkerTickAt: '2026-05-29T00:00:00.000Z',
      proofAgeMs: 1000,
      workerAgeMs: 1000,
    },
    latencyMs: { total: 1000 },
    links: {
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      workerTickId: attentionEventId,
      runId: CHAT_RUN_ID,
      traceId: 'trace-1',
      traceUrl: 'https://trace.example',
      findingId,
      notificationProjectionId: findingId,
    },
    steps: [
      { key: 'source', label: 'Ship source', status: 'pass', at: '2026-05-29T00:00:00.000Z', evidence: 'Issue is blocked.' },
      { key: 'attention_event', label: 'Attention event', status: 'pass', at: '2026-05-29T00:00:01.000Z', evidence: 'reviewer-week-blocker-scenario' },
      { key: 'worker_tick', label: 'Worker tick', status: 'pass', at: '2026-05-29T00:00:02.000Z', evidence: 'completed' },
      { key: 'graph_run', label: 'Graph run', status: 'pass', at: '2026-05-29T00:00:03.000Z', evidence: 'create_finding via reviewer-week-blocker-scenario' },
      { key: 'trace', label: 'Trace', status: 'pass', at: '2026-05-29T00:00:03.000Z', evidence: 'Safe trace URL captured' },
      { key: 'finding', label: 'Finding', status: 'pass', at: '2026-05-29T00:00:04.000Z', evidence: 'needs_confirmation' },
      { key: 'notification_projection', label: 'Notification projection', status: 'pass', at: '2026-05-29T00:00:04.000Z', evidence: 'Derived from visible finding' },
      { key: 'chat_human_gate', label: 'Chat and human gate', status: 'pass', at: '2026-05-29T00:00:05.000Z', evidence: 'Visible output contains human gate metadata' },
    ],
    humanGate: { required: true, state: 'present', allowedActions: ['inspect evidence'] },
    traceQuality: {
      passed: true,
      requiredDecisions: ['create_finding'],
      observedDecisions: ['create_finding'],
      scores: [{ name: 'traceUrl', passed: true, value: 'https://trace.example', comment: 'Trace URL captured.' }],
    },
    sourceMutationCheck: { passed: true, before: {}, after: {}, changedFields: [] },
    usageSummary: { modelCalls: 1, costCurrency: 'USD' },
    ...overrides,
  };
}

function app() {
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/fleetgraph', fleetgraphRoutes);
  return testApp;
}

function finding(overrides: Partial<FleetGraphFinding> = {}): FleetGraphFinding {
  return {
    id: findingId,
    workspace_id: workspaceId,
    source_issue_id: issueId,
    source_sprint_id: sprintId,
    dedupe_key: `blocked-important-issue:${workspaceId}:${issueId}:${sprintId}`,
    status: 'needs_confirmation',
    severity: 'urgent',
    confidence: 0.86,
    title: 'Blocked issue',
    summary: 'Visible summary',
    evidence_snapshot: [],
    recommended_action: {},
    draft_content: {},
    proposed_recipient: {},
    human_gate: { required: true },
    trace_metadata: { mode: 'proactive', decision: 'create_finding', nodePath: ['produceOutput'] },
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

function notificationFinding(overrides: Partial<FleetGraphNotificationFinding> = {}): FleetGraphNotificationFinding {
  return {
    ...finding(),
    issue_title: 'API access blocker',
    context_title: 'Sprint 12',
    owner_name: 'PM thread',
    read_at: null,
    ...overrides,
  };
}

function visibleOutput(overrides: Partial<FleetGraphVisibleOutput> = {}): FleetGraphVisibleOutput {
  return {
    title: 'Blocked issue',
    summary: 'Visible summary',
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

function restrictedVisibleOutput(): FleetGraphVisibleOutput {
  return {
    title: 'FleetGraph output restricted',
    summary: 'FleetGraph cannot show this finding because the source issue is not visible to the current actor.',
    evidence: [],
    humanGate: { required: false },
    noSafeOutput: true,
  };
}

function mockGraphResult(overrides: Partial<FleetGraphResult> = {}): FleetGraphResult {
  const decision = overrides.decision ?? 'explain';
  const findingValue = 'finding' in overrides ? overrides.finding : finding();
  const visible = overrides.visibleOutput ?? (findingValue ? visibleOutput() : undefined);
  return {
    decision,
    finding: findingValue,
    run: {} as FleetGraphResult['run'],
    runInput: { outputSnapshot: {} } as FleetGraphResult['runInput'],
    visibleOutput: visible,
    evidence: visible?.evidence ?? [],
    traceMetadata: overrides.traceMetadata ?? { mode: 'on_demand', decision, nodePath: ['produceOutput'] },
    tokenMetadata: overrides.tokenMetadata ?? noModelTokenMetadata(),
    costMetadata: overrides.costMetadata ?? noModelCostMetadata(),
    errorMetadata: overrides.errorMetadata ?? {},
    ...overrides,
  };
}

describe('FleetGraph routes', () => {
  beforeEach(() => {
    vi.mocked(listFleetGraphFindingsForSource).mockReset();
    vi.mocked(listFleetGraphFindingsByIds).mockReset();
    vi.mocked(listFleetGraphNotificationFindings).mockReset();
    vi.mocked(markFleetGraphNotificationRead).mockReset();
    vi.mocked(markVisibleFleetGraphNotificationsRead).mockReset();
    vi.mocked(getFleetGraphBlastRadius).mockReset();
    vi.mocked(visibleOutputForFinding).mockReset();
    vi.mocked(runFleetGraph).mockReset();
    vi.mocked(runFleetGraphManualTick).mockReset();
    vi.mocked(runFleetGraphWorkerTick).mockReset();
    vi.mocked(fleetGraphReviewerProofEnabled).mockReset();
    vi.mocked(generateFleetGraphReviewerProof).mockReset();
    vi.mocked(getFleetGraphReviewerChain).mockReset();
    vi.mocked(listFleetGraphReviewerChains).mockReset();
    vi.mocked(recordFleetGraphReviewerChatMutationProof).mockReset();
    vi.mocked(repairFleetGraphReviewerProof).mockReset();
    vi.mocked(runFleetGraphReviewerWeekBlockerScenario).mockReset();
    vi.mocked(runFleetGraphReviewerWorkerTick).mockReset();
    vi.mocked(sourceSnapshotForReviewerChat).mockReset();
    authMock.useApiToken = false;
    process.env.NODE_ENV = 'test';
    vi.mocked(fleetGraphConfig).mockReturnValue({ manualRunApiEnabled: true } as never);
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(false);
    vi.mocked(sourceSnapshotForReviewerChat).mockResolvedValue({ sourceIssueId: null, findingId: null, state: {} });
    vi.mocked(authorizeRequest).mockResolvedValue({ allowed: true, reason: 'allowed' } as never);
  });

  it('lists active notifications from actor-visible open findings', async () => {
    vi.mocked(listFleetGraphNotificationFindings).mockResolvedValue([notificationFinding()]);
    vi.mocked(visibleOutputForFinding).mockResolvedValue({
      evidence: [{
        kind: 'blocker',
        sourceDocumentId: issueId,
        sourceType: 'issue',
        claim: 'Latest blocker text exists.',
        excerpt: 'Waiting on API access before backend queue work can continue.',
        visibility: 'actor_visible',
        visibleFields: ['blockers_encountered'],
      }],
      output: visibleOutput({
        evidence: [{
          kind: 'blocker',
          sourceDocumentId: issueId,
          sourceType: 'issue',
          claim: 'Latest blocker text exists.',
          excerpt: 'Waiting on API access before backend queue work can continue.',
          visibility: 'actor_visible',
          visibleFields: ['blockers_encountered'],
        }],
      }),
    });

    const res = await request(app())
      .get('/api/fleetgraph/notifications?limit=10')
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphNotificationsTestBody;
    expect(body.notifications[0]).toMatchObject({
      id: findingId,
      findingId,
      title: 'API access blocker',
      context: 'Sprint 12',
      owner: 'PM thread',
      signalType: 'blocked',
      signalLabel: 'Blocked',
      reason: 'Visible summary',
      notificationText: 'Waiting on API access before backend queue work can continue.',
      blockerText: 'Waiting on API access before backend queue work can continue.',
      sourcePath: `/documents/${issueId}`,
      isRead: false,
      readAt: null,
    });
  });

  it('marks one notification read for the current user', async () => {
    vi.mocked(listFleetGraphFindingsByIds).mockResolvedValue([finding()]);
    vi.mocked(visibleOutputForFinding).mockResolvedValue({
      evidence: visibleOutput().evidence,
      output: visibleOutput(),
    });
    vi.mocked(markFleetGraphNotificationRead).mockResolvedValue(1);

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/read`)
      .send({})
      .expect(200);

    expect(JSON.parse(res.text)).toEqual({ success: true, markedRead: 1 });
  });

  it('reports when a notification read mark affects no visible active finding', async () => {
    vi.mocked(listFleetGraphFindingsByIds).mockResolvedValue([]);
    vi.mocked(markFleetGraphNotificationRead).mockResolvedValue(0);

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/read`)
      .send({})
      .expect(200);

    expect(JSON.parse(res.text)).toEqual({ success: true, markedRead: 0 });
  });

  it('does not mark one restricted notification read', async () => {
    vi.mocked(listFleetGraphFindingsByIds).mockResolvedValue([finding()]);
    vi.mocked(visibleOutputForFinding).mockResolvedValue({
      evidence: [],
      output: restrictedVisibleOutput(),
    });

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/read`)
      .send({})
      .expect(200);

    expect(markFleetGraphNotificationRead).not.toHaveBeenCalled();
    expect(JSON.parse(res.text)).toEqual({ success: true, markedRead: 0 });
  });

  it('marks provided visible notifications read for the current user', async () => {
    vi.mocked(listFleetGraphFindingsByIds).mockResolvedValue([
      finding(),
      finding({ id: CHAT_RUN_ID }),
    ]);
    vi.mocked(visibleOutputForFinding).mockImplementation(async ({ finding: candidate }) => ({
      evidence: [],
      output: visibleOutput({ summary: candidate.summary }),
    }));
    vi.mocked(markVisibleFleetGraphNotificationsRead).mockResolvedValue(2);

    const res = await request(app())
      .post('/api/fleetgraph/notifications/read')
      .send({ findingIds: [findingId, CHAT_RUN_ID] })
      .expect(200);

    expect(JSON.parse(res.text)).toEqual({ success: true, markedRead: 2 });
  });

  it('marks only actor-visible notification ids in bulk read requests', async () => {
    const restrictedId = CHAT_RUN_ID;
    vi.mocked(listFleetGraphFindingsByIds).mockResolvedValue([
      finding(),
      finding({ id: restrictedId }),
    ]);
    vi.mocked(visibleOutputForFinding).mockImplementation(async ({ finding: candidate }) => ({
      evidence: [],
      output: candidate.id === restrictedId ? restrictedVisibleOutput() : visibleOutput(),
    }));
    vi.mocked(markVisibleFleetGraphNotificationsRead).mockResolvedValue(1);

    const res = await request(app())
      .post('/api/fleetgraph/notifications/read')
      .send({ findingIds: [findingId, restrictedId] })
      .expect(200);

    expect(JSON.parse(res.text)).toEqual({ success: true, markedRead: 1 });
  });

  it('serializes multiple notification signal types safely', async () => {
    vi.mocked(listFleetGraphNotificationFindings).mockResolvedValue([
      notificationFinding(),
      notificationFinding({
        id: CHAT_RUN_ID,
        dedupe_key: `stale-issue:${workspaceId}:${issueId}:${sprintId}`,
        run_metadata: { signalType: 'stale', reason: 'No meaningful update for 30+ days.' },
        summary: 'No meaningful update for 30+ days.',
      }),
      notificationFinding({
        id: attentionEventId,
        dedupe_key: `at-risk-issue:${workspaceId}:${issueId}:${sprintId}`,
        run_metadata: { signalType: 'at_risk', reason: 'High-priority current-week work has no owner.' },
        summary: 'High-priority current-week work has no owner.',
      }),
    ]);
    vi.mocked(visibleOutputForFinding).mockImplementation(async ({ finding }) => ({
      evidence: [],
      output: visibleOutput({ summary: finding.summary }),
    }));

    const res = await request(app())
      .get('/api/fleetgraph/notifications?limit=10')
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphNotificationsTestBody;
    expect(body.notifications.map((notification) => notification.signalType)).toEqual(['blocked', 'stale', 'at_risk']);
    expect(body.notifications.map((notification) => notification.signalLabel)).toEqual(['Blocked', 'Stale', 'At risk']);
    expect(body.notifications[1]?.notificationText).toBe('No meaningful update for 30+ days.');
  });

  it('omits notifications without safe actor-visible output', async () => {
    vi.mocked(listFleetGraphNotificationFindings).mockResolvedValue([notificationFinding()]);
    vi.mocked(visibleOutputForFinding).mockResolvedValue({
      evidence: [],
      output: restrictedVisibleOutput(),
    });

    const res = await request(app())
      .get('/api/fleetgraph/notifications')
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphNotificationsTestBody;
    expect(body.notifications).toEqual([]);
    expect(res.text).not.toContain(issueId);
  });

  it('lists findings with actor-filtered visible output', async () => {
    vi.mocked(listFleetGraphFindingsForSource).mockResolvedValue([finding()]);
    vi.mocked(visibleOutputForFinding).mockResolvedValue({
      evidence: visibleOutput().evidence,
      output: visibleOutput(),
    });

    const res = await request(app())
      .get(`/api/fleetgraph/findings?sourceIssueId=${issueId}`)
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphFindingsTestBody;
    expect(body.findings[0]?.visibleOutput.summary).toBe('Visible summary');
    expect(body.findings[0]?.dedupeKey).toBeUndefined();
  });

  it('omits list findings when source evidence has no safe actor-visible output', async () => {
    vi.mocked(listFleetGraphFindingsForSource).mockResolvedValue([finding()]);
    vi.mocked(visibleOutputForFinding).mockResolvedValue({
      evidence: [],
      output: restrictedVisibleOutput(),
    });

    const res = await request(app())
      .get(`/api/fleetgraph/findings?sourceSprintId=${sprintId}`)
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphFindingsTestBody;
    expect(body.findings).toEqual([]);
    expect(res.text).not.toContain(issueId);
    expect(res.text).not.toContain('blocked-important-issue');
  });

  it('returns a visible blast radius map for a finding', async () => {
    vi.mocked(getFleetGraphBlastRadius).mockResolvedValue({
      finding: {
        id: findingId,
        kind: 'blocker',
        status: 'needs_confirmation',
        signalType: 'blocked',
        signalLabel: 'Blocked',
        reason: 'Visible summary',
        sourceIssueId: issueId,
        sourceSprintId: sprintId,
        visibleOutput: visibleOutput(),
        traceMetadata: { mode: 'proactive', decision: 'create_finding', nodePath: ['detectorDecision'] },
      },
      summary: 'API access blocker touches 1 project.',
      nodes: [
        { id: `finding:${findingId}`, kind: 'finding', title: 'API access blocker', status: 'needs_confirmation', severity: 'urgent' },
        { id: `issue:${issueId}`, kind: 'issue', title: 'Backend queue work' },
        { id: 'project:99999999-9999-4999-8999-999999999999', kind: 'project', title: 'Audit Load' },
      ],
      edges: [
        { from: `finding:${findingId}`, to: `issue:${issueId}`, kind: 'source_issue', label: 'source issue' },
      ],
    });

    const res = await request(app())
      .get(`/api/fleetgraph/findings/${findingId}/blast-radius-map`)
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphBlastRadiusTestBody;
    expect(body.summary).toBe('API access blocker touches 1 project.');
    expect(body.nodes.map((node) => node.kind)).toEqual(['finding', 'issue', 'project']);
    const [blastRadiusCall] = vi.mocked(getFleetGraphBlastRadius).mock.calls;
    expect(blastRadiusCall?.[0].workspaceId).toBe(workspaceId);
    expect(blastRadiusCall?.[0].findingId).toBe(findingId);
    expect(blastRadiusCall?.[0].principal).toMatchObject({ kind: 'session', userId: USER_ID });
    expect(res.text).not.toContain('blocked-important-issue');
  });

  it('returns 404 for absent or restricted blast radius maps', async () => {
    vi.mocked(getFleetGraphBlastRadius).mockResolvedValue(null);

    const res = await request(app())
      .get(`/api/fleetgraph/findings/${findingId}/blast-radius-map`)
      .expect(404);

    expect(JSON.parse(res.text)).toEqual({ error: 'FleetGraph finding not found' });
  });

  it('returns explain output without usage metadata for deterministic runs', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'explain',
      traceMetadata: { mode: 'on_demand', decision: 'explain', nodePath: ['produceOutput'] },
    }));

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/explain`)
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphRunTestBody;
    expect(body.decision).toBe('explain');
    expect(body.finding).toBeTruthy();
    expect(body.visibleOutput?.summary).toBe('Visible summary');
    expect(body.usageMetadata).toBeUndefined();
    expect(res.text).not.toContain('blocked-important-issue');
  });

  it('returns model usage metadata when the graph reports token and cost facts', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'explain',
      tokenMetadata: {
        modelCalls: 1,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        usageSource: 'model_response',
      },
      costMetadata: {
        estimatedCostUsd: 0.00012,
        currency: 'USD',
        costSource: 'catalog_estimate',
      },
    }));

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/explain`)
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphRunTestBody;
    expect(body.usageMetadata).toEqual({
      modelCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      estimatedCostUsd: 0.00012,
      costCurrency: 'USD',
      usageSource: 'model_response',
      costSource: 'catalog_estimate',
    });
  });

  it('returns anchored change summary rows without leaking finding internals', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'summarize_changes',
      changeSummary: {
        headline: 'Priority raised',
        rows: [
          { label: 'Changed', text: 'Priority High -> Urgent.' },
          { label: 'Not done', text: 'No issue changed. No message sent.' },
        ],
      },
      traceMetadata: { mode: 'on_demand', decision: 'summarize_changes', nodePath: ['compareAnchor'] },
    }));

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/changes`)
      .expect(200);

    const body = JSON.parse(res.text) as { headline: string; rows: Array<{ label: string; text: string }> };
    expect(body).toMatchObject({
      headline: 'Priority raised',
      rows: [
        { label: 'Changed', text: 'Priority High -> Urgent.' },
        { label: 'Not done', text: 'No issue changed. No message sent.' },
      ],
    });
    expect(res.text).not.toContain('blocked-important-issue');
  });

  it('returns context chat answers with the recommended next step', async () => {
    const beforeMutation = { sourceIssueId: issueId, findingId, state: { state: 'blocked', priority: 'high' } };
    vi.mocked(sourceSnapshotForReviewerChat)
      .mockResolvedValueOnce(beforeMutation);
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'needs_confirmation',
      run: { id: CHAT_RUN_ID } as FleetGraphResult['run'],
      visibleOutput: visibleOutput({
        recommendedAction: {
          text: 'Ask Casey Engineer to confirm owner and next step for Week 2.',
        },
      }),
      traceMetadata: { mode: 'on_demand', decision: 'needs_confirmation', nodePath: ['contextChat'] },
    }));

    const res = await request(app())
      .post('/api/fleetgraph/chat')
      .send({
        prompt: 'Who can unblock this?',
        context: { kind: 'notification', findingId, sourcePath: `/documents/${issueId}` },
      })
      .expect(200);

    const body = JSON.parse(res.text) as { decision: string; answer: { nextStep?: string }; usageMetadata?: unknown };
    expect(body.decision).toBe('needs_confirmation');
    expect(body.answer.nextStep).toBe('Ask Casey Engineer to confirm owner and next step for Week 2.');
    expect(body.usageMetadata).toBeUndefined();
    expect(recordFleetGraphReviewerChatMutationProof).not.toHaveBeenCalled();
  });

  it('accepts bounded context chat history on successful chat requests', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'explain',
      traceMetadata: { mode: 'on_demand', decision: 'explain', nodePath: ['contextChat'] },
    }));

    const res = await request(app())
      .post('/api/fleetgraph/chat')
      .send({
        prompt: 'Make it simpler',
        context: { kind: 'notification', findingId, sourcePath: `/documents/${issueId}` },
        history: [
          { role: 'user', content: 'Summarize this' },
          { role: 'assistant', content: 'This is a longer summary.' },
        ],
      })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphRunTestBody;
    expect(body.decision).toBe('explain');
  });

  it('forwards nested page, attached context, and history to the shared graph', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'explain',
      traceMetadata: { mode: 'on_demand', decision: 'explain', nodePath: ['contextChat'] },
    }));
    const pageContext = {
      route: '/issues?state=blocked',
      surface: 'issues_list' as const,
      title: 'Blocked issues',
      filters: { state: 'blocked' },
      visibleItems: [{ kind: 'issue' as const, id: issueId, title: 'Blocked issue' }],
      selectedItemIds: [issueId],
    };
    const attachedContexts = [{
      kind: 'document' as const,
      documentId: sprintId,
      sourcePath: `/documents/${sprintId}`,
      pageContext,
    }];
    const history = [
      { role: 'user' as const, content: 'Summarize this' },
      { role: 'assistant' as const, content: 'This is a longer summary.' },
    ];

    await request(app())
      .post('/api/fleetgraph/chat')
      .send({
        prompt: 'Make that simpler',
        context: {
          kind: 'notification',
          findingId,
          sourcePath: `/documents/${issueId}`,
          pageContext,
          attachedContexts,
        },
        history,
      })
      .expect(200);

    expect(runFleetGraph).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      mode: 'on_demand',
      trigger: {
        type: 'context_chat',
        prompt: 'Make that simpler',
        context: {
          kind: 'notification',
          findingId,
          sourcePath: `/documents/${issueId}`,
          pageContext,
          attachedContexts,
        },
        history,
      },
      triggerReason: 'context-chat',
    }));
  });

  it('rejects context chat history beyond the bounded request limit', async () => {
    await request(app())
      .post('/api/fleetgraph/chat')
      .send({
        prompt: 'Make it simpler',
        context: { kind: 'notification', findingId, sourcePath: `/documents/${issueId}` },
        history: Array.from({ length: 7 }, (_, index) => ({ role: 'user', content: `turn ${index}` })),
      })
      .expect(400);

    expect(runFleetGraph).not.toHaveBeenCalled();
  });

  it('rejects blank or oversized context chat history entries', async () => {
    await request(app())
      .post('/api/fleetgraph/chat')
      .send({
        prompt: 'Make it simpler',
        context: { kind: 'notification', findingId, sourcePath: `/documents/${issueId}` },
        history: [{ role: 'assistant', content: '   ' }],
      })
      .expect(400);

    await request(app())
      .post('/api/fleetgraph/chat')
      .send({
        prompt: 'Make it simpler',
        context: { kind: 'notification', findingId, sourcePath: `/documents/${issueId}` },
        history: [{ role: 'assistant', content: 'x'.repeat(4001) }],
      })
      .expect(400);

    expect(runFleetGraph).not.toHaveBeenCalled();
  });

  it('returns quiet context chat answers as successful chat responses', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'quiet_exit',
      finding: undefined,
      visibleOutput: undefined,
      traceMetadata: { mode: 'on_demand', decision: 'quiet_exit', nodePath: ['contextChatUnsupported'] },
    }));

    const res = await request(app())
      .post('/api/fleetgraph/chat')
      .send({
        prompt: 'How many issues do we have?',
        context: { kind: 'notification', findingId, sourcePath: `/documents/${issueId}` },
      })
      .expect(200);

    const body = JSON.parse(res.text) as { decision: string; answer: { body: string } };
    expect(body.decision).toBe('quiet_exit');
    expect(body.answer.body).toBe('FleetGraph could not answer from this context.');
  });

  it('returns not found without identifiers for restricted explain output', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'quiet_exit',
      visibleOutput: restrictedVisibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'quiet_exit', nodePath: ['filterVisibleEvidence'] },
    }));

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/explain`)
      .expect(404);

    const body = JSON.parse(res.text) as { error: string };
    expect(body.error).toBe('FleetGraph finding not found');
    expect(res.text).not.toContain(issueId);
    expect(res.text).not.toContain(sprintId);
    expect(res.text).not.toContain('blocked-important-issue');
  });

  it('returns refine draft decisions for bounded refinement requests', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'refine_draft',
      traceMetadata: { mode: 'on_demand', decision: 'refine_draft', nodePath: ['refineDraft'] },
    }));

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/refine`)
      .send({ instruction: 'Make it shorter.' })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphRunTestBody;
    expect(body.decision).toBe('refine_draft');
  });

  it('returns 404 only for explicit missing findings', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'error',
      finding: null,
      traceMetadata: { mode: 'on_demand', decision: 'error', nodePath: ['error'] },
      errorMetadata: { category: 'not_found' },
    }));

    await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/explain`)
      .expect(404);
  });

  it('returns 500 for internal FleetGraph errors', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'error',
      finding: null,
      traceMetadata: { mode: 'on_demand', decision: 'error', nodePath: ['error'] },
      errorMetadata: { category: 'internal' },
    }));

    await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/refine`)
      .send({ instruction: 'Make it shorter.' })
      .expect(500);
  });

  it('returns dismiss decisions for admin dismiss requests', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'dismiss',
      finding: finding({ status: 'dismissed' }),
      traceMetadata: { mode: 'on_demand', decision: 'dismiss', nodePath: ['persistFleetGraphState'] },
    }));

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphRunTestBody;
    expect(body.decision).toBe('dismiss');
    expect(body.usageMetadata).toBeUndefined();
  });

  it('returns 404 when dismiss targets a missing finding', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'error',
      finding: null,
      traceMetadata: { mode: 'on_demand', decision: 'error', nodePath: ['error'] },
      errorMetadata: { category: 'not_found' },
    }));

    await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .expect(404);
  });

  it('returns not found without identifiers for restricted dismiss output', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue(mockGraphResult({
      decision: 'quiet_exit',
      visibleOutput: restrictedVisibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'quiet_exit', nodePath: ['filterVisibleEvidence'] },
    }));

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .expect(404);

    const body = JSON.parse(res.text) as { error: string };
    expect(body.error).toBe('FleetGraph finding not found');
    expect(res.text).not.toContain(issueId);
    expect(res.text).not.toContain(sprintId);
    expect(res.text).not.toContain('blocked-important-issue');
  });

  it('rejects dismiss for non-admin workspace members', async () => {
    vi.mocked(authorizeRequest).mockResolvedValue({ allowed: false, reason: 'not_workspace_admin' } as never);

    await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .expect(403);

    expect(runFleetGraph).not.toHaveBeenCalled();
  });

  it('returns manual-run results for workspace admins', async () => {
    vi.mocked(runFleetGraphManualTick).mockResolvedValue({
      mode: 'proactive',
      detectorDecisions: 1,
      results: [mockGraphResult({
        decision: 'create_finding',
        traceMetadata: { mode: 'proactive', decision: 'create_finding', nodePath: ['produceOutput'] },
      })],
    } as never);

    const res = await request(app())
      .post('/api/fleetgraph/manual-run')
      .send({ today: '2026-05-26', limit: 1 })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphManualRunTestBody;
    expect(body.detectorDecisions).toBe(1);
    expect(body.results[0]?.decision).toBe('create_finding');
    expect(body.results[0]?.findingId).toBe(findingId);
    expect(body.results[0]?.usageMetadata).toBeUndefined();
  });

  it('includes usage metadata on manual-run results when the graph used a model', async () => {
    vi.mocked(runFleetGraphManualTick).mockResolvedValue({
      mode: 'proactive',
      detectorDecisions: 1,
      results: [mockGraphResult({
        decision: 'create_finding',
        tokenMetadata: {
          modelCalls: 2,
          inputTokens: 200,
          outputTokens: 40,
          totalTokens: 240,
          usageSource: 'model_response',
        },
        costMetadata: {
          estimatedCostUsd: 0.00024,
          currency: 'USD',
          costSource: 'catalog_estimate',
        },
      })],
    } as never);

    const res = await request(app())
      .post('/api/fleetgraph/manual-run')
      .send({ today: '2026-05-26', limit: 1 })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphManualRunUsageTestBody;
    expect(body.results[0]?.usageMetadata).toEqual({
      modelCalls: 2,
      inputTokens: 200,
      outputTokens: 40,
      totalTokens: 240,
      estimatedCostUsd: 0.00024,
      costCurrency: 'USD',
      usageSource: 'model_response',
      costSource: 'catalog_estimate',
    });
  });

  it('omits restricted manual-run finding output and identifiers', async () => {
    vi.mocked(runFleetGraphManualTick).mockResolvedValue({
      mode: 'proactive',
      detectorDecisions: 1,
      results: [mockGraphResult({
        decision: 'quiet_exit',
        visibleOutput: restrictedVisibleOutput(),
        traceMetadata: { mode: 'proactive', decision: 'quiet_exit', nodePath: ['filterVisibleEvidence'] },
      })],
    } as never);

    const res = await request(app())
      .post('/api/fleetgraph/manual-run')
      .send({ today: '2026-05-26', limit: 1 })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphManualRunTestBody;
    expect(body.detectorDecisions).toBe(0);
    expect(body.results[0]?.findingId).toBeUndefined();
    expect(body.results[0]?.visibleOutput).toBeUndefined();
    expect(res.text).not.toContain(issueId);
    expect(res.text).not.toContain(sprintId);
    expect(res.text).not.toContain('blocked-important-issue');
  });

  it('rejects manual ticks when the API gate is disabled', async () => {
    vi.mocked(fleetGraphConfig).mockReturnValue({ manualRunApiEnabled: false } as never);

    await request(app())
      .post('/api/fleetgraph/manual-run')
      .send({})
      .expect(403);

    expect(runFleetGraphManualTick).not.toHaveBeenCalled();
  });

  it('rejects manual ticks for non-admin workspace members', async () => {
    vi.mocked(authorizeRequest).mockResolvedValue({ allowed: false, reason: 'not_workspace_admin' } as never);

    await request(app())
      .post('/api/fleetgraph/manual-run')
      .send({})
      .expect(403);

    expect(runFleetGraphManualTick).not.toHaveBeenCalled();
  });

  it('rejects impossible manual run dates', async () => {
    await request(app())
      .post('/api/fleetgraph/manual-run')
      .send({ today: '2026-99-99' })
      .expect(400);

    expect(runFleetGraphManualTick).not.toHaveBeenCalled();
  });

  it('returns worker tick counts and attention event ids in test mode', async () => {
    vi.mocked(runFleetGraphWorkerTick).mockResolvedValue({
      workspaceCount: 1,
      selectedWorkspaceCount: 1,
      detectorDecisionCount: 1,
      resultCount: 1,
      eventCount: 1,
      modelCallCount: 0,
      auditMetadata: {
        attentionEventIds: ['99999999-9999-4999-8999-999999999999'],
      },
    });

    const res = await request(app())
      .post('/api/fleetgraph/test/worker-tick')
      .expect(200);

    expect(JSON.parse(res.text)).toEqual({
      success: true,
      eventCount: 1,
      detectorDecisionCount: 1,
      resultCount: 1,
      attentionEventIds: ['99999999-9999-4999-8999-999999999999'],
    });
  });

  it('hides the worker test trigger outside test mode', async () => {
    process.env.NODE_ENV = 'production';
    vi.mocked(authorizeRequest).mockClear();

    await request(app())
      .post('/api/fleetgraph/test/worker-tick')
      .expect(404);

    expect(authorizeRequest).not.toHaveBeenCalled();
    expect(runFleetGraphWorkerTick).not.toHaveBeenCalled();
  });

  it.each([
    ['limit below minimum', { limit: 0 }],
    ['limit above maximum', { limit: 26 }],
    ['non-integer limit', { limit: 1.5 }],
    ['malformed today', { today: '2026-5-6' }],
  ])('rejects invalid manual run body: %s', async (_label, body) => {
    await request(app())
      .post('/api/fleetgraph/manual-run')
      .send(body)
      .expect(400);

    expect(runFleetGraphManualTick).not.toHaveBeenCalled();
  });

  it('requires reviewer env gate before listing reviewer proof chains', async () => {
    await request(app())
      .get('/api/fleetgraph/reviewer/chains?limit=1')
      .expect(403);

    expect(listFleetGraphReviewerChains).not.toHaveBeenCalled();
  });

  it('lists reviewer proof chains for enabled workspace admins', async () => {
    const chain = reviewerChain();
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    vi.mocked(listFleetGraphReviewerChains).mockResolvedValue({
      summary: {
        generatedAt: '2026-05-29T00:00:00.000Z',
        status: 'complete',
        preferredChainId: findingId,
        chainCount: 1,
        completeCount: 1,
        brokenCount: 0,
        requiredGates: [],
        costSummary: { modelCalls: 1, costCurrency: 'USD' },
      },
      chains: [chain],
    });

    const res = await request(app())
      .get('/api/fleetgraph/reviewer/chains?limit=1')
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphReviewerChainsTestBody;
    expect(body.chains[0]?.chainId).toBe(findingId);
    expect(listFleetGraphReviewerChains).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      limit: 1,
    }));
  });

  it('returns reviewer proof chain detail for enabled workspace admins', async () => {
    const chain = reviewerChain();
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    vi.mocked(getFleetGraphReviewerChain).mockResolvedValue(chain);

    const res = await request(app())
      .get(`/api/fleetgraph/reviewer/chains/${chain.chainId}`)
      .expect(200);

    const body = JSON.parse(res.text) as { chain: FleetGraphReviewerChain };
    expect(body.chain.chainId).toBe(chain.chainId);
    expect(getFleetGraphReviewerChain).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      chainId: chain.chainId,
    }));
  });

  it('returns 404 for missing reviewer proof chain detail', async () => {
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    vi.mocked(getFleetGraphReviewerChain).mockResolvedValue(null);

    await request(app())
      .get(`/api/fleetgraph/reviewer/chains/${findingId}`)
      .expect(404);
  });

  it('blocks reviewer scenario controls when the env gate is disabled', async () => {
    await request(app())
      .post('/api/fleetgraph/reviewer/scenarios/week-blocker')
      .send({})
      .expect(403);

    expect(runFleetGraphReviewerWeekBlockerScenario).not.toHaveBeenCalled();
  });

  it('requires workspace admin for enabled reviewer scenario controls', async () => {
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    vi.mocked(authorizeRequest).mockResolvedValue({ allowed: false, reason: 'not_admin' } as never);

    await request(app())
      .post('/api/fleetgraph/reviewer/scenarios/week-blocker')
      .send({})
      .expect(403);

    expect(runFleetGraphReviewerWeekBlockerScenario).not.toHaveBeenCalled();
  });

  it('runs enabled reviewer scenario controls for workspace admins', async () => {
    const chain = reviewerChain();
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    vi.mocked(runFleetGraphReviewerWeekBlockerScenario).mockResolvedValue({
      chainId: chain.chainId,
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      workerTickTriggered: true,
      chain,
    });

    const res = await request(app())
      .post('/api/fleetgraph/reviewer/scenarios/week-blocker')
      .send({ triggerWorker: true, freshRun: true })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphReviewerScenarioTestBody;
    expect(body.chain.status).toBe('complete');
    expect(body.chain.chainId).toBe(chain.chainId);
    expect(body.chain.links).toMatchObject({
      sourceIssueId: issueId,
      sourceSprintId: sprintId,
      runId: CHAT_RUN_ID,
      findingId,
      notificationProjectionId: findingId,
    });
    expect(body.chain.steps.map((step) => step.key)).toEqual([
      'source',
      'attention_event',
      'worker_tick',
      'graph_run',
      'trace',
      'finding',
      'notification_projection',
      'chat_human_gate',
    ]);
    expect(body.chain.steps.every((step) => step.status === 'pass')).toBe(true);
    expect(body.chain.humanGate.state).toBe('present');
    expect(runFleetGraphReviewerWeekBlockerScenario).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      triggerWorker: true,
      freshRun: true,
    }));
  });

  it('requires the reviewer env gate for worker ticks and proof generation', async () => {
    await request(app())
      .post('/api/fleetgraph/reviewer/worker-tick')
      .expect(403);
    await request(app())
      .post('/api/fleetgraph/reviewer/repair')
      .send({ chainId: findingId })
      .expect(403);
    await request(app())
      .post('/api/fleetgraph/reviewer/proof')
      .expect(403);

    expect(runFleetGraphReviewerWorkerTick).not.toHaveBeenCalled();
    expect(repairFleetGraphReviewerProof).not.toHaveBeenCalled();
    expect(generateFleetGraphReviewerProof).not.toHaveBeenCalled();
  });

  it.each([
    ['chain list', 'get', '/api/fleetgraph/reviewer/chains?limit=1', undefined, listFleetGraphReviewerChains],
    ['chain detail', 'get', `/api/fleetgraph/reviewer/chains/${findingId}`, undefined, getFleetGraphReviewerChain],
    ['scenario', 'post', '/api/fleetgraph/reviewer/scenarios/week-blocker', {}, runFleetGraphReviewerWeekBlockerScenario],
    ['worker tick', 'post', '/api/fleetgraph/reviewer/worker-tick', undefined, runFleetGraphReviewerWorkerTick],
    ['repair', 'post', '/api/fleetgraph/reviewer/repair', { chainId: findingId }, repairFleetGraphReviewerProof],
    ['proof generation', 'post', '/api/fleetgraph/reviewer/proof', { chainId: findingId }, generateFleetGraphReviewerProof],
  ] as const)('requires an interactive reviewer session for enabled reviewer %s controls', async (_label, method, route, body, handler) => {
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    authMock.useApiToken = true;

    const requestBuilder = method === 'get' ? request(app()).get(route) : request(app()).post(route);
    if (body === undefined || method === 'get') {
      await requestBuilder.expect(403);
    } else {
      await requestBuilder.send(body).expect(403);
    }

    expect(handler).not.toHaveBeenCalled();
  });

  it('repairs enabled reviewer proof controls for workspace admins', async () => {
    const repairedChain = reviewerChain({
      missing: [],
      sourceMutationCheck: {
        passed: true,
        before: { state: 'blocked' },
        after: { state: 'blocked' },
        changedFields: [],
      },
    });
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    vi.mocked(repairFleetGraphReviewerProof).mockResolvedValue({
      chainId: repairedChain.chainId,
      repaired: ['source_mutation_check'],
      unsupported: [],
      chain: repairedChain,
    });

    const res = await request(app())
      .post('/api/fleetgraph/reviewer/repair')
      .send({ chainId: repairedChain.chainId })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphReviewerRepairTestBody;
    expect(body.repaired).toEqual(['source_mutation_check']);
    expect(body.chain.sourceMutationCheck.passed).toBe(true);
    expect(repairFleetGraphReviewerProof).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      chainId: repairedChain.chainId,
    }));
  });

  it('generates reviewer proof for the requested chain', async () => {
    const chain = reviewerChain();
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    vi.mocked(generateFleetGraphReviewerProof).mockResolvedValue({
      verdict: 'pass',
      generatedAt: '2026-05-29T00:00:00.000Z',
      chainId: chain.chainId,
      artifactPaths: {
        json: 'my-docs/evidence/fleetgraph-proof/latest.json',
        markdown: 'my-docs/evidence/fleetgraph-proof/latest.md',
        html: 'my-docs/evidence/fleetgraph-proof/latest.html',
      },
    });

    const res = await request(app())
      .post('/api/fleetgraph/reviewer/proof')
      .send({ chainId: chain.chainId })
      .expect(200);

    const body = JSON.parse(res.text) as FleetGraphReviewerProofTestBody;
    expect(body.verdict).toBe('pass');
    expect(body.chainId).toBe(chain.chainId);
    expect(generateFleetGraphReviewerProof).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      chainId: chain.chainId,
    }));
  });

  it('returns reviewer proof command diagnostics without running the generic error path', async () => {
    const chain = reviewerChain();
    vi.mocked(fleetGraphReviewerProofEnabled).mockReturnValue(true);
    vi.mocked(generateFleetGraphReviewerProof).mockRejectedValue(
      new ReviewerProofCommandError('Proof packet verdict fail', ['FleetGraph proof fail: latest.html'])
    );

    const res = await request(app())
      .post('/api/fleetgraph/reviewer/proof')
      .send({ chainId: chain.chainId })
      .expect(500);

    const body = JSON.parse(res.text) as { error: string; detail: string; outputTail: string[] };
    expect(body.error).toBe('Failed to generate proof packet');
    expect(body.detail).toBe('Proof packet verdict fail');
    expect(body.outputTail).toEqual(['FleetGraph proof fail: latest.html']);
  });
});
