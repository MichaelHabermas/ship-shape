// FleetGraph worker owns scheduled proactive scans without creating a second graph path.
import { randomUUID } from 'crypto';
import {
  fleetGraphConfig,
  type FleetGraphConfig,
  type ResolvedFleetGraphConfig,
} from '../../config/fleetgraph.js';
import { pool } from '../../db/client.js';
import type { Principal } from '../../security/principal.js';
import { deterministicProactiveCreateText } from '../model.js';
import {
  claimFleetGraphAttentionEvents,
  completeFleetGraphAttentionEvent,
  completeFleetGraphWorkerTick,
  failFleetGraphAttentionEvent,
  heartbeatFleetGraphWorkerTick,
  startFleetGraphWorkerTick,
  type JsonRecord,
} from '../persistence.js';
import {
  runFleetGraphAttentionEvent,
  runFleetGraphTick,
  type FleetGraphExecuteTickSummary,
  type FleetGraphEventTickSummary,
  type FleetGraphTickInput,
} from './tick-runner.js';

type QueryRunner = Pick<typeof pool, 'query'>;
type PoolClientLike = QueryRunner & { release: () => void };
type WorkerDb = QueryRunner & { connect: () => Promise<PoolClientLike> };

type WorkerLogger = Pick<typeof console, 'log' | 'error'>;
type WorkerRunTick = (
  input: Extract<FleetGraphTickInput, { mode: 'execute' }>
) => Promise<FleetGraphExecuteTickSummary>;
type WorkerRunAttentionEvent = typeof runFleetGraphAttentionEvent;

type TimerHandle = ReturnType<typeof setTimeout>;

export type FleetGraphWorkerOptions = {
  config?: FleetGraphConfig;
  db?: WorkerDb;
  logger?: WorkerLogger;
  instanceId?: string;
  workspaceIds?: string[];
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  runTick?: WorkerRunTick;
  runAttentionEvent?: WorkerRunAttentionEvent;
  now?: () => Date;
};

type WorkerTickStats = {
  workspaceCount: number;
  selectedWorkspaceCount: number;
  detectorDecisionCount: number;
  resultCount: number;
  eventCount: number;
  modelCallCount: number;
  auditMetadata: JsonRecord;
};

const FLEETGRAPH_WORKER_LOCK_KEY = 7_106_506_001;

function fleetGraphSystemPrincipal(workspaceId: string): Principal {
  return {
    kind: 'fleetgraph_system',
    workspaceId,
    isSuperAdmin: false,
  };
}

function safeErrorMetadata(error: unknown): JsonRecord {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

function workspaceFailures(metadata: JsonRecord): JsonRecord[] {
  return Array.isArray(metadata.workspaceFailures)
    ? metadata.workspaceFailures.filter((failure): failure is JsonRecord => (
      failure !== null && typeof failure === 'object' && !Array.isArray(failure)
    ))
    : [];
}

function eventFailures(metadata: JsonRecord): JsonRecord[] {
  return Array.isArray(metadata.eventFailures)
    ? metadata.eventFailures.filter((failure): failure is JsonRecord => (
      failure !== null && typeof failure === 'object' && !Array.isArray(failure)
    ))
    : [];
}

function resolveWorkerConfig(config?: FleetGraphConfig): ResolvedFleetGraphConfig {
  if (!config) return fleetGraphConfig();
  const definedOverrides = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  );
  return { ...fleetGraphConfig(), ...definedOverrides };
}

async function listWorkerWorkspaces(
  db: QueryRunner,
  limit: number
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workspaces
      WHERE archived_at IS NULL
      ORDER BY updated_at DESC, created_at DESC
      LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => row.id);
}

async function tryAcquireWorkerLock(db: QueryRunner): Promise<boolean> {
  const result = await db.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [FLEETGRAPH_WORKER_LOCK_KEY]
  );

  return result.rows[0]?.locked === true;
}

async function releaseWorkerLock(db: QueryRunner): Promise<void> {
  await db.query('SELECT pg_advisory_unlock($1)', [FLEETGRAPH_WORKER_LOCK_KEY]);
}

function modelCallsForSummary(summary: FleetGraphExecuteTickSummary): number {
  return summary.results.reduce((total, result) => (
    total + (result.tokenMetadata?.modelCalls ?? 0)
  ), 0);
}

