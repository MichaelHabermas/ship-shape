// FleetGraph tracing creates reviewer-shareable traces without exposing raw Ship data.
import { randomUUID } from 'crypto';
import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { startObservation, type LangfuseSpan } from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Client } from 'langsmith';
import { convertToDottedOrderFormat } from 'langsmith/run_trees';
import type { FleetGraphResult, FleetGraphTraceMetadata } from './types.js';

export type FleetGraphTraceIdentity = Pick<FleetGraphTraceMetadata, 'traceId' | 'traceUrl'>;

export type FleetGraphTraceProviderEvidence = {
  provider: 'langsmith' | 'langfuse';
  traceId: string;
  traceUrl: string;
  sharedTraceUrl: string | null;
  error?: string;
};

export type FleetGraphTraceCapture<T extends FleetGraphResult = FleetGraphResult> = {
  result: T;
  traceId: string;
  traceUrl: string;
  sharedTraceUrl: string | null;
  providers: FleetGraphTraceProviderEvidence[];
  providerFailures: string[];
};

export type FleetGraphNodeRecorder = {
  traceNode<T>(
    name: string,
    inputs: Record<string, unknown>,
    run: () => Promise<T>
  ): Promise<T>;
};

type TraceProvider = {
  evidence: FleetGraphTraceProviderEvidence;
  startNode(name: string, inputs: Record<string, unknown>): Promise<TraceProviderNode | null>;
  end(result: FleetGraphResult): Promise<void>;
  fail(error: unknown): Promise<void>;
};

type TraceProviderNode = {
  provider: FleetGraphTraceProviderEvidence['provider'];
  end(output: unknown): Promise<void>;
  fail(error: unknown): Promise<void>;
};

const TRACE_IO_TIMEOUT_MS = 5000;
const TRACE_SHARE_TIMEOUT_MS = 5000;
const TRACE_SHUTDOWN_TIMEOUT_MS = 10000;

let langfuseSdk: NodeSDK | null = null;
let langfuseClient: LangfuseClient | null = null;

export function fleetGraphTracingEnabled(): boolean {
  return fleetGraphLangSmithEnabled() || fleetGraphLangfuseEnabled();
}

export function fleetGraphLangSmithEnabled(): boolean {
  return isEnabled(process.env.LANGSMITH_TRACING) || isEnabled(process.env.LANGCHAIN_TRACING_V2);
}

export function fleetGraphLangfuseEnabled(): boolean {
  return isEnabled(process.env.LANGFUSE_TRACING) || Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim() &&
    process.env.LANGFUSE_SECRET_KEY?.trim()
  );
}

export async function withFleetGraphTrace<T extends FleetGraphResult>(
  input: {
    name: string;
    inputs: Record<string, unknown>;
  },
  run: (trace: FleetGraphTraceIdentity, recorder: FleetGraphNodeRecorder) => Promise<T>
): Promise<FleetGraphTraceCapture<T>> {
  const providers = await createTraceProviders(input);
  if (providers.length === 0) {
    throw new Error('FleetGraph tracing is disabled. Enable LangSmith or Langfuse tracing.');
  }

  const primaryProvider = providers.find((provider) => provider.evidence.sharedTraceUrl) ?? providers[0];
  if (!primaryProvider) throw new Error('FleetGraph tracing is disabled. Enable LangSmith or Langfuse tracing.');
  const primaryTrace = primaryProvider.evidence;
  const providerFailures: string[] = [];
  const recorder = createMultiplexNodeRecorder(providers, providerFailures);

  try {
    const result = await run({
      traceId: primaryTrace.traceId,
      traceUrl: primaryTrace.sharedTraceUrl ?? primaryTrace.traceUrl,
    }, recorder);
    providerFailures.push(...await settleProviderCalls(providers.map((provider) => provider.end(result))));

    return {
      result,
      traceId: primaryTrace.traceId,
      traceUrl: primaryTrace.traceUrl,
      sharedTraceUrl: primaryTrace.sharedTraceUrl,
      providers: providers.map((provider) => provider.evidence),
      providerFailures,
    };
  } catch (error) {
    providerFailures.push(...await settleProviderCalls(providers.map((provider) => provider.fail(error))));
    throw error;
  }
}

