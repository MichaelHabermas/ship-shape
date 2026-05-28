// Verifies the manual FleetGraph detector summary remains read-only and worker-free.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectFleetGraphAttentionDecisions,
  findStaleBlockedImportantIssueFindings,
  findBlockedImportantIssueQuietExits,
} from './detection/detector.js';
import { runManualFleetGraphDetector } from './detection/manual-detector.js';

vi.mock('./detection/detector.js', () => ({
  detectFleetGraphAttentionDecisions: vi.fn(),
  findStaleBlockedImportantIssueFindings: vi.fn(),
  findBlockedImportantIssueQuietExits: vi.fn(),
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';

describe('manual FleetGraph detector runner', () => {
  beforeEach(() => {
    const candidate = {
      workspace_id: workspaceId,
      issue_id: issueId,
      issue_title: 'Blocked issue',
      issue_ticket_number: 101,
      issue_state: 'in_progress',
      issue_priority: 'urgent',
      issue_assignee_id: '55555555-5555-4555-8555-555555555555',
      issue_assignee_name: 'Blocked Owner',
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
      blocker_iteration_id: '44444444-4444-4444-8444-444444444444',
      blocker_iteration_created_at: new Date('2026-05-26T12:00:00Z'),
      dedupeKey: `blocked-important-issue:${workspaceId}:${issueId}:${sprintId}`,
    } as const;
    vi.mocked(detectFleetGraphAttentionDecisions).mockResolvedValue([
      {
        decision: 'create_finding',
        existingFindingId: null,
        candidate,
      },
    ]);
    vi.mocked(findBlockedImportantIssueQuietExits).mockResolvedValue([
      { reason: 'duplicate_open_finding', count: 2 },
      { reason: 'insufficient_visible_evidence', count: 1 },
    ]);
    vi.mocked(findStaleBlockedImportantIssueFindings).mockResolvedValue([]);
  });

  it('returns a read-only manual detector summary', async () => {
    const today = new Date('2026-05-26T12:00:00Z');

    const summary = await runManualFleetGraphDetector({
      workspaceId,
      today,
      limit: 5,
    });

    expect(detectFleetGraphAttentionDecisions).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      today,
      limit: 5,
    }));
    expect(findBlockedImportantIssueQuietExits).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      today,
    }));
    expect(summary).toEqual({
      workspaceId,
      today: '2026-05-26T12:00:00.000Z',
      decisionCount: 1,
      dedupeDecisions: [{
        decision: 'create_finding',
        issueId,
        issueTitle: 'Blocked issue',
        issuePriority: 'urgent',
        sprintId,
        sprintTitle: 'Week 2',
        blockerText: 'Waiting on API credentials.',
        signalType: 'blocked',
        signalLabel: 'Blocked',
        reason: 'Waiting on API credentials.',
        evidenceText: 'Waiting on API credentials.',
        dedupeKey: `blocked-important-issue:${workspaceId}:${issueId}:${sprintId}`,
        existingFindingId: null,
      }],
      quietExits: [
        { reason: 'duplicate_open_finding', count: 2 },
        { reason: 'insufficient_visible_evidence', count: 1 },
      ],
      staleFindings: [],
      modelCalls: 0,
      mutatesShip: false,
      mutatesFleetGraph: false,
    });
  });
});
