// Verifies FleetGraph external tracing stays best-effort and reviewer-safe.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postFleetGraphTraceScores, shutdownFleetGraphTracing, withFleetGraphTrace } from './observability-trace.js';
import type { FleetGraphResult } from './types.js';

const objectContaining = (sample: Record<string, unknown>): unknown => expect.objectContaining(sample);

const mocks = vi.hoisted(() => {
  const childSpan = {
    update: vi.fn(),
    end: vi.fn(),
  };
  const generationSpan = {
    update: vi.fn(),
    end: vi.fn(),
  };
  const rootSpan = {
    traceId: 'langfuse-trace-id',
    update: vi.fn(),
    end: vi.fn(),
    setTraceAsPublic: vi.fn(),
    startObservation: vi.fn((_name: string, _attrs: Record<string, unknown>, options?: { asType?: string }) =>
      options?.asType === 'generation' ? generationSpan : childSpan
    ),
  };

  return {
    createRun: vi.fn(),
    updateRun: vi.fn(),
    shareRun: vi.fn(),
    createFeedback: vi.fn(),
    getTraceUrl: vi.fn(),
    langfuseScoreCreate: vi.fn(),
    langfuseFlush: vi.fn(),
    clientShutdown: vi.fn(),
    sdkStart: vi.fn(),
    sdkShutdown: vi.fn(),
    startObservation: vi.fn(() => rootSpan),
    rootSpan,
    childSpan,
    generationSpan,
  };
});

vi.mock('langsmith', () => ({
  Client: vi.fn(class {
    createRun = mocks.createRun;
    updateRun = mocks.updateRun;
    shareRun = mocks.shareRun;
    createFeedback = mocks.createFeedback;
  }),
}));

vi.mock('langsmith/run_trees', () => ({
  convertToDottedOrderFormat: vi.fn((timestamp: number, id: string, order: number) => ({
    microsecondPrecisionDatestring: new Date(timestamp).toISOString(),
    dottedOrder: `${order}.${id}`,
  })),
}));

vi.mock('@langfuse/client', () => ({
  LangfuseClient: vi.fn(class {
    getTraceUrl = mocks.getTraceUrl;
    score = { create: mocks.langfuseScoreCreate };
    flush = mocks.langfuseFlush;
    shutdown = mocks.clientShutdown;
  }),
}));

vi.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: vi.fn(class {}),
}));

vi.mock('@langfuse/tracing', () => ({
  startObservation: mocks.startObservation,
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn(class {
    start = mocks.sdkStart;
    shutdown = mocks.sdkShutdown;
  }),
}));

