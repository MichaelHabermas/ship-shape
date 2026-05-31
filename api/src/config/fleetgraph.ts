// Parses FleetGraph environment flags without starting workers or graph runs.
export interface ResolvedFleetGraphConfig {
  workerEnabled: boolean;
  workerIntervalMs: number;
  workerWorkspaceLimit: number;
  workerCandidateLimit: number;
  workerTickDeadlineMs: number;
  manualRunApiEnabled: boolean;
  modelName: string | null;
  tracingEnabled: boolean;
  traceProject: string | null;
}

export type FleetGraphConfig = Partial<ResolvedFleetGraphConfig>;

const DEFAULT_WORKER_INTERVAL_MS = 120_000;
const DEFAULT_WORKER_WORKSPACE_LIMIT = 25;
const DEFAULT_WORKER_CANDIDATE_LIMIT = 3;
const DEFAULT_WORKER_TICK_DEADLINE_MS = 240_000;

function envFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function envInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function fleetGraphConfig(env: NodeJS.ProcessEnv = process.env): ResolvedFleetGraphConfig {
  return {
    workerEnabled: envFlag(env.FLEETGRAPH_WORKER_ENABLED),
    workerIntervalMs: envInt(env.FLEETGRAPH_WORKER_INTERVAL_MS, DEFAULT_WORKER_INTERVAL_MS),
    workerWorkspaceLimit: envInt(env.FLEETGRAPH_WORKER_WORKSPACE_LIMIT, DEFAULT_WORKER_WORKSPACE_LIMIT),
    workerCandidateLimit: envInt(env.FLEETGRAPH_WORKER_CANDIDATE_LIMIT, DEFAULT_WORKER_CANDIDATE_LIMIT),
    workerTickDeadlineMs: envInt(
      env.FLEETGRAPH_WORKER_TICK_DEADLINE_MS ?? env.FLEETGRAPH_WORKER_TICK_TIMEOUT_MS,
      DEFAULT_WORKER_TICK_DEADLINE_MS
    ),
    manualRunApiEnabled: env.NODE_ENV !== 'production' || envFlag(env.FLEETGRAPH_MANUAL_RUN_API_ENABLED),
    modelName: env.FLEETGRAPH_MODEL?.trim() || null,
    tracingEnabled: envFlag(env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED) && (
      envFlag(env.LANGSMITH_TRACING) || envFlag(env.LANGCHAIN_TRACING_V2)
    ),
    traceProject: env.LANGSMITH_PROJECT?.trim() || env.LANGCHAIN_PROJECT?.trim() || null,
  };
}