export async function shutdownFleetGraphTracing(): Promise<void> {
  const shutdowns: Promise<void>[] = [];
  if (langfuseClient) shutdowns.push(withTimeout(langfuseClient.shutdown(), TRACE_SHUTDOWN_TIMEOUT_MS, 'Langfuse client shutdown timed out'));
  if (langfuseSdk) shutdowns.push(withTimeout(langfuseSdk.shutdown(), TRACE_SHUTDOWN_TIMEOUT_MS, 'Langfuse SDK shutdown timed out'));
  await settleProviderCalls(shutdowns);
  langfuseClient = null;
  langfuseSdk = null;
}

async function createTraceProviders(input: {
  name: string;
  inputs: Record<string, unknown>;
}): Promise<TraceProvider[]> {
  const providers: TraceProvider[] = [];
  const errors: string[] = [];

  if (fleetGraphLangSmithEnabled()) {
    try {
      providers.push(await createLangSmithProvider(input));
    } catch (error) {
      errors.push(providerError('LangSmith', error));
    }
  }

  if (fleetGraphLangfuseEnabled()) {
    try {
      providers.push(await createLangfuseProvider(input));
    } catch (error) {
      errors.push(providerError('Langfuse', error));
    }
  }

  if (providers.length === 0 && errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  return providers;
}

async function createLangSmithProvider(input: {
  name: string;
  inputs: Record<string, unknown>;
}): Promise<TraceProvider> {
  ensureLangSmithEnv();

  const client = new Client({ autoBatchTracing: false, tracingSamplingRate: 1 });
  const projectName = process.env.LANGSMITH_PROJECT?.trim() || process.env.LANGCHAIN_PROJECT?.trim() || 'default';
  const traceId = randomUUID();
  const traceUrl = `https://smith.langchain.com/r/${traceId}`;
  const startedAt = Date.now();
  const rootOrder = convertToDottedOrderFormat(startedAt, traceId, 1);

  await withTimeout(client.createRun({
    id: traceId,
    trace_id: traceId,
    name: input.name,
    run_type: 'chain',
    project_name: projectName,
    start_time: rootOrder.microsecondPrecisionDatestring,
    dotted_order: rootOrder.dottedOrder,
    inputs: scrubTraceInputs(input.inputs),
    serialized: {},
  }), TRACE_IO_TIMEOUT_MS, 'LangSmith createRun timed out');

  const provider: TraceProvider = {
    evidence: {
      provider: 'langsmith',
      traceId,
      traceUrl,
      sharedTraceUrl: null,
    },
    startNode: (name, inputs) => startLangSmithNode({
      client,
      projectName,
      traceId,
      parentRunId: traceId,
      parentDottedOrder: rootOrder.dottedOrder,
      name,
      inputs,
    }),
    async end(result) {
      const usageSummary = traceUsageSummary(result);
      await postLangSmithModelCallChild({
        client,
        projectName,
        traceId,
        parentRunId: traceId,
        parentDottedOrder: rootOrder.dottedOrder,
        tokenMetadata: result.tokenMetadata,
      });
      await withTimeout(client.updateRun(traceId, {
        outputs: {
          decision: result.decision,
          nodePath: result.traceMetadata.nodePath,
          tokenMetadata: result.tokenMetadata,
          costMetadata: result.costMetadata,
          tokenUsage: usageSummary.tokenUsage,
          costUsage: usageSummary.costUsage,
          errorMetadata: result.errorMetadata,
        },
        end_time: new Date().toISOString(),
      }), TRACE_IO_TIMEOUT_MS, 'LangSmith updateRun timed out');
      provider.evidence.sharedTraceUrl = process.env.FLEETGRAPH_LANGSMITH_SHARE === '0'
        ? null
        : await shareRunWithRetry(client, traceId);
    },
    async fail(error) {
      try {
        await withTimeout(client.updateRun(traceId, {
          error: error instanceof Error ? error.message : String(error),
          end_time: new Date().toISOString(),
        }), TRACE_IO_TIMEOUT_MS, 'LangSmith failure updateRun timed out');
      } catch {
        // Preserve the original FleetGraph/demo failure; tracing cleanup is secondary evidence.
      }
    },
  };

  return provider;
}

async function createLangfuseProvider(input: {
  name: string;
  inputs: Record<string, unknown>;
}): Promise<TraceProvider> {
  ensureLangfuseEnv();
  ensureLangfuseSdk();

  const client = langfuseClient ?? new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
  langfuseClient = client;

  const rootSpan = startObservation(input.name, {
    input: scrubTraceInputs(input.inputs),
    metadata: {
      provider: 'langfuse',
      project: process.env.LANGFUSE_PROJECT?.trim() || undefined,
    },
  });
  const traceUrl = await client.getTraceUrl(rootSpan.traceId);
  if (process.env.FLEETGRAPH_LANGFUSE_SHARE !== '0') {
    rootSpan.setTraceAsPublic();
  }

  return {
    evidence: {
      provider: 'langfuse',
      traceId: rootSpan.traceId,
      traceUrl,
      sharedTraceUrl: process.env.FLEETGRAPH_LANGFUSE_SHARE === '0' ? null : traceUrl,
    },
    startNode: (name, inputs) => startLangfuseNode(rootSpan, name, inputs),
    async end(result) {
      const usageSummary = traceUsageSummary(result);
      postLangfuseModelCallChild(rootSpan, result.tokenMetadata);
      rootSpan.update({
        output: {
          decision: result.decision,
          nodePath: result.traceMetadata.nodePath,
          tokenMetadata: result.tokenMetadata,
          costMetadata: result.costMetadata,
          tokenUsage: usageSummary.tokenUsage,
          costUsage: usageSummary.costUsage,
          errorMetadata: result.errorMetadata,
        },
        metadata: {
          tokenUsage: usageSummary.tokenUsage,
          costUsage: usageSummary.costUsage,
        },
      });
      rootSpan.end();
    },
    async fail(error) {
      rootSpan.update({
        level: 'ERROR',
        statusMessage: error instanceof Error ? error.message : String(error),
      });
      rootSpan.end();
    },
  };
}

function ensureLangSmithEnv(): void {
  if (!fleetGraphLangSmithEnabled()) {
    throw new Error('LangSmith tracing is disabled. Set LANGSMITH_TRACING=true or LANGCHAIN_TRACING_V2=true.');
  }
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    const fallbackKey = process.env.LANGCHAIN_API_KEY?.trim();
    if (!fallbackKey) throw new Error('Missing LANGSMITH_API_KEY or LANGCHAIN_API_KEY for FleetGraph trace capture.');
    process.env.LANGSMITH_API_KEY = fallbackKey;
  }
}

