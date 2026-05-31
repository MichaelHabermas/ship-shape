// Verifies FleetGraph blast radius omits restricted graph context instead of redacting it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFleetGraphBlastRadius } from './blast-radius.js';
import { filterReadableDocumentIds } from '../services/document-graph-visibility.js';
import { visibleOutputForFinding } from './evidence.js';
import { projectFindingForActor } from './finding-projection.js';
import {
  getFleetGraphFindingById,
  listFleetGraphFindingsForSource,
  type FleetGraphFinding,
} from './persistence.js';

vi.mock('../services/document-graph-visibility.js', () => ({
  filterReadableDocumentIds: vi.fn(),
}));

vi.mock('./evidence.js', () => ({
  visibleOutputForFinding: vi.fn(),
}));

vi.mock('./finding-projection.js', () => ({
  projectFindingForActor: vi.fn(),
}));

vi.mock('./persistence.js', () => ({
  getFleetGraphFindingById: vi.fn(),
  listFleetGraphFindingsForSource: vi.fn(),
  signalTypeFromDedupeKey: vi.fn(() => 'blocked'),
  signalLabelForType: vi.fn(() => 'Blocked'),
}));


const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const findingId = '44444444-4444-4444-8444-444444444444';
const relatedFindingId = '55555555-5555-4555-8555-555555555555';
const restrictedFindingId = '66666666-6666-4666-8666-666666666666';
const extraFindingId = '77777777-7777-4777-8777-777777777777';

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
  function mockProjectedFinding(finding: FleetGraphFinding, noSafeOutput = false) {
    if (noSafeOutput) {
      vi.mocked(projectFindingForActor).mockResolvedValueOnce(null);
      return;
    }
    vi.mocked(projectFindingForActor).mockResolvedValueOnce({
      id: finding.id,
      kind: 'blocker',
      status: finding.status,
      signalType: 'blocked',
      signalLabel: 'Blocked',
      reason: finding.summary,
      sourceIssueId: finding.source_issue_id,
      sourceSprintId: finding.source_sprint_id,
      visibleOutput: {
        title: finding.title,
        summary: finding.summary,
        evidence: [],
        humanGate: { required: true },
      },
      traceMetadata: { mode: 'proactive', decision: 'create_finding', nodePath: [] },
    });
  }

  beforeEach(() => {
    vi.mocked(getFleetGraphFindingById).mockReset();
    vi.mocked(listFleetGraphFindingsForSource).mockReset();
    vi.mocked(projectFindingForActor).mockReset();
    vi.mocked(visibleOutputForFinding).mockReset();
    vi.mocked(filterReadableDocumentIds).mockReset();
    db.query.mockReset();
    vi.mocked(filterReadableDocumentIds).mockResolvedValue(new Set());
  });

  it('omits restricted related findings from the map', async () => {
    const root = finding();
    const visibleRelated = finding({ id: relatedFindingId, title: 'Visible related finding' });
    const restrictedRelated = finding({ id: restrictedFindingId, title: 'Hidden related finding' });
    vi.mocked(getFleetGraphFindingById).mockResolvedValue(root);
    vi.mocked(listFleetGraphFindingsForSource).mockResolvedValue([root, visibleRelated, restrictedRelated]);
    mockProjectedFinding(root);
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

  it('stops related-finding visibility checks after three visible findings', async () => {
    const root = finding();
    const related = [
      finding({ id: relatedFindingId, title: 'Related 1' }),
      finding({ id: restrictedFindingId, title: 'Related 2' }),
      finding({ id: extraFindingId, title: 'Related 3' }),
      finding({ id: '88888888-8888-4888-8888-888888888888', title: 'Related 4' }),
    ];
    vi.mocked(getFleetGraphFindingById).mockResolvedValue(root);
    vi.mocked(listFleetGraphFindingsForSource).mockResolvedValue([root, ...related]);
    mockProjectedFinding(root);
    vi.mocked(visibleOutputForFinding).mockImplementation(async ({ finding: candidate }) => ({
      evidence: [],
      output: {
        title: candidate.title,
        summary: candidate.summary,
        evidence: [],
        humanGate: { required: true },
        noSafeOutput: false,
      },
    }));
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const response = await getFleetGraphBlastRadius({
      workspaceId,
      principal,
      findingId,
      db,
    });

    expect(visibleOutputForFinding).toHaveBeenCalledTimes(3);
    expect(projectFindingForActor).toHaveBeenCalledTimes(1);
    expect(response?.nodes.filter((node) => node.subtitle === 'Related open finding')).toHaveLength(3);
  });

  it('filters document nodes with batch visibility', async () => {
    const root = finding();
    vi.mocked(getFleetGraphFindingById).mockResolvedValue(root);
    vi.mocked(listFleetGraphFindingsForSource).mockResolvedValue([root]);
    mockProjectedFinding(root);
    vi.mocked(visibleOutputForFinding).mockResolvedValue({
      evidence: [],
      output: {
        title: root.title,
        summary: root.summary,
        evidence: [],
        humanGate: { required: true },
      },
    });
    vi.mocked(filterReadableDocumentIds).mockResolvedValue(new Set([issueId]));
    db.query.mockResolvedValueOnce({
      rows: [{
        id: issueId,
        document_type: 'issue',
        title: 'Visible issue',
        properties: { state: 'blocked' },
        relationship_type: 'source_issue',
      }, {
        id: sprintId,
        document_type: 'sprint',
        title: 'Hidden sprint',
        properties: null,
        relationship_type: 'source_sprint',
      }],
    }).mockResolvedValueOnce({ rows: [] });

    const response = await getFleetGraphBlastRadius({
      workspaceId,
      principal,
      findingId,
      db,
    });

    expect(filterReadableDocumentIds).toHaveBeenCalled();
    expect(response?.nodes.map((node) => node.title)).toContain('Visible issue');
    expect(response?.nodes.map((node) => node.title)).not.toContain('Hidden sprint');
  });
});
