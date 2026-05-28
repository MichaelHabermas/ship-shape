// Verifies the gated manual FleetGraph API wrapper calls the shared execute tick.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runFleetGraphManualTick } from './execution/manual-run.js';
import { runFleetGraphTick } from './execution/tick-runner.js';
import type { Principal } from '../security/principal.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '55555555-5555-4555-8555-555555555555';

const principal: Principal = {
  kind: 'session',
  sessionId: 'session-1',
  userId,
  workspaceId,
  isSuperAdmin: false,
};

vi.mock('./execution/tick-runner.js', () => ({
  runFleetGraphTick: vi.fn(),
}));

describe('FleetGraph manual run', () => {
  beforeEach(() => {
    vi.mocked(runFleetGraphTick).mockReset();
  });

  it('delegates to the shared execute tick runner', async () => {
    vi.mocked(runFleetGraphTick).mockResolvedValue({
      mode: 'proactive',
      detectorDecisions: 1,
      results: [],
    });

    const today = new Date('2026-05-26T00:00:00Z');
    const graphOptions = {};
    const summary = await runFleetGraphManualTick({ workspaceId, principal, today, limit: 3, graphOptions });

    expect(summary.detectorDecisions).toBe(1);
    expect(runFleetGraphTick).toHaveBeenCalledWith({
      mode: 'execute',
      workspaceId,
      principal,
      today,
      limit: 3,
      triggerReason: 'manual-run',
      db: undefined,
      graphOptions,
    });
  });
});