function ensureLangfuseEnv(): void {
  if (!fleetGraphLangfuseEnabled()) {
    throw new Error('Langfuse tracing is disabled. Set LANGFUSE_TRACING=true or provide Langfuse credentials.');
  }
  if (!process.env.LANGFUSE_PUBLIC_KEY?.trim() || !process.env.LANGFUSE_SECRET_KEY?.trim()) {
    throw new Error('Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY for FleetGraph trace capture.');
  }
}

function ensureLangfuseSdk(): void {
  if (langfuseSdk) return;

  langfuseSdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL,
        environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.NODE_ENV,
        exportMode: process.env.LANGFUSE_EXPORT_MODE === 'batched' ? 'batched' : 'immediate',
        mask: ({ data }) => maskLangfuseData(data),
      }),
    ],
  });
  langfuseSdk.start();
}

function createMultiplexNodeRecorder(providers: TraceProvider[], providerFailures: string[]): FleetGraphNodeRecorder {
  return {
    async traceNode<T>(name: string, inputs: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
      const nodes = (await Promise.all(providers.map(async (provider) => {
        try {
          return await provider.startNode(name, inputs);
        } catch (error) {
          providerFailures.push(markProviderFailure(provider.evidence, `${provider.evidence.provider} node start failed: ${errorMessage(error)}`));
          return null;
        }
      }))).filter((node): node is TraceProviderNode => node !== null);

      try {
        const output = await run();
        providerFailures.push(...await settleProviderCalls(nodes.map((node) => node.end(output))));
        return output;
      } catch (error) {
        providerFailures.push(...await settleProviderCalls(nodes.map((node) => node.fail(error))));
        throw error;
      }
    },
  };
}

