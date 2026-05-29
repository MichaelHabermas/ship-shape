import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateProactiveCreateText } from './model.js';
import type { FleetGraphAttentionCandidate } from './detection/detector.js';

const invoke = vi.fn();
const chatOpenAIOptions = vi.hoisted(() => vi.fn());

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(class {
    constructor(options: unknown) {
      chatOpenAIOptions(options);
    }

    invoke = invoke;
  }),
}));

describe('generateProactiveCreateText', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.FLEETGRAPH_REAL_MODEL_ENABLED = 'true';
    process.env.FLEETGRAPH_MODEL = 'gpt-4o-mini';
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.FLEETGRAPH_MODEL_INPUT_COST_PER_1M;
    delete process.env.FLEETGRAPH_MODEL_CACHED_INPUT_COST_PER_1M;
    delete process.env.FLEETGRAPH_MODEL_OUTPUT_COST_PER_1M;
    invoke.mockResolvedValue({
      content: 'Blocked by API access.\n\nCan you confirm who owns the API access unblocker?',
      usage_metadata: {
        input_tokens: 120,
        output_tokens: 24,
        total_tokens: 144,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = { ...previousEnv };
  });

  it('captures provider, model, token usage, and catalog cost from real model responses', async () => {
    const result = await generateProactiveCreateText({ candidate });

    expect(result.tokenMetadata).toEqual({
      modelCalls: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 120,
      outputTokens: 24,
      totalTokens: 144,
      usageSource: 'model_response',
    });
    expect(result.costMetadata.estimatedCostUsd).toBeCloseTo(0.0000324);
  });

  it('estimates cost only from explicit per-million-token env pricing', async () => {
    process.env.FLEETGRAPH_MODEL_INPUT_COST_PER_1M = '0.15';
    process.env.FLEETGRAPH_MODEL_CACHED_INPUT_COST_PER_1M = '0.075';
    process.env.FLEETGRAPH_MODEL_OUTPUT_COST_PER_1M = '0.60';

    const result = await generateProactiveCreateText({ candidate });

    expect(result.costMetadata.estimatedCostUsd).toBeCloseTo(0.0000324);
  });

  it('tracks cached input tokens and prices them separately when the provider reports them', async () => {
    process.env.FLEETGRAPH_MODEL = 'gpt-5.5';
    invoke.mockResolvedValueOnce({
      content: 'Blocked by API access.\n\nCan you confirm who owns the API access unblocker?',
      usage_metadata: {
        input_tokens: 120,
        input_token_details: {
          cached_tokens: 40,
        },
        output_tokens: 24,
        total_tokens: 144,
      },
    });

    const result = await generateProactiveCreateText({ candidate });

    expect(result.tokenMetadata).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 40,
      billableInputTokens: 80,
      outputTokens: 24,
    });
    expect(result.costMetadata).toMatchObject({
      inputCostUsd: 0.0004,
      cachedInputCostUsd: 0.00002,
      outputCostUsd: 0.00072,
      costSource: 'catalog_estimate',
    });
    expect(result.costMetadata.estimatedCostUsd).toBeCloseTo(0.00114);
  });

  it('omits temperature for models that only support the provider default', async () => {
    process.env.FLEETGRAPH_MODEL = 'gpt-5-mini';

    await generateProactiveCreateText({ candidate });

    expect(chatOpenAIOptions).toHaveBeenCalledWith({ model: 'gpt-5-mini' });
  });

  it('estimates GPT-5.5 cost from the pricing catalog', async () => {
    process.env.FLEETGRAPH_MODEL = 'gpt-5.5';

    const result = await generateProactiveCreateText({ candidate });

    expect(result.costMetadata).toMatchObject({
      currency: 'USD',
      costSource: 'catalog_estimate',
    });
    expect(result.costMetadata.estimatedCostUsd).toBeCloseTo(0.00132);
  });

  it('estimates GPT-5.4 cost from the pricing catalog', async () => {
    process.env.FLEETGRAPH_MODEL = 'gpt-5.4';

    const result = await generateProactiveCreateText({ candidate });

    expect(result.costMetadata).toMatchObject({
      currency: 'USD',
      costSource: 'catalog_estimate',
    });
    expect(result.costMetadata.estimatedCostUsd).toBeCloseTo(0.00066);
  });
});

const candidate: FleetGraphAttentionCandidate = {
  workspace_id: '00000000-0000-4000-8000-000000000001',
  issue_id: '00000000-0000-4000-8000-000000000002',
  sprint_id: '00000000-0000-4000-8000-000000000003',
  issue_title: 'API handoff',
  issue_ticket_number: 12,
  issue_state: 'blocked',
  sprint_title: 'Week 5',
  sprint_number: 5,
  issue_priority: 'high',
  issue_assignee_id: null,
  issue_assignee_name: null,
  sprint_owner_id: null,
  sprint_owner_name: null,
  project_id: null,
  project_title: null,
  project_owner_id: null,
  project_owner_name: null,
  program_id: null,
  program_title: null,
  program_owner_id: null,
  program_owner_name: null,
  blocker_text: 'Blocked by API access.',
  blocker_iteration_id: null,
  blocker_iteration_created_at: null,
  dedupeKey: 'blocked-important-issue:workspace:issue:sprint',
  attentionReason: 'Issue is blocked.',
  signalType: 'blocked',
  signalLabel: 'Blocked',
};
