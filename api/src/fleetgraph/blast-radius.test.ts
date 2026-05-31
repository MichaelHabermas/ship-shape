// Verifies FleetGraph blast radius omits restricted graph context instead of redacting it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFleetGraphBlastRadius } from './blast-radius.js';
import { authorize } from '../security/capabilities.js';
import { visibleOutputForFinding } from './evidence.js';
import {
  getFleetGraphFindingById,
  listFleetGraphFindingsForSource,
  type FleetGraphFinding,
} from './persistence.js';

vi.mock('../security/capabilities.js', () => ({
  authorize: vi.fn(),
}));

vi.mock('./evidence.js', () => ({
  visibleOutputForFinding: vi.fn(),
}));

vi.mock('./persistence.js', () => ({
  getFleetGraphFindingById: vi.fn(),
  listFleetGraphFindingsForSource: vi.fn(),
  signalTypeFromDedupeKey: vi.fn(() => 'blocked'),
  signalLabelForType: vi.fn(() => 'Blocked'),
}));

vi.mock('./api-contract.js', () => ({
  fleetGraphFindingResponse: vi.fn((finding: FleetGraphFinding & { visibleOutput?: unknown }) => ({
    id: finding.id,
    kind: 'blocker',
    status: finding.status,
    signalType: 'blocked',
    signalLabel: 'Blocked',
    reason: finding.summary,
    sourceIssueId: finding.source_issue_id,
    sourceSprintId: finding.source_sprint_id,
    visibleOutput: finding.visibleOutput,
    traceMetadata: { mode: 'proactive', decision: 'create_finding', nodePath: [] },
  })),
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const relatedFindingId = '55555555-5555-4555-8555-555555555555';
const restrictedFindingId = '66666666-6666-4666-8666-666666666666';

const db = {
  query: vi.fn(),
};

const principal = {
  kind: 'session' as const,
  sessionId: 'session-1',
  userId: '77777777-7777-4777-8777-777777777777',
  workspaceId,
  isSuperAdmin: false,
};

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
    title: 'Blocked work',
    summary: 'Visible summary',
    evidence_snapshot: [],
    recommended_action: {},
    draft_content: {},
    proposed_recipient: {},
    human_gate: { required: true },
    trace_metadata: {},
    run_metadata: { signalType: 'blocked' },
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

describe('FleetGraph blast radius', () => {
  beforeEach(() => {
    vi.mocked(getFleetGraphFindingById).mockReset();
    vi.mocked(listFleetGraphFindingsForSource).mockReset();
    vi.mocked(visibleOutputForFinding).mockReset();
    vi.mocked(authorize).mockReset();
    db.query.mockReset();
  });

  it('omits restricted related findings from the map', async () => {
    const root = finding();
    const visibleRelated = finding({ id: relatedFindingId, title: 'Visible related finding' });
    const restrictedRelated = finding({ id: restrictedFindingId, title: 'Hidden related finding' });
    vi.mocked(getFleetGraphFindingById).mockResolvedValue(root);
    vi.mocked(listFleetGraphFindingsForSource).mockResolvedValue([root, visibleRelated, restrictedRelated]);
    vi.mocked(visibleOutputForFinding).mockImplementation(async ({ finding: candidate }) => ({
      evidence: [],
      output: {
        title: candidate.title,
        summary: candidate.summary,
        evidence: [],
        humanGate: { required: true },
        noSafeOutput: candidate.id === restrictedFindingId,
      },
    }));
    vi.mocked(authorize).mockResolvedValue({ allowed: true, reason: 'allowed' } as never);
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const response = await getFleetGraphBlastRadius({
      workspaceId,
      principal,
      findingId,
      db,
    });

    expect(response?.nodes.map((node) => node.title)).toContain('Visible related finding');
    expect(response?.nodes.map((node) => node.title)).not.toContain('Hidden related finding');
    expect(response?.summary).toContain('1 related finding');
  });
});
