// Tests FleetGraph chat vs proactive-create model gate env flags.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldUseChatModel, shouldUseProactiveCreateModel } from './chat-mode.js';

describe('fleetgraph chat mode', () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env = { ...previous };
  });

  afterEach(() => {
    process.env = previous;
  });

  it('uses chat model when key and model name are set', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.FLEETGRAPH_MODEL = 'gpt-4o-mini';
    expect(shouldUseChatModel()).toBe(true);
  });

  it('skips chat model when key or model name is missing', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.FLEETGRAPH_MODEL;
    expect(shouldUseChatModel()).toBe(false);
    delete process.env.OPENAI_API_KEY;
    process.env.FLEETGRAPH_MODEL = 'gpt-4o-mini';
    expect(shouldUseChatModel()).toBe(false);
  });

  it('requires real-model flag for proactive create', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.FLEETGRAPH_MODEL = 'gpt-4o-mini';
    delete process.env.FLEETGRAPH_REAL_MODEL_ENABLED;
    expect(shouldUseProactiveCreateModel()).toBe(false);
    process.env.FLEETGRAPH_REAL_MODEL_ENABLED = 'true';
    expect(shouldUseProactiveCreateModel()).toBe(true);
  });
});