async function startLangSmithNode(input: {
  client: Client;
  projectName: string;
  traceId: string;
  parentRunId: string;
  parentDottedOrder: string;
  name: string;
  inputs: Record<string, unknown>;
}): Promise<TraceProviderNode> {
  const childRunId = randomUUID();
  const childOrder = convertToDottedOrderFormat(Date.now(), childRunId, 2);
  await withTimeout(input.client.createRun({
    id: childRunId,
    trace_id: input.traceId,
    parent_run_id: input.parentRunId,
    name: `fleetgraph.${input.name}`,
    run_type: 'chain',
    project_name: input.projectName,
    start_time: childOrder.microsecondPrecisionDatestring,
    dotted_order: `${input.parentDottedOrder}.${childOrder.dottedOrder}`,
    inputs: scrubTraceInputs({ node: input.name, ...input.inputs }),
    serialized: {},
  }), TRACE_IO_TIMEOUT_MS, 'LangSmith child createRun timed out');

  return {
    provider: 'langsmith',
    async end(output) {
      await withTimeout(input.client.updateRun(childRunId, {
        outputs: nodeOutput(input.name, output),
        end_time: new Date().toISOString(),
      }), TRACE_IO_TIMEOUT_MS, 'LangSmith child updateRun timed out');
    },
    async fail(error) {
      await withTimeout(input.client.updateRun(childRunId, {
        error: error instanceof Error ? error.message : String(error),
        end_time: new Date().toISOString(),
      }), TRACE_IO_TIMEOUT_MS, 'LangSmith child failure updateRun timed out');
    },
  };
}

async function startLangfuseNode(rootSpan: LangfuseSpan, name: string, inputs: Record<string, unknown>): Promise<TraceProviderNode> {
  const child = rootSpan.startObservation(`fleetgraph.${name}`, {
    input: scrubTraceInputs({ node: name, ...inputs }),
  });

  return {
    provider: 'langfuse',
    async end(output) {
      child.update({ output: nodeOutput(name, output) });
      child.end();
    },
    async fail(error) {
      child.update({
        level: 'ERROR',
        statusMessage: error instanceof Error ? error.message : String(error),
      });
      child.end();
    },
  };
}

async function postLangSmithModelCallChild(input: {
  client: Client;
  projectName: string;
  traceId: string;
  parentRunId: string;
  parentDottedOrder: string;
  tokenMetadata: FleetGraphResult['tokenMetadata'];
}): Promise<void> {
  if (
    input.tokenMetadata.modelCalls <= 0 ||
    !input.tokenMetadata.provider ||
    !input.tokenMetadata.model
  ) {
    return;
  }

  const childRunId = randomUUID();
  const childOrder = convertToDottedOrderFormat(Date.now(), childRunId, 2);
  await withTimeout(input.client.createRun({
    id: childRunId,
    trace_id: input.traceId,
    parent_run_id: input.parentRunId,
    name: 'fleetgraph.proactive_create_model',
    run_type: 'llm',
    project_name: input.projectName,
    start_time: childOrder.microsecondPrecisionDatestring,
    end_time: new Date().toISOString(),
    dotted_order: `${input.parentDottedOrder}.${childOrder.dottedOrder}`,
    inputs: { messages: [{ role: 'user', content: '[redacted FleetGraph model input]' }] },
    outputs: {
      generations: [{ message: { role: 'assistant', content: '[redacted FleetGraph model output]' } }],
      usage_metadata: usageMetadataForLangSmith(input.tokenMetadata),
    },
    extra: {
      metadata: {
        ls_provider: input.tokenMetadata.provider,
        ls_model_name: input.tokenMetadata.model,
      },
    },
    serialized: {},
  }), TRACE_IO_TIMEOUT_MS, 'LangSmith model child createRun timed out');
}

function postLangfuseModelCallChild(rootSpan: LangfuseSpan, tokenMetadata: FleetGraphResult['tokenMetadata']): void {
  if (
    tokenMetadata.modelCalls <= 0 ||
    !tokenMetadata.provider ||
    !tokenMetadata.model
  ) {
    return;
  }

  const generation = rootSpan.startObservation('fleetgraph.proactive_create_model', {
    input: [{ role: 'user', content: '[redacted FleetGraph model input]' }],
    output: [{ role: 'assistant', content: '[redacted FleetGraph model output]' }],
    model: tokenMetadata.model,
    usageDetails: usageMetadataForLangfuse(tokenMetadata),
    metadata: {
      provider: tokenMetadata.provider,
    },
  }, { asType: 'generation' });
  generation.end();
}

