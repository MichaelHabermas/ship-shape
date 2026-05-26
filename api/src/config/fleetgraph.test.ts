// Verifies FleetGraph environment defaults and opt-in parsing stay inert by default.
import { describe, expect, it } from 'vitest';
import { fleetGraphConfig } from './fleetgraph.js';

describe('fleetGraphConfig', () => {
  it('keeps the worker disabled by default', () => {
    expect(fleetGraphConfig({})).toEqual({
      workerEnabled: false,
      workerIntervalMs: 120000,
      manualRunApiEnabled: true,
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
      FLEETGRAPH_MANUAL_RUN_API_ENABLED: 'true',
      LANGSMITH_TRACING: 'true',
      LANGSMITH_PROJECT: 'ship-fleetgraph',
    })).toEqual({
      workerEnabled: true,
      workerIntervalMs: 30000,
      manualRunApiEnabled: true,
      modelName: 'gpt-4.1-mini',
      tracingEnabled: true,
      traceProject: 'ship-fleetgraph',
    });
  });

  it('fails closed for manual API runs in production unless explicitly enabled', () => {
    expect(fleetGraphConfig({ NODE_ENV: 'production' }).manualRunApiEnabled).toBe(false);
    expect(fleetGraphConfig({
      NODE_ENV: 'production',
      FLEETGRAPH_MANUAL_RUN_API_ENABLED: 'true',
    }).manualRunApiEnabled).toBe(true);
  });

  it('falls back to the 2-minute worker interval for invalid values', () => {
    expect(fleetGraphConfig({ FLEETGRAPH_WORKER_INTERVAL_MS: '-1' }).workerIntervalMs).toBe(120000);
    expect(fleetGraphConfig({ FLEETGRAPH_WORKER_INTERVAL_MS: 'nope' }).workerIntervalMs).toBe(120000);
  });
});
