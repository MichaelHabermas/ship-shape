import { randomUUID } from 'crypto';
import { Client } from 'langsmith';
import { convertToDottedOrderFormat } from 'langsmith/run_trees';
import type { FleetGraphResult } from '../types.js';
import {
  baseObservabilityMetadata,
  modelCallMetadata,
  nodeOutput,
  observabilityTags,
  resultObservabilityMetadata,
  scrubTraceInputs,
  traceUsageSummary,
  TRACE_IO_TIMEOUT_MS,
  TRACE_SHARE_TIMEOUT_MS,
  usageMetadataForLangSmith,
  withTimeout,
  fleetGraphLangSmithEnabled,
} from './trace-metadata.js';
import type { FleetGraphTraceEnablement, TraceProvider, TraceProviderNode } from './trace-metadata.js';

export function ensureLangSmithEnv(enablement: FleetGraphTraceEnablement = {}): void {
  if (!fleetGraphLangSmithEnabled(enablement)) {
    throw new Error('LangSmith tracing is disabled. Set LANGSMITH_TRACING=true or LANGCHAIN_TRACING_V2=true.');
  }
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    const fallbackKey = process.env.LANGCHAIN_API_KEY?.trim();
    if (!fallbackKey) throw new Error('Missing LANGSMITH_API_KEY or LANGCHAIN_API_KEY for FleetGraph trace capture.');
    process.env.LANGSMITH_API_KEY = fallbackKey;
  }
}

export async function createLangSmithProvider(input: {
  name: string;
  inputs: Record<string, unknown>;
  enablement?: FleetGraphTraceEnablement;
}): Promise<TraceProvider> {
  ensureLangSmithEnv(input.enablement);

  const client = new Client({ autoBatchTracing: false, tracingSamplingRate: 1 });
  const projectName = process.env.LANGSMITH_PROJECT?.trim() || process.env.LANGCHAIN_PROJECT?.trim() || 'default';
  const traceId = randomUUID();
  const traceUrl = `https://smith.langchain.com/r/${traceId}`;
  const startedAt = Date.now();
  const rootOrder = convertToDottedOrderFormat(startedAt, traceId, 1);
  const startMetadata = baseObservabilityMetadata(input.inputs, {
    provider: 'langsmith',
    traceId,
    projectName,
  });

  await withTimeout(client.createRun({
    id: traceId,
    trace_id: traceId,
    name: input.name,
    run_type: 'chain',
    project_name: projectName,
    start_time: rootOrder.microsecondPrecisionDatestring,
    dotted_order: rootOrder.dottedOrder,
    inputs: scrubTraceInputs(input.inputs),
    extra: {
      metadata: {
        ...startMetadata,
        tags: observabilityTags(input.inputs, { provider: 'langsmith' }),
      },
    },
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
      const endMetadata = resultObservabilityMetadata(input.inputs, result, {
        provider: 'langsmith',
        traceId,
        projectName,
      });
      await postLangSmithModelCallChild({
        client,
        projectName,
        traceId,
        parentRunId: traceId,
        parentDottedOrder: rootOrder.dottedOrder,
        traceInputs: input.inputs,
        tokenMetadata: result.tokenMetadata,
        costMetadata: result.costMetadata,
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
        extra: {
          metadata: endMetadata,
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
    extra: {
      metadata: {
        ...baseObservabilityMetadata(input.inputs, {
          provider: 'langsmith',
          traceId: input.traceId,
          projectName: input.projectName,
        }),
        node: input.name,
        tags: observabilityTags(input.inputs, { provider: 'langsmith', node: input.name }),
      },
    },
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

async function postLangSmithModelCallChild(input: {
  client: Client;
  projectName: string;
  traceId: string;
  parentRunId: string;
  parentDottedOrder: string;
  traceInputs: Record<string, unknown>;
  tokenMetadata: FleetGraphResult['tokenMetadata'];
  costMetadata: FleetGraphResult['costMetadata'];
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
        ...modelCallMetadata(input.traceInputs, input.tokenMetadata, input.costMetadata),
        tags: observabilityTags(input.traceInputs, { provider: 'langsmith', node: 'model_call' }),
      },
    },
    serialized: {},
  }), TRACE_IO_TIMEOUT_MS, 'LangSmith model child createRun timed out');
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