describe('withFleetGraphTrace', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRun.mockResolvedValue(undefined);
    mocks.updateRun.mockResolvedValue(undefined);
    mocks.shareRun.mockResolvedValue('https://smith.langchain.com/public/shared/r');
    mocks.createFeedback.mockResolvedValue(undefined);
    mocks.getTraceUrl.mockResolvedValue('https://us.cloud.langfuse.com/project/project-id/traces/langfuse-trace-id');
    mocks.langfuseFlush.mockResolvedValue(undefined);
    mocks.clientShutdown.mockResolvedValue(undefined);
    mocks.sdkShutdown.mockResolvedValue(undefined);
    delete process.env.LANGSMITH_TRACING;
    delete process.env.LANGCHAIN_TRACING_V2;
    delete process.env.LANGSMITH_API_KEY;
    delete process.env.LANGSMITH_PROJECT;
    delete process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED;
    delete process.env.FLEETGRAPH_LANGSMITH_SHARE;
    delete process.env.LANGFUSE_TRACING;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
    delete process.env.FLEETGRAPH_LANGFUSE_SHARE;
  });

  afterEach(async () => {
    await shutdownFleetGraphTracing().catch(() => undefined);
    process.env = { ...previousEnv };
  });

  it('posts scrubbed LangSmith root inputs, live node children, outputs, and a shared URL', async () => {
    enableLangSmith();

    const capture = await withFleetGraphTrace({
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

    const rootRun = findCreateRun('fleetgraph.test');
    const nodeRun = findCreateRun('fleetgraph.normalizeTrigger');

    expect(capture.providers).toHaveLength(1);
    expect(capture.providers[0]?.provider).toBe('langsmith');
    expect(capture.sharedTraceUrl).toBe('https://smith.langchain.com/public/shared/r');
    expect(rootRun).toMatchObject({ inputs: { label: 'safe' } });
    expect(nodeRun).toMatchObject({
      parent_run_id: capture.traceId,
      inputs: { node: 'normalizeTrigger', triggerType: 'quiet_exit' },
    });
    expect(mocks.updateRun).toHaveBeenCalledWith(expect.any(String), objectContaining({
      outputs: { node: 'normalizeTrigger', decision: 'quiet_exit' },
    }));
    expect(findUpdateRun(capture.traceId).outputs).toMatchObject({
      decision: 'quiet_exit',
      nodePath: ['normalizeTrigger', 'produceOutput'],
      tokenUsage: {
        label: 'none',
        modelCalls: 0,
        provider: 'none',
        model: 'none',
      },
      costUsage: {
        label: 'none',
        currency: 'none',
      },
    });
    expect(mocks.shareRun).toHaveBeenCalledWith(capture.traceId);
  });

  it('posts Langfuse root, node, generation, and public trace evidence', async () => {
    enableLangfuse();

    const capture = await withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe', token: 'secret-token' },
    }, async (trace, recorder) => {
      await recorder.traceNode('normalizeTrigger', {
        triggerType: 'quiet_exit',
      }, async () => ({ decision: 'quiet_exit' }));
      return result(trace.traceId, trace.traceUrl, {
        modelCalls: 1,
        provider: 'openai',
        model: 'gpt-4o-mini',
        inputTokens: 120,
        outputTokens: 24,
        totalTokens: 144,
      });
    });

    expect(capture.traceId).toBe('langfuse-trace-id');
    expect(capture.sharedTraceUrl).toBe('https://us.cloud.langfuse.com/project/project-id/traces/langfuse-trace-id');
    expect(mocks.startObservation).toHaveBeenCalledWith('fleetgraph.test', objectContaining({
      input: { label: 'safe' },
    }), { asType: 'agent' });
    expect(mocks.rootSpan.setTraceAsPublic).toHaveBeenCalled();
    expect(mocks.rootSpan.startObservation).toHaveBeenCalledWith('fleetgraph.normalizeTrigger', objectContaining({
      input: { node: 'normalizeTrigger', triggerType: 'quiet_exit' },
      metadata: objectContaining({
        provider: 'langfuse',
        subsystem: 'fleetgraph',
        promptName: 'fleetgraph.quiet_exit',
      }),
    }), { asType: 'chain' });
    expect(mocks.childSpan.update).toHaveBeenCalledWith(objectContaining({
      output: { node: 'normalizeTrigger', decision: 'quiet_exit' },
    }));
    expect(mocks.rootSpan.startObservation).toHaveBeenCalledWith('fleetgraph.proactive_create_model', objectContaining({
      model: 'gpt-4o-mini',
      usageDetails: { input: 120, output: 24, total: 144 },
    }), { asType: 'generation' });
    expect(mocks.rootSpan.update).toHaveBeenCalledWith(objectContaining({
      output: objectContaining({
        decision: 'quiet_exit',
        nodePath: ['normalizeTrigger', 'produceOutput'],
        tokenMetadata: objectContaining({
          modelCalls: 1,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputTokens: 120,
          outputTokens: 24,
          totalTokens: 144,
        }),
        costMetadata: {},
        tokenUsage: objectContaining({
          label: '144 tokens',
          modelCalls: 1,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputTokens: 120,
          outputTokens: 24,
          totalTokens: 144,
        }),
        costUsage: objectContaining({
          label: 'none',
          costSource: 'none',
          currency: 'none',
        }),
        errorMetadata: {},
      }),
      metadata: objectContaining({
        provider: 'langfuse',
        subsystem: 'fleetgraph',
        modelBoundary: 'real_model',
        tokenUsage: objectContaining({
          label: '144 tokens',
          modelCalls: 1,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputTokens: 120,
          outputTokens: 24,
          totalTokens: 144,
        }),
        costUsage: objectContaining({
          label: 'none',
          costSource: 'none',
          currency: 'none',
        }),
      }),
    }));
    expect(mocks.rootSpan.end).toHaveBeenCalled();
  });

  it('keeps the business node single-run when a provider node span fails', async () => {
    enableLangSmith();
    enableLangfuse();
    mocks.createRun
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('LangSmith child create failed'));
    let businessRuns = 0;

    const capture = await withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace, recorder) => {
      await recorder.traceNode('detectorDecision', {
        triggerType: 'detector_decision',
      }, async () => {
        businessRuns += 1;
        return { decision: 'create_finding' };
      });
      return result(trace.traceId, trace.traceUrl);
    });

    expect(businessRuns).toBe(1);
    expect(capture.providerFailures).toEqual(expect.arrayContaining([
      expect.stringContaining('langsmith node start failed'),
    ]));
    expect(mocks.childSpan.update).toHaveBeenCalledWith({
      output: { node: 'detectorDecision', decision: 'create_finding' },
    });
  });

  it('prefers the provider with a pre-shareable trace URL when both providers are enabled', async () => {
    enableLangSmith();
    enableLangfuse();

    const capture = await withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace) => result(trace.traceId, trace.traceUrl));

    expect(capture.traceId).toBe('langfuse-trace-id');
    expect(capture.traceUrl).toBe('https://us.cloud.langfuse.com/project/project-id/traces/langfuse-trace-id');
    expect(capture.providers.map((provider) => provider.provider)).toEqual(['langsmith', 'langfuse']);
  });

  it('records partial finalization failures without failing the FleetGraph result', async () => {
    enableLangSmith();
    enableLangfuse();
    mocks.updateRun.mockRejectedValueOnce(new Error('LangSmith update failed'));

    const capture = await withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace) => result(trace.traceId, trace.traceUrl));

    expect(capture.result.decision).toBe('quiet_exit');
    expect(capture.providerFailures).toEqual(expect.arrayContaining(['LangSmith update failed']));
    expect(mocks.rootSpan.end).toHaveBeenCalled();
  });

  it('honors provider share opt-outs', async () => {
    enableLangSmith();
    enableLangfuse();
    process.env.FLEETGRAPH_LANGSMITH_SHARE = '0';
    process.env.FLEETGRAPH_LANGFUSE_SHARE = '0';

    const capture = await withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace) => result(trace.traceId, trace.traceUrl));

    expect(mocks.shareRun).not.toHaveBeenCalled();
    expect(mocks.rootSpan.setTraceAsPublic).not.toHaveBeenCalled();
    expect(capture.providers).toEqual(expect.arrayContaining([
      objectContaining({ provider: 'langsmith', sharedTraceUrl: null }),
      objectContaining({ provider: 'langfuse', sharedTraceUrl: null }),
    ]));
  });

  it('marks live node children failed when the node throws', async () => {
    enableLangSmith();
    const originalError = new Error('node failed');

    await expect(withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (_trace, recorder) => recorder.traceNode('detectorDecision', {
      triggerType: 'detector_decision',
    }, async () => {
      throw originalError;
    }))).rejects.toBe(originalError);

    expect(findCreateRun('fleetgraph.detectorDecision')).toMatchObject({
      inputs: { node: 'detectorDecision', triggerType: 'detector_decision' },
    });
    expect(mocks.updateRun).toHaveBeenCalledWith(expect.any(String), objectContaining({
      error: 'node failed',
    }));
  });

  it('throws when no providers are configured', async () => {
    await expect(withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace) => result(trace.traceId, trace.traceUrl))).rejects.toThrow(
      'FleetGraph tracing is disabled'
    );
  });

  it('stays disabled when provider credentials exist but FleetGraph tracing is not explicitly enabled', async () => {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_API_KEY = 'test-key';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';

    await expect(withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace) => result(trace.traceId, trace.traceUrl))).rejects.toThrow(
      'FleetGraph tracing is disabled'
    );
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.startObservation).not.toHaveBeenCalled();
  });

  it('posts provider scores best-effort without failing when one provider rejects', async () => {
    enableLangSmith();
    enableLangfuse();
    mocks.createFeedback.mockRejectedValueOnce(new Error('LangSmith score failed'));

    const capture = await withFleetGraphTrace({
      name: 'fleetgraph.test',
      inputs: { label: 'safe' },
    }, async (trace) => result(trace.traceId, trace.traceUrl));
    const failures = await postFleetGraphTraceScores({
      providers: capture.providers,
      scores: [{
        name: 'usage_present',
        value: 1,
        passed: true,
        comment: 'usage present',
        metadata: { modelCalls: 0 },
      }],
    });

    expect(failures).toEqual(['LangSmith score failed']);
    expect(mocks.createFeedback).toHaveBeenCalledWith(expect.any(String), 'usage_present', objectContaining({
      score: 1,
      comment: 'usage present',
    }));
    expect(mocks.langfuseScoreCreate).toHaveBeenCalledWith(objectContaining({
      traceId: 'langfuse-trace-id',
      name: 'usage_present',
      value: 1,
    }));
    expect(mocks.langfuseFlush).toHaveBeenCalled();
  });
});

function enableLangSmith(): void {
  process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = 'true';
  process.env.LANGSMITH_TRACING = 'true';
  process.env.LANGSMITH_API_KEY = 'test-key';
  process.env.LANGSMITH_PROJECT = 'test-project';
}

function enableLangfuse(): void {
  process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED = 'true';
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
  process.env.LANGFUSE_SECRET_KEY = 'sk-test';
  process.env.LANGFUSE_BASE_URL = 'https://us.cloud.langfuse.com';
}

function findCreateRun(name: string): Record<string, unknown> {
  const calls = mocks.createRun.mock.calls as ReadonlyArray<ReadonlyArray<unknown>>;
  const call = calls.find(([input]) =>
    isRecord(input) && input.name === name
  );
  if (!call) throw new Error(`Missing createRun call for ${name}`);
  return call[0] as Record<string, unknown>;
}

function findUpdateRun(id: string): Record<string, unknown> {
  const calls = mocks.updateRun.mock.calls as ReadonlyArray<ReadonlyArray<unknown>>;
  const call = calls.find(([runId]) => runId === id);
  if (!call || !isRecord(call[1])) throw new Error(`Missing updateRun call for ${id}`);
  return call[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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
