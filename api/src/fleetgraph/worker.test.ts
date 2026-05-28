// Verifies FleetGraph worker scheduling, locking, and one-tick execution stay bounded.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pgResult } from '../test/pg-result.js';
import { runFleetGraphWorkerTick, startFleetGraphWorker } from './execution/worker.js';
import type { ResolvedFleetGraphConfig } from '../config/fleetgraph.js';
import type {
  FleetGraphEventTickSummary,
  FleetGraphExecuteTickSummary,
  FleetGraphTickInput,
} from './execution/tick-runner.js';

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

function eventResult(): FleetGraphEventTickSummary {
  return {
    mode: 'proactive',
    eventId: '99999999-9999-4999-8999-999999999999',
    detectorDecisions: 1,
    results: result(0).results,
    skipped: false,
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

  it('defers the first run until the scheduled timeout and clears pending work on stop', async () => {
    const { db } = createDb();
    const clearTimeoutFn = vi.fn() as unknown as typeof clearTimeout;
    let scheduledCallback: (() => void) | null = null;
    const setTimeoutFn = vi.fn((callback: () => void) => {
      scheduledCallback = callback;
      return 123 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
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
    expect(runTick).not.toHaveBeenCalled();

    scheduledCallback?.();
    await vi.waitFor(() => {
      expect(runTick).toHaveBeenCalled();
    });
    await stop();
    await stop();

    expect(setTimeoutFn).toHaveBeenCalledTimes(2);
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

  it('can restrict a worker tick to explicit workspace ids for deterministic tests', async () => {
    const { db, client } = createDb();
    const runTick = vi.fn<RunTickFn>(async () => result(0));

    const stats = await runFleetGraphWorkerTick({
      config: baseConfig,
      db: db as never,
      runTick,
      instanceId: 'worker-1',
      workspaceIds: ['workspace-2'],
      now: () => new Date('2026-05-26T12:00:00Z'),
    });

    expect(stats.workspaceCount).toBe(1);
    expect(stats.selectedWorkspaceCount).toBe(1);
    expect(runTick).toHaveBeenCalledTimes(1);
    expect(runTick).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-2',
      principal: {
        kind: 'fleetgraph_system',
        workspaceId: 'workspace-2',
        isSuperAdmin: false,
      },
    }));
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('FROM workspaces'),
      expect.any(Array)
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('workspace_id = ANY($5::uuid[])'),
      [3, 'worker-1', new Date('2026-05-26T12:00:00Z'), 10, ['workspace-2']]
    );
  });

  it('processes claimed attention events before scheduled workspace ticks', async () => {
    const { db, client } = createDb();
    const eventRow = {
      id: '99999999-9999-4999-8999-999999999999',
      workspace_id: 'workspace-1',
      source_issue_id: '22222222-2222-4222-8222-222222222222',
      source_sprint_id: null,
      event_type: 'issue_changed',
      reason: 'issue_updated',
      status: 'processing',
      attempt_count: 1,
      last_error: null,
      available_at: new Date('2026-05-26T12:00:00Z'),
      locked_at: new Date('2026-05-26T12:00:00Z'),
      locked_by: 'worker-1',
      processed_at: null,
      created_at: new Date('2026-05-26T12:00:00Z'),
      updated_at: new Date('2026-05-26T12:00:00Z'),
    };
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return pgResult([{ locked: true }]);
      if (sql.includes('INSERT INTO fleetgraph_worker_ticks')) return pgResult([tickRow]);
      if (sql.includes('FROM workspaces')) return pgResult([{ id: 'workspace-1' }]);
      if (sql.includes('WITH claimed')) return pgResult([eventRow]);
      if (sql.includes('UPDATE fleetgraph_attention_events')) return pgResult([{ ...eventRow, status: 'completed' }]);
      if (sql.includes('UPDATE fleetgraph_worker_ticks')) return pgResult([tickRow]);
      if (sql.includes('pg_advisory_unlock')) return pgResult([{ pg_advisory_unlock: true }]);
      return pgResult([]);
    });
    const runTick = vi.fn<RunTickFn>(async () => result(0));
    const runAttentionEvent = vi.fn(async () => eventResult());

    const stats = await runFleetGraphWorkerTick({
      config: baseConfig,
      db: db as never,
      runTick,
      runAttentionEvent,
      instanceId: 'worker-1',
      now: () => new Date('2026-05-26T12:00:00Z'),
    });

    expect(stats.eventCount).toBe(1);
    expect(stats.auditMetadata.attentionEventIds).toEqual([eventRow.id]);
    expect(stats.detectorDecisionCount).toBe(2);
    expect(runAttentionEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: eventRow,
      principal: {
        kind: 'fleetgraph_system',
        workspaceId: 'workspace-1',
        isSuperAdmin: false,
      },
    }));
    expect(runTick).toHaveBeenCalledTimes(1);
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
