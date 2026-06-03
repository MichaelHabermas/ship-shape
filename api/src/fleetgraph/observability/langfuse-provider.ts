import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { startObservation, type LangfuseSpan } from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { FleetGraphResult } from '../types.js';
import {
  baseObservabilityMetadata,
  costDetailsForLangfuse,
  modelCallMetadata,
  nodeOutput,
  observabilityEnvironment,
  observabilityVersion,
  resultObservabilityMetadata,
  scrubTraceInputs,
  traceUsageSummary,
  TRACE_SHUTDOWN_TIMEOUT_MS,
  usageMetadataForLangfuse,
  withTimeout,
  type FleetGraphTraceEnablement,
  type TraceProvider,
  type TraceProviderNode,
  fleetGraphLangfuseEnabled,
} from './trace-metadata.js';

let langfuseSdk: NodeSDK | null = null;
let langfuseClient: LangfuseClient | null = null;

export function getLangfuseClient(): LangfuseClient | null {
  return langfuseClient;
}

export function getOrCreateLangfuseClient(): LangfuseClient {
  if (langfuseClient) return langfuseClient;
  langfuseClient = new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
  return langfuseClient;
}

export function ensureLangfuseEnv(enablement: FleetGraphTraceEnablement = {}): void {
  if (!fleetGraphLangfuseEnabled(enablement)) {
    throw new Error('Langfuse tracing is disabled. Set LANGFUSE_TRACING=true or provide Langfuse credentials.');
  }
  if (!process.env.LANGFUSE_PUBLIC_KEY?.trim() || !process.env.LANGFUSE_SECRET_KEY?.trim()) {
    throw new Error('Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY for FleetGraph trace capture.');
  }
}

export function ensureLangfuseSdk(): void {
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

export async function shutdownLangfuseTracing(): Promise<void> {
  const shutdowns: Promise<void>[] = [];
  if (langfuseClient) {
    shutdowns.push(withLangfuseTimeout(langfuseClient.shutdown(), 'Langfuse client shutdown timed out'));
  }
  if (langfuseSdk) {
    shutdowns.push(withLangfuseTimeout(langfuseSdk.shutdown(), 'Langfuse SDK shutdown timed out'));
  }
  await Promise.allSettled(shutdowns);
  langfuseClient = null;
  langfuseSdk = null;
}

export async function createLangfuseProvider(input: {
  name: string;
  inputs: Record<string, unknown>;
  enablement?: FleetGraphTraceEnablement;
}): Promise<TraceProvider> {
  ensureLangfuseEnv(input.enablement);
  ensureLangfuseSdk();

  const client = langfuseClient ?? new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
  langfuseClient = client;
  const startMetadata = baseObservabilityMetadata(input.inputs, {
    provider: 'langfuse',
    projectName: process.env.LANGFUSE_PROJECT?.trim(),
  });

  const rootSpan = startObservation(input.name, {
    input: scrubTraceInputs(input.inputs),
    metadata: startMetadata,
    environment: observabilityEnvironment(),
    version: observabilityVersion(),
  }, { asType: 'agent' });
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
      postLangfuseModelCallChild(rootSpan, input.inputs, result.tokenMetadata, result.costMetadata);
      const endMetadata = resultObservabilityMetadata(input.inputs, result, {
        provider: 'langfuse',
        traceId: rootSpan.traceId,
        traceUrl,
        projectName: process.env.LANGFUSE_PROJECT?.trim(),
      });
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
        metadata: endMetadata,
        environment: observabilityEnvironment(),
        version: observabilityVersion(),
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

async function startLangfuseNode(rootSpan: LangfuseSpan, name: string, inputs: Record<string, unknown>): Promise<TraceProviderNode> {
  const child = rootSpan.startObservation(`fleetgraph.${name}`, {
    input: scrubTraceInputs({ node: name, ...inputs }),
    metadata: {
      ...baseObservabilityMetadata(inputs, {
        provider: 'langfuse',
        traceId: rootSpan.traceId,
        projectName: process.env.LANGFUSE_PROJECT?.trim(),
      }),
      node: name,
    },
    environment: observabilityEnvironment(),
    version: observabilityVersion(),
  }, { asType: 'chain' });

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

function postLangfuseModelCallChild(
  rootSpan: LangfuseSpan,
  traceInputs: Record<string, unknown>,
  tokenMetadata: FleetGraphResult['tokenMetadata'],
  costMetadata: FleetGraphResult['costMetadata']
): void {
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
    costDetails: costDetailsForLangfuse(costMetadata),
    metadata: {
      provider: tokenMetadata.provider,
      ...modelCallMetadata(traceInputs, tokenMetadata, costMetadata),
    },
    environment: observabilityEnvironment(),
    version: observabilityVersion(),
  }, { asType: 'generation' });
  generation.end();
}

function maskLangfuseData(data: unknown): unknown {
  if (typeof data === 'string') {
    return /prompt|completion|authorization|cookie|token|password|secret/i.test(data)
      ? '[redacted]'
      : data;
  }
  return data;
}

async function withLangfuseTimeout(promise: Promise<void>, message: string): Promise<void> {
  await withTimeout(promise, TRACE_SHUTDOWN_TIMEOUT_MS, message);
}
