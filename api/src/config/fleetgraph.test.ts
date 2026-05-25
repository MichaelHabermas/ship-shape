// Verifies FleetGraph environment defaults and opt-in parsing stay inert by default.
import { describe, expect, it } from 'vitest';
import { fleetGraphConfig } from './fleetgraph.js';

describe('fleetGraphConfig', () => {
  it('keeps the worker disabled by default', () => {
    expect(fleetGraphConfig({})).toEqual({
      workerEnabled: false,
      workerIntervalMs: 120000,
      modelName: null,
      tracingEnabled: false,
      traceProject: null,
    });
  });

  it('parses worker, model, and tracing configuration when explicitly enabled', () => {
    expect(fleetGraphConfig({
      FLEETGRAPH_WORKER_ENABLED: 'true',
      FLEETGRAPH_WORKER_INTERVAL_MS: '30000',
      FLEETGRAPH_MODEL: 'gpt-4.1-mini',
      LANGSMITH_TRACING: 'true',
      LANGSMITH_PROJECT: 'ship-fleetgraph',
    })).toEqual({
      workerEnabled: true,
      workerIntervalMs: 30000,
      modelName: 'gpt-4.1-mini',
      tracingEnabled: true,
      traceProject: 'ship-fleetgraph',
    });
  });

  it('falls back to the 2-minute worker interval for invalid values', () => {
    expect(fleetGraphConfig({ FLEETGRAPH_WORKER_INTERVAL_MS: '-1' }).workerIntervalMs).toBe(120000);
    expect(fleetGraphConfig({ FLEETGRAPH_WORKER_INTERVAL_MS: 'nope' }).workerIntervalMs).toBe(120000);
  });
});