async function shareRunWithRetry(client: Client, runId: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withTimeout(client.shareRun(runId), TRACE_SHARE_TIMEOUT_MS, 'LangSmith shareRun timed out');
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function settleProviderCalls(promises: Promise<void>[]): Promise<string[]> {
  const results = await Promise.allSettled(promises);
  return results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function usageMetadataForLangSmith(tokenMetadata: FleetGraphResult['tokenMetadata']): Record<string, number> {
  return {
    ...(tokenMetadata.inputTokens !== undefined ? { input_tokens: tokenMetadata.inputTokens } : {}),
    ...(tokenMetadata.outputTokens !== undefined ? { output_tokens: tokenMetadata.outputTokens } : {}),
    ...(tokenMetadata.totalTokens !== undefined ? { total_tokens: tokenMetadata.totalTokens } : {}),
  };
}

function usageMetadataForLangfuse(tokenMetadata: FleetGraphResult['tokenMetadata']): Record<string, number> {
  return {
    ...(tokenMetadata.inputTokens !== undefined ? { input: tokenMetadata.inputTokens } : {}),
    ...(tokenMetadata.outputTokens !== undefined ? { output: tokenMetadata.outputTokens } : {}),
    ...(tokenMetadata.totalTokens !== undefined ? { total: tokenMetadata.totalTokens } : {}),
  };
}

function traceUsageSummary(result: FleetGraphResult): {
  tokenUsage: Record<string, string | number>;
  costUsage: Record<string, string | number>;
} {
  const tokenMetadata = result.tokenMetadata;
  const costMetadata = result.costMetadata;
  const hasModelUsage = tokenMetadata.modelCalls > 0;
  const hasKnownTokens = tokenMetadata.totalTokens !== undefined ||
    tokenMetadata.inputTokens !== undefined ||
    tokenMetadata.outputTokens !== undefined;
  const hasKnownCost = costMetadata.estimatedCostUsd !== undefined;

  return {
    tokenUsage: {
      label: hasModelUsage
        ? (hasKnownTokens ? `${tokenMetadata.totalTokens ?? 'partial'} tokens` : 'unknown')
        : 'none',
      modelCalls: tokenMetadata.modelCalls,
      provider: tokenMetadata.provider ?? 'none',
      model: tokenMetadata.model ?? 'none',
      ...(tokenMetadata.inputTokens !== undefined ? { inputTokens: tokenMetadata.inputTokens } : {}),
      ...(tokenMetadata.outputTokens !== undefined ? { outputTokens: tokenMetadata.outputTokens } : {}),
      ...(tokenMetadata.totalTokens !== undefined ? { totalTokens: tokenMetadata.totalTokens } : {}),
    },
    costUsage: {
      label: hasKnownCost ? `$${costMetadata.estimatedCostUsd}` : 'none',
      ...(costMetadata.estimatedCostUsd !== undefined ? { estimatedCostUsd: costMetadata.estimatedCostUsd } : {}),
      currency: costMetadata.estimatedCostUsd !== undefined ? 'USD' : 'none',
    },
  };
}

function nodeOutput(name: string, output: unknown): Record<string, unknown> {
  if (isFleetGraphStatePatch(output)) {
    return {
      node: name,
      ...(typeof output.decision === 'string' ? { decision: output.decision } : {}),
      ...(typeof output.triggerType === 'string' ? { triggerType: output.triggerType } : {}),
      ...(typeof output.triggerReason === 'string' ? { triggerReason: output.triggerReason } : {}),
    };
  }
  return { node: name, ok: true };
}

function isFleetGraphStatePatch(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function scrubTraceInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inputs).filter(([key, value]) =>
      !/prompt|completion|authorization|cookie|token|password|secret/i.test(key) &&
      typeof value !== 'object'
    )
  );
}

function maskLangfuseData(data: unknown): unknown {
  if (typeof data === 'string') {
    return /prompt|completion|authorization|cookie|token|password|secret/i.test(data)
      ? '[redacted]'
      : data;
  }
  return data;
}

function providerError(provider: string, error: unknown): string {
  return `${provider} trace setup failed: ${errorMessage(error)}`;
}

function markProviderFailure(evidence: FleetGraphTraceProviderEvidence, message: string): string {
  evidence.error = message.slice(0, 500);
  return evidence.error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEnabled(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}
