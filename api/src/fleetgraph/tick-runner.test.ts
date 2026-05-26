// Verifies the shared FleetGraph tick runner keeps dry-run and execute modes explicit.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { detectBlockedImportantIssueDecisions, findBlockedImportantIssueQuietExits } from './detector.js';
import { runFleetGraph } from './core.js';
import { runFleetGraphTick } from './tick-runner.js';
import type { Principal } from '../security/principal.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const issueId = '22222222-2222-4222-8222-222222222222';
const sprintId = '33333333-3333-4333-8333-333333333333';
const userId = '55555555-5555-4555-8555-555555555555';

const principal: Principal = {
  kind: 'session',
  sessionId: 'session-1',
  userId,
  workspaceId,
  isSuperAdmin: false,
};

vi.mock('./detector.js', () => ({
  detectBlockedImportantIssueDecisions: vi.fn(),
  findBlockedImportantIssueQuietExits: vi.fn(),
}));

vi.mock('./core.js', () => ({
  runFleetGraph: vi.fn(),
}));

const detectorDecision = {
  decision: 'create_finding' as const,
  existingFindingId: null,
  candidate: {
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
    dedupeKey: `blocked-important-issue:${workspaceId}:${issueId}:${sprintId}`,
  },
};

describe('FleetGraph tick runner', () => {
  beforeEach(() => {
    vi.mocked(detectBlockedImportantIssueDecisions).mockReset();
    vi.mocked(findBlockedImportantIssueQuietExits).mockReset();
    vi.mocked(runFleetGraph).mockReset();
  });

  it('summarizes dry-run detector output without graph execution', async () => {
    vi.mocked(detectBlockedImportantIssueDecisions).mockResolvedValue([detectorDecision]);
    vi.mocked(findBlockedImportantIssueQuietExits).mockResolvedValue([{ reason: 'no_blocker', count: 2 }]);

    const summary = await runFleetGraphTick({
      mode: 'dryRun',
      workspaceId,
      today: new Date('2026-05-26T00:00:00Z'),
    });

    expect(summary.decisionCount).toBe(1);
    expect(summary.mutatesShip).toBe(false);
    expect(summary.mutatesFleetGraph).toBe(false);
    expect(runFleetGraph).not.toHaveBeenCalled();
  });

  it('runs detector decisions through the shared proactive graph path', async () => {
    vi.mocked(detectBlockedImportantIssueDecisions).mockResolvedValue([detectorDecision]);
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'create_finding',
      finding: null,
      traceMetadata: { mode: 'proactive', decision: 'create_finding', nodePath: ['produceOutput'] },
    } as never);

    const summary = await runFleetGraphTick({ mode: 'execute', workspaceId, principal, db: { query: vi.fn() } });

    expect(summary.detectorDecisions).toBe(1);
    expect(runFleetGraph).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      principal,
      mode: 'proactive',
      trigger: { type: 'detector_decision', detectorDecision },
      triggerReason: 'manual-run',
    }), expect.any(Object));
  });

  it('records a quiet graph run when execute mode has no candidates', async () => {
    const quietExits = [{ reason: 'no_blocker' as const, count: 2 }];
    vi.mocked(detectBlockedImportantIssueDecisions).mockResolvedValue([]);
    vi.mocked(findBlockedImportantIssueQuietExits).mockResolvedValue(quietExits);
    vi.mocked(runFleetGraph).mockResolvedValue({
      decision: 'quiet_exit',
      finding: null,
      traceMetadata: { mode: 'proactive', decision: 'quiet_exit', nodePath: ['quietExit'] },
    } as never);

    const summary = await runFleetGraphTick({ mode: 'execute', workspaceId, principal, db: { query: vi.fn() } });

    expect(summary.detectorDecisions).toBe(0);
    expect(runFleetGraph).toHaveBeenCalledWith(expect.objectContaining({
      trigger: { type: 'quiet_exit', quietExits },
      triggerReason: 'manual-run',
    }), expect.any(Object));
  });
});