async function runWorkspaceTick(input: {
  workspaceId: string;
  config: ResolvedFleetGraphConfig;
  runTick: WorkerRunTick;
}): Promise<FleetGraphExecuteTickSummary> {
  return input.runTick({
    mode: 'execute',
    workspaceId: input.workspaceId,
    principal: fleetGraphSystemPrincipal(input.workspaceId),
    limit: input.config.workerCandidateLimit,
    triggerReason: 'scheduled-worker',
    graphOptions: {
      generateProactiveText: async ({ candidate }) => deterministicProactiveCreateText(candidate),
    },
  });
}

export async function runFleetGraphWorkerTick(options: FleetGraphWorkerOptions = {}): Promise<WorkerTickStats> {
  const config = resolveWorkerConfig(options.config);
  const db = options.db ?? pool;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const runTick = options.runTick ?? runFleetGraphTick;
  const runAttentionEvent = options.runAttentionEvent ?? runFleetGraphAttentionEvent;
  const instanceId = options.instanceId ?? `fleetgraph-${randomUUID()}`;
  const deadlineAt = new Date(now().getTime() + config.workerTickDeadlineMs);
  const client = await db.connect();
  let lockAcquired = false;
  let tickId: string | null = null;
  const stats: WorkerTickStats = {
    workspaceCount: 0,
    selectedWorkspaceCount: 0,
    detectorDecisionCount: 0,
    resultCount: 0,
    eventCount: 0,
    modelCallCount: 0,
    auditMetadata: {
      deadlineAt: deadlineAt.toISOString(),
      workspaceIds: [],
    },
  };

  try {
    lockAcquired = await tryAcquireWorkerLock(client);
    const tick = await startFleetGraphWorkerTick({ instanceId, deadlineAt }, client);
    tickId = tick.id;

    if (!lockAcquired) {
      await completeFleetGraphWorkerTick({
        tickId,
        status: 'skipped_lock',
        auditMetadata: { ...stats.auditMetadata, skippedReason: 'advisory_lock_held' },
      }, client);
      return {
        workspaceCount: 0,
        selectedWorkspaceCount: 0,
        detectorDecisionCount: 0,
        resultCount: 0,
        eventCount: 0,
        modelCallCount: 0,
        auditMetadata: { ...stats.auditMetadata, skippedReason: 'advisory_lock_held' },
      };
    }

    const workspaceIds = options.workspaceIds ?? await listWorkerWorkspaces(client, config.workerWorkspaceLimit);
    stats.selectedWorkspaceCount = workspaceIds.length;
    stats.auditMetadata.workerStartedAt = tick.started_at.toISOString();
    stats.auditMetadata.workspaceIds = workspaceIds;

    const attentionEvents = await claimFleetGraphAttentionEvents({
      lockedBy: instanceId,
      limit: config.workerCandidateLimit * Math.max(1, workspaceIds.length),
      now: now(),
      workspaceIds,
    }, client);
    stats.eventCount = attentionEvents.length;
    stats.auditMetadata.attentionEventIds = attentionEvents.map((event) => event.id);

    for (const event of attentionEvents) {
      if (now().getTime() > deadlineAt.getTime()) {
        stats.auditMetadata.deadlineReached = true;
        break;
      }

      try {
        const summary: FleetGraphEventTickSummary = await runAttentionEvent({
          event,
          principal: fleetGraphSystemPrincipal(event.workspace_id),
          db: client,
          graphOptions: {
            generateProactiveText: async ({ candidate }) => deterministicProactiveCreateText(candidate),
          },
        });
        stats.detectorDecisionCount += summary.detectorDecisions;
        stats.resultCount += summary.results.length;
        stats.modelCallCount += modelCallsForSummary(summary);
        await completeFleetGraphAttentionEvent({
          eventId: event.id,
          status: summary.skipped ? 'skipped' : 'completed',
        }, client);
      } catch (error) {
        logger.error('[FleetGraph] Attention event failed', {
          eventId: event.id,
          workspaceId: event.workspace_id,
          ...safeErrorMetadata(error),
        });
        const lastError = error instanceof Error ? error.message : String(error);
        const failedEvent = await failFleetGraphAttentionEvent({
          eventId: event.id,
          lastError,
          now: now(),
        }, client);
        stats.auditMetadata.eventFailures = [
          ...eventFailures(stats.auditMetadata),
          {
            eventId: event.id,
            status: failedEvent?.status ?? 'unknown',
            attemptCount: failedEvent?.attempt_count,
            ...safeErrorMetadata(error),
          },
        ];
      }
    }

    for (const workspaceId of workspaceIds) {
      if (now().getTime() > deadlineAt.getTime()) {
        stats.auditMetadata.deadlineReached = true;
        break;
      }

      await heartbeatFleetGraphWorkerTick(tickId, client);
      stats.workspaceCount += 1;

      try {
        const summary = await runWorkspaceTick({ workspaceId, config, runTick });
        stats.detectorDecisionCount += summary.detectorDecisions;
        stats.resultCount += summary.results.length;
        stats.modelCallCount += modelCallsForSummary(summary);
      } catch (error) {
        logger.error('[FleetGraph] Worker workspace tick failed', {
          workspaceId,
          ...safeErrorMetadata(error),
        });
        stats.auditMetadata.workspaceFailures = [
          ...workspaceFailures(stats.auditMetadata),
          { workspaceId, ...safeErrorMetadata(error) },
        ];
      }
    }

    stats.auditMetadata.completedAt = now().toISOString();
    const workspaceFailureCount = workspaceFailures(stats.auditMetadata).length;
    await completeFleetGraphWorkerTick({
      tickId,
      status: workspaceFailureCount > 0 ? 'failed' : 'completed',
      workspaceCount: stats.workspaceCount,
      detectorDecisionCount: stats.detectorDecisionCount,
      resultCount: stats.resultCount,
      modelCallCount: stats.modelCallCount,
      errorMetadata: workspaceFailureCount > 0 ? { workspaceFailureCount } : undefined,
      auditMetadata: stats.auditMetadata,
    }, client);

    return stats;
  } catch (error) {
    logger.error('[FleetGraph] Worker tick failed', safeErrorMetadata(error));
    stats.auditMetadata.failed = true;
    stats.auditMetadata.failedAt = now().toISOString();
    if (tickId) {
      await completeFleetGraphWorkerTick({
        tickId,
        status: 'failed',
        workspaceCount: stats.workspaceCount,
        detectorDecisionCount: stats.detectorDecisionCount,
        resultCount: stats.resultCount,
        modelCallCount: stats.modelCallCount,
        errorMetadata: safeErrorMetadata(error),
        auditMetadata: stats.auditMetadata,
      }, client).catch((metadataError) => {
        logger.error('[FleetGraph] Failed to record worker tick error', safeErrorMetadata(metadataError));
      });
    }
    return stats;
  } finally {
    if (lockAcquired) {
      await releaseWorkerLock(client).catch((error) => {
        logger.error('[FleetGraph] Failed to release worker advisory lock', safeErrorMetadata(error));
      });
    }
    client.release();
  }
}

export function startFleetGraphWorker(options: FleetGraphWorkerOptions = {}): () => Promise<void> {
  const config = resolveWorkerConfig(options.config);
  const logger = options.logger ?? console;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const instanceId = options.instanceId ?? `fleetgraph-${randomUUID()}`;
  let stopped = false;
  let timer: TimerHandle | null = null;
  let runningTick: Promise<unknown> | null = null;

  if (!config.workerEnabled) {
    return async () => {};
  }

  const runOnce = () => {
    runningTick = runFleetGraphWorkerTick({ ...options, config, logger, instanceId })
      .catch((error) => {
        logger.error('[FleetGraph] Worker loop failed', safeErrorMetadata(error));
      })
      .finally(() => {
        runningTick = null;
        scheduleNext();
      });
  };

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeoutFn(() => {
      timer = null;
      runOnce();
    }, config.workerIntervalMs);
  };

  logger.log(`[FleetGraph] Worker enabled; interval=${config.workerIntervalMs}ms instance=${instanceId}`);
  runOnce();

  return async () => {
    if (stopped) return;
    stopped = true;
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (runningTick) {
      await runningTick;
    }
  };
}
