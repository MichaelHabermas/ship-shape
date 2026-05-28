// Verifies FleetGraph LangSmith trace capture without network calls or raw data leakage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withFleetGraphLangSmithTrace } from './langsmith-trace.js';
import type { FleetGraphResult } from './types.js';

const createRun = vi.fn();
const updateRun = vi.fn();
const shareRun = vi.fn();

vi.mock('langsmith', () => ({
  Client: vi.fn(class {
    createRun = createRun;
    updateRun = updateRun;
    shareRun = shareRun;
  }),
}));

vi.mock('langsmith/run_trees', () => ({
  convertToDottedOrderFormat: vi.fn((timestamp: number, id: string, order: number) => ({
    microsecondPrecisionDatestring: new Date(timestamp).toISOString(),
    dottedOrder: `${order}.${id}`,
  })),
}));

describe('withFleetGraphLangSmithTrace', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    createRun.mockResolvedValue(undefined);
    updateRun.mockResolvedValue(undefined);
    shareRun.mockResolvedValue('https://smith.langchain.com/public/shared/r');
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_API_KEY = 'test-key';
    process.env.LANGSMITH_PROJECT = 'test-project';
    delete process.env.FLEETGRAPH_LANGSMITH_SHARE;
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = { ...previousEnv };
  });

  it('posts scrubbed root inputs, live node children, outputs, and a shared URL', async () => {
    const capture = await withFleetGraphLangSmithTrace({
      name: 'fleetgraph.test',
      inputs: {
        label: 'safe',
        token: 'secret-token',
        nested: { hidden: true },
      },
    }, async (trace, recorder) => {
      await recorder.traceNode('normalizeTrigger', {
        triggerType: 'quiet_exit',
        token: 'secret-token',
      }, async () => ({ decision: 'quiet_exit' }));
      return result(trace.traceId, trace.traceUrl);
    });

    expect(capture.sharedTraceUrl).toBe('https://smith.langchain.com/public/shared/r');
    expect(createRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }));
    expect(createRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parent_run_id: capture.traceId,
      name: 'fleetgraph.normalizeTrigger',
      inputs: { node: 'normalizeTrigger', triggerType: 'quiet_exit' },
    }));
    expect(updateRun).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      outputs: { node: 'normalizeTrigger', decision: 'quiet_exit' },
    }));
    expect(updateRun).toHaveBeenCalledWith(capture.traceId, expect.objectContaining({
      outputs: {
        decision: 'quiet_exit',
        nodePath: ['normalizeTrigger', 'produceOutput'],
        tokenMetadata: { modelCalls: 0 },
        costMetadata: {},
        errorMetadata: {},
      },
    }));
    expect(shareRun).toHaveBeenCalledWith(capture.traceId);
  });

  it('marks live node children failed when the node throws', async () => {
    const originalError = new Error('node failed');

    await expect(withFleetGraphLangSmithTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (_trace, recorder) => recorder.traceNode('detectorDecision', {
      triggerType: 'detector_decision',
    }, async () => {
      throw originalError;
    }))).rejects.toBe(originalError);

    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      name: 'fleetgraph.detectorDecision',
      inputs: { node: 'detectorDecision', triggerType: 'detector_decision' },
    }));
    expect(updateRun).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      error: 'node failed',
    }));
  });

  it('honors FLEETGRAPH_LANGSMITH_SHARE=0', async () => {
    process.env.FLEETGRAPH_LANGSMITH_SHARE = '0';

    const capture = await withFleetGraphLangSmithTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace) => result(trace.traceId, trace.traceUrl));

    expect(capture.sharedTraceUrl).toBeNull();
    expect(shareRun).not.toHaveBeenCalled();
  });

  it('posts a sanitized LLM child run with LangSmith usage metadata when tokens are present', async () => {
    const capture = await withFleetGraphLangSmithTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace) => result(trace.traceId, trace.traceUrl, {
      modelCalls: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 120,
      outputTokens: 24,
      totalTokens: 144,
    }));

    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
      parent_run_id: capture.traceId,
      name: 'fleetgraph.proactive_create_model',
      run_type: 'llm',
      inputs: { messages: [{ role: 'user', content: '[redacted FleetGraph model input]' }] },
      outputs: {
        generations: [{ message: { role: 'assistant', content: '[redacted FleetGraph model output]' } }],
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 24,
          total_tokens: 144,
        },
      },
      extra: {
        metadata: {
          ls_provider: 'openai',
          ls_model_name: 'gpt-4o-mini',
        },
      },
    }));
  });

  it('preserves the original run error when LangSmith failure cleanup also fails', async () => {
    const originalError = new Error('fleetgraph failed');
    updateRun.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(withFleetGraphLangSmithTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async () => {
      throw originalError;
    })).rejects.toBe(originalError);
  });
});

function result(
  traceId: string | undefined,
  traceUrl: string | undefined,
  tokenMetadata: FleetGraphResult['tokenMetadata'] = { modelCalls: 0 }
): FleetGraphResult {
  const traceMetadata = {
    traceId,
    traceUrl,
    mode: 'proactive' as const,
    decision: 'quiet_exit' as const,
    nodePath: ['normalizeTrigger', 'produceOutput'],
  };
  return {
    decision: 'quiet_exit',
    finding: null,
    run: {
      id: '00000000-0000-4000-8000-000000000001',
      workspace_id: '00000000-0000-4000-8000-000000000002',
      finding_id: null,
      source_issue_id: null,
      source_sprint_id: null,
      mode: 'proactive',
      trigger_reason: 'test',
      decision: 'quiet_exit',
      dedupe_key: null,
      input_snapshot: {},
      evidence_snapshot: [],
      output_snapshot: {},
      trace_metadata: traceMetadata,
      token_metadata: tokenMetadata,
      cost_metadata: {},
      error_metadata: {},
      started_at: new Date(),
      completed_at: new Date(),
      created_at: new Date(),
    },
    runInput: {
      workspaceId: '00000000-0000-4000-8000-000000000002',
      mode: 'proactive',
      triggerReason: 'test',
      decision: 'quiet_exit',
      inputSnapshot: {},
      evidenceSnapshot: [],
      outputSnapshot: {},
      traceMetadata,
      tokenMetadata,
      costMetadata: {},
      errorMetadata: {},
    },
    evidence: [],
    traceMetadata,
    tokenMetadata,
    costMetadata: {},
    errorMetadata: {},
  };
}
