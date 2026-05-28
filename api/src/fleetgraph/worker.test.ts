// Verifies FleetGraph worker scheduling, locking, and one-tick execution stay bounded.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pgResult } from '../test/pg-result.js';
import { runFleetGraphWorkerTick, startFleetGraphWorker } from './execution/worker.js';
import type { ResolvedFleetGraphConfig } from '../config/fleetgraph.js';
import type { FleetGraphExecuteTickSummary, FleetGraphTickInput } from './execution/tick-runner.js';

type RunTickFn = (
  input: Extract<FleetGraphTickInput, { mode: 'execute' }>
) => Promise<FleetGraphExecuteTickSummary>;

const baseConfig: ResolvedFleetGraphConfig = {
  workerEnabled: true,
  workerIntervalMs: 120_000,
  workerWorkspaceLimit: 2,
  workerCandidateLimit: 3,
  workerTickDeadlineMs: 240_000,
  manualRunApiEnabled: true,
  modelName: null,
  tracingEnabled: false,
  traceProject: null,
};

const tickRow = {
  id: '88888888-8888-4888-8888-888888888888',
  instance_id: 'worker-1',
  status: 'running',
  started_at: new Date('2026-05-26T12:00:00Z'),
  heartbeat_at: new Date('2026-05-26T12:00:00Z'),
  deadline_at: new Date('2026-05-26T12:04:00Z'),
  completed_at: null,
  workspace_count: 0,
  detector_decision_count: 0,
  result_count: 0,
  model_call_count: 0,
  error_metadata: {},
  audit_metadata: {},
  created_at: new Date('2026-05-26T12:00:00Z'),
};

function createDb() {
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return pgResult([{ locked: true }]);
      if (sql.includes('INSERT INTO fleetgraph_worker_ticks')) return pgResult([tickRow]);
      if (sql.includes('FROM workspaces')) return pgResult([{ id: 'workspace-1' }, { id: 'workspace-2' }]);
      if (sql.includes('UPDATE fleetgraph_worker_ticks')) return pgResult([tickRow]);
      if (sql.includes('pg_advisory_unlock')) return pgResult([{ pg_advisory_unlock: true }]);
      return pgResult([]);
    }),
  };
  return {
    client,
    db: { query: vi.fn(), connect: vi.fn(async () => client) },
  };
}

function result(modelCalls = 0): FleetGraphExecuteTickSummary {
  return {
    mode: 'proactive',
    detectorDecisions: 1,
    results: [{
      decision: 'create_finding',
      finding: null,
      run: {} as never,
      runInput: {} as never,
      evidence: [],
      traceMetadata: { mode: 'proactive', decision: 'create_finding', nodePath: ['produceOutput'] },
      tokenMetadata: { modelCalls },
      costMetadata: {},
      errorMetadata: {},
    }],
  };
}

describe('FleetGraph worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not schedule when disabled', async () => {
    const setTimeoutFn = vi.fn() as unknown as typeof setTimeout;
    const stop = startFleetGraphWorker({
      config: { ...baseConfig, workerEnabled: false },
      setTimeoutFn,
    });

    await stop();

    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  it('runs immediately, then schedules with recursive timeout and clears pending work on stop', async () => {
    const { db } = createDb();
    const clearTimeoutFn = vi.fn() as unknown as typeof clearTimeout;
    const setTimeoutFn = vi.fn(() => 123 as unknown as ReturnType<typeof setTimeout>) as unknown as typeof setTimeout;
    const logger = { log: vi.fn(), error: vi.fn() };
    const runTick = vi.fn<RunTickFn>(async () => result(0));

    const stop = startFleetGraphWorker({
      config: baseConfig,
      db: db as never,
      runTick,
      setTimeoutFn,
      clearTimeoutFn,
      logger,
      instanceId: 'worker-1',
    });
    await vi.waitFor(() => {
      expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    });
    await stop();
    await stop();

    expect(runTick).toHaveBeenCalled();
    expect(setTimeoutFn).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledWith(123);
  });

  it('runs each active workspace through the shared execute tick with a system principal', async () => {
    const { db, client } = createDb();
    const runTick = vi.fn<RunTickFn>(async () => result(0));

    const stats = await runFleetGraphWorkerTick({
      config: baseConfig,
      db: db as never,
      runTick,
      instanceId: 'worker-1',
      now: () => new Date('2026-05-26T12:00:00Z'),
    });

    expect(stats.workspaceCount).toBe(2);
    expect(stats.selectedWorkspaceCount).toBe(2);
    expect(stats.detectorDecisionCount).toBe(2);
    expect(stats.modelCallCount).toBe(0);
    expect(runTick).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'execute',
      workspaceId: 'workspace-1',
      principal: {
        kind: 'fleetgraph_system',
        workspaceId: 'workspace-1',
        isSuperAdmin: false,
      },
      limit: 3,
      triggerReason: 'scheduled-worker',
    }));
    const firstTickInput = runTick.mock.calls[0]?.[0] as {
      graphOptions?: { generateProactiveText?: unknown };
    };
    expect(typeof firstTickInput.graphOptions?.generateProactiveText).toBe('function');
    expect(client.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1) AS locked',
      expect.any(Array)
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('skips execution when another worker holds the advisory lock', async () => {
    const { db, client } = createDb();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return pgResult([{ locked: false }]);
      if (sql.includes('INSERT INTO fleetgraph_worker_ticks')) return pgResult([tickRow]);
      if (sql.includes('UPDATE fleetgraph_worker_ticks')) return pgResult([tickRow]);
      return pgResult([]);
    });
    const runTick = vi.fn<RunTickFn>(async () => result());

    const stats = await runFleetGraphWorkerTick({
      config: baseConfig,
      db: db as never,
      runTick,
      instanceId: 'worker-1',
    });

    expect(stats.auditMetadata).toMatchObject({ skippedReason: 'advisory_lock_held' });
    expect(stats.selectedWorkspaceCount).toBe(0);
    expect(runTick).not.toHaveBeenCalled();
  });

  it('records per-workspace errors while preserving partial tick counts', async () => {
    const { db } = createDb();
    const logger = { log: vi.fn(), error: vi.fn() };
    const runTick = vi.fn<RunTickFn>(async (input) => {
      if (input.workspaceId === 'workspace-2') throw new Error('tick failed');
      return result(0);
    });

    await expect(runFleetGraphWorkerTick({
      config: baseConfig,
      db: db as never,
      runTick,
      logger,
      instanceId: 'worker-1',
    })).resolves.toMatchObject({
      workspaceCount: 2,
      selectedWorkspaceCount: 2,
      detectorDecisionCount: 1,
      resultCount: 1,
      auditMetadata: {
        workspaceFailures: [
          expect.objectContaining({ workspaceId: 'workspace-2', message: 'tick failed' }),
        ],
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[FleetGraph] Worker workspace tick failed',
      expect.objectContaining({ workspaceId: 'workspace-2', message: 'tick failed' })
    );
  });
});
