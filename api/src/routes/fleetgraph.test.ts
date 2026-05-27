// Verifies FleetGraph routes preserve bounded graph and visible-evidence contracts.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fleetgraphRoutes from './fleetgraph.js';
import { fleetGraphConfig } from '../config/fleetgraph.js';
import { authorizeRequest } from '../security/route-capability.js';
import { runFleetGraph } from '../fleetgraph/core.js';
import { visibleOutputForFinding } from '../fleetgraph/evidence.js';
import { runFleetGraphManualTick } from '../fleetgraph/manual-run.js';
import { listFleetGraphFindingsForSource, type FleetGraphFinding } from '../fleetgraph/persistence.js';
import type { FleetGraphVisibleOutput } from '../fleetgraph/types.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.userId = '55555555-5555-4555-8555-555555555555';
    req.workspaceId = workspaceId;
    req.sessionId = 'session-1';
    req.isSuperAdmin = false;
    req.principal = {
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

vi.mock('../fleetgraph/evidence.js', () => ({
  visibleOutputForFinding: vi.fn(),
}));

vi.mock('../fleetgraph/manual-run.js', () => ({
  runFleetGraphManualTick: vi.fn(),
}));

vi.mock('../fleetgraph/persistence.js', () => ({
  listFleetGraphFindingsForSource: vi.fn(),
}));

type FleetGraphFindingsTestBody = {
  findings: Array<{
    dedupeKey?: string;
    visibleOutput: { summary: string };
  }>;
};

type FleetGraphRunTestBody = {
  decision: string;
  finding?: unknown;
  visibleOutput?: {
    noSafeOutput?: boolean;
  };
};

type FleetGraphManualRunTestBody = {
  mode: 'proactive';
  detectorDecisions: number;
  results: Array<{
    decision: string;
    findingId?: string;
    visibleOutput?: { noSafeOutput?: boolean };
  }>;
};

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
    title: 'Blocked active-week work',
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

function visibleOutput(): FleetGraphVisibleOutput {
  return {
    title: 'Blocked active-week work',
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

describe('FleetGraph routes', () => {
  beforeEach(() => {
    vi.mocked(listFleetGraphFindingsForSource).mockReset();
    vi.mocked(visibleOutputForFinding).mockReset();
    vi.mocked(runFleetGraph).mockReset();
    vi.mocked(runFleetGraphManualTick).mockReset();
    vi.mocked(fleetGraphConfig).mockReturnValue({ manualRunApiEnabled: true } as never);
    vi.mocked(authorizeRequest).mockResolvedValue({ allowed: true, reason: 'allowed' } as never);
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

    expect(listFleetGraphFindingsForSource).toHaveBeenCalledWith({
      workspaceId,
      sourceIssueId: issueId,
      sourceSprintId: undefined,
    });
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

  it('runs on-demand explain through runFleetGraph', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'explain',
      finding: finding(),
      visibleOutput: visibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'explain', nodePath: ['produceOutput'] },
    } as never);

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/explain`)
      .expect(200);

    expect(runFleetGraph).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      mode: 'on_demand',
      trigger: { type: 'explain_finding', findingId },
    }));
    const body = JSON.parse(res.text) as FleetGraphRunTestBody;
    expect(body.decision).toBe('explain');
  });

  it('runs anchored change summary through runFleetGraph', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'summarize_changes',
      finding: finding(),
      visibleOutput: visibleOutput(),
      changeSummary: {
        headline: 'Priority raised',
        rows: [
          { label: 'Changed', text: 'Priority High -> Urgent.' },
          { label: 'Not done', text: 'No issue changed. No message sent.' },
        ],
      },
      traceMetadata: { mode: 'on_demand', decision: 'summarize_changes', nodePath: ['compareAnchor'] },
    } as never);

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/changes`)
      .expect(200);

    expect(runFleetGraph).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      mode: 'on_demand',
      trigger: { type: 'summarize_changes', findingId },
    }));
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

  it('returns not found without identifiers for restricted explain output', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'quiet_exit',
      finding: finding(),
      visibleOutput: restrictedVisibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'quiet_exit', nodePath: ['filterVisibleEvidence'] },
    } as never);

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/explain`)
      .expect(404);

    const body = JSON.parse(res.text) as { error: string };
    expect(body.error).toBe('FleetGraph finding not found');
    expect(res.text).not.toContain(issueId);
    expect(res.text).not.toContain(sprintId);
    expect(res.text).not.toContain('blocked-important-issue');
  });

  it('runs bounded draft refinement without accepting arbitrary workspace chat', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'refine_draft',
      finding: finding(),
      visibleOutput: visibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'refine_draft', nodePath: ['refineDraft'] },
    } as never);

    await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/refine`)
      .send({ instruction: 'Make it shorter.' })
      .expect(200);

    expect(runFleetGraph).toHaveBeenCalledWith(expect.objectContaining({
      trigger: {
        type: 'refine_draft',
        findingId,
        instruction: 'Make it shorter.',
      },
    }));
  });

  it('returns 404 only for explicit missing findings', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'error',
      finding: null,
      visibleOutput: visibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'error', nodePath: ['error'] },
      errorMetadata: { category: 'not_found' },
    } as never);

    await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/explain`)
      .expect(404);
  });

  it('returns 500 for internal FleetGraph errors', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'error',
      finding: null,
      visibleOutput: visibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'error', nodePath: ['error'] },
      errorMetadata: { category: 'internal' },
    } as never);

    await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/refine`)
      .send({ instruction: 'Make it shorter.' })
      .expect(500);
  });

  it('runs dismiss through runFleetGraph', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'dismiss',
      finding: finding({ status: 'dismissed' }),
      visibleOutput: visibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'dismiss', nodePath: ['persistFleetGraphState'] },
    } as never);

    const res = await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .expect(200);

    expect(runFleetGraph).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      mode: 'on_demand',
      trigger: {
        type: 'dismiss_finding',
        findingId,
        dismissedBy: '55555555-5555-4555-8555-555555555555',
      },
    }));
    const body = JSON.parse(res.text) as FleetGraphRunTestBody;
    expect(body.decision).toBe('dismiss');
  });

  it('returns 404 when dismiss targets a missing finding', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'error',
      finding: null,
      visibleOutput: visibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'error', nodePath: ['error'] },
      errorMetadata: { category: 'not_found' },
    } as never);

    await request(app())
      .post(`/api/fleetgraph/findings/${findingId}/dismiss`)
      .expect(404);
  });

  it('returns not found without identifiers for restricted dismiss output', async () => {
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'quiet_exit',
      finding: finding(),
      visibleOutput: restrictedVisibleOutput(),
      traceMetadata: { mode: 'on_demand', decision: 'quiet_exit', nodePath: ['filterVisibleEvidence'] },
    } as never);

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

  it('runs gated manual ticks for workspace admins', async () => {
    vi.mocked(runFleetGraphManualTick).mockResolvedValue({
      mode: 'proactive',
      detectorDecisions: 1,
      results: [{
        decision: 'create_finding',
        finding: finding(),
        visibleOutput: visibleOutput(),
        traceMetadata: { mode: 'proactive', decision: 'create_finding', nodePath: ['produceOutput'] },
      }],
    } as never);

    const res = await request(app())
      .post('/api/fleetgraph/manual-run')
      .send({ today: '2026-05-26', limit: 1 })
      .expect(200);

    expect(authorizeRequest).toHaveBeenCalledWith(expect.any(Object), { resource: 'workspace', action: 'admin' });
    expect(runFleetGraphManualTick).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      limit: 1,
    }));
    const body = JSON.parse(res.text) as FleetGraphManualRunTestBody;
    expect(body.detectorDecisions).toBe(1);
    expect(body.results[0]?.decision).toBe('create_finding');
    expect(body.results[0]?.findingId).toBe(findingId);
  });

  it('omits restricted manual-run finding output and identifiers', async () => {
    vi.mocked(runFleetGraphManualTick).mockResolvedValue({
      mode: 'proactive',
      detectorDecisions: 1,
      results: [{
        decision: 'quiet_exit',
        finding: finding(),
        visibleOutput: restrictedVisibleOutput(),
        traceMetadata: { mode: 'proactive', decision: 'quiet_exit', nodePath: ['filterVisibleEvidence'] },
      }],
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
});
