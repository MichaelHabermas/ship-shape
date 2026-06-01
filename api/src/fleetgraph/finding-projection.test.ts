// Verifies actor-safe finding projection returns null when visible output is unsafe.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fleetGraphFindingResponse } from './api-contract.js';
import { visibleOutputForFinding } from './evidence.js';
import { projectFindingForActor } from './finding-projection.js';

vi.mock('./evidence.js', () => ({
  visibleOutputForFinding: vi.fn(),
}));

vi.mock('./api-contract.js', () => ({
  fleetGraphFindingResponse: vi.fn((finding: { id: string }) => ({ id: finding.id, projected: true })),
}));

describe('projectFindingForActor', () => {
  beforeEach(() => {
    vi.mocked(visibleOutputForFinding).mockReset();
    vi.mocked(fleetGraphFindingResponse).mockReset();
  });

  it('returns null when output is not safe for the actor', async () => {
    vi.mocked(visibleOutputForFinding).mockResolvedValue({
      evidence: [],
      output: {
        title: 'Restricted',
        summary: 'Hidden',
        evidence: [],
        humanGate: { required: true },
        noSafeOutput: true,
      },
    });

    const result = await projectFindingForActor({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      finding: {
        id: '44444444-4444-4444-8444-444444444444',
        workspace_id: '11111111-1111-4111-8111-111111111111',
        status: 'open',
        source_issue_id: '22222222-2222-4222-8222-222222222222',
        source_sprint_id: '33333333-3333-4333-8333-333333333333',
        dedupe_key: 'blocked:issue',
        title: 'Finding',
        summary: 'Summary',
        severity: 'high',
        confidence: 0.9,
        evidence_snapshot: [],
        human_gate: {},
        recommended_action: {},
        proposed_recipient: {},
        draft_content: {},
        run_metadata: {},
        trace_metadata: {},
        last_detected_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    expect(result).toBeNull();
    expect(fleetGraphFindingResponse).not.toHaveBeenCalled();
  });
});
