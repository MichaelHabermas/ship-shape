// Parses FleetGraph environment flags without starting workers or graph runs.
export interface FleetGraphConfig {
  workerEnabled: boolean;
  workerIntervalMs: number;
  modelName: string | null;
  tracingEnabled: boolean;
  traceProject: string | null;
}

const DEFAULT_WORKER_INTERVAL_MS = 120_000;

function envFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function envInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function fleetGraphConfig(env: NodeJS.ProcessEnv = process.env): FleetGraphConfig {
  return {
    workerEnabled: envFlag(env.FLEETGRAPH_WORKER_ENABLED),
    workerIntervalMs: envInt(env.FLEETGRAPH_WORKER_INTERVAL_MS, DEFAULT_WORKER_INTERVAL_MS),
    modelName: env.FLEETGRAPH_MODEL?.trim() || null,
    tracingEnabled: envFlag(env.LANGSMITH_TRACING) || envFlag(env.LANGCHAIN_TRACING_V2),
    traceProject: env.LANGSMITH_PROJECT?.trim() || env.LANGCHAIN_PROJECT?.trim() || null,
  };
}
