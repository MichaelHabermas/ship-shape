// FleetGraph LangSmith helpers create reviewer-shareable traces without exposing raw Ship data.
import { randomUUID } from 'crypto';
import { Client } from 'langsmith';
import { convertToDottedOrderFormat } from 'langsmith/run_trees';
import type { FleetGraphResult, FleetGraphTraceMetadata } from './types.js';

export type FleetGraphLangSmithTraceIdentity = Pick<FleetGraphTraceMetadata, 'traceId' | 'traceUrl'>;

export type FleetGraphLangSmithTraceCapture<T extends FleetGraphResult = FleetGraphResult> = {
  result: T;
  traceId: string;
  traceUrl: string;
  sharedTraceUrl: string | null;
};

export type FleetGraphLangSmithNodeRecorder = {
  traceNode<T>(
    name: string,
    inputs: Record<string, unknown>,
    run: () => Promise<T>
  ): Promise<T>;
};

export function fleetGraphLangSmithEnabled(): boolean {
  return isEnabled(process.env.LANGSMITH_TRACING) || isEnabled(process.env.LANGCHAIN_TRACING_V2);
}

export function ensureLangSmithEnv(): void {
  if (!fleetGraphLangSmithEnabled()) {
    throw new Error('LangSmith tracing is disabled. Set LANGSMITH_TRACING=true or LANGCHAIN_TRACING_V2=true.');
  }
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    const fallbackKey = process.env.LANGCHAIN_API_KEY?.trim();
    if (!fallbackKey) throw new Error('Missing LANGSMITH_API_KEY or LANGCHAIN_API_KEY for FleetGraph trace capture.');
    process.env.LANGSMITH_API_KEY = fallbackKey;
  }
}

export async function withFleetGraphLangSmithTrace<T extends FleetGraphResult>(
  input: {
    name: string;
    inputs: Record<string, unknown>;
  },
  run: (trace: FleetGraphLangSmithTraceIdentity, recorder: FleetGraphLangSmithNodeRecorder) => Promise<T>
): Promise<FleetGraphLangSmithTraceCapture<T>> {
  ensureLangSmithEnv();

  const client = new Client({ autoBatchTracing: false, tracingSamplingRate: 1 });
  const projectName = process.env.LANGSMITH_PROJECT?.trim() || process.env.LANGCHAIN_PROJECT?.trim() || 'default';
  const traceId = randomUUID();
  const traceUrl = `https://smith.langchain.com/r/${traceId}`;
  const startedAt = Date.now();
  const rootOrder = convertToDottedOrderFormat(startedAt, traceId, 1);

  await client.createRun({
    id: traceId,
    trace_id: traceId,
    name: input.name,
    run_type: 'chain',
    project_name: projectName,
    start_time: rootOrder.microsecondPrecisionDatestring,
    dotted_order: rootOrder.dottedOrder,
    inputs: scrubTraceInputs(input.inputs),
    serialized: {},
  });

  const recorder = createLangSmithNodeRecorder({
    client,
    projectName,
    traceId,
    parentRunId: traceId,
    parentDottedOrder: rootOrder.dottedOrder,
  });

  try {
    const result = await run({ traceId, traceUrl }, recorder);
    await postModelCallChildren({
      client,
      projectName,
      traceId,
      parentRunId: traceId,
      parentDottedOrder: rootOrder.dottedOrder,
      tokenMetadata: result.tokenMetadata,
    });
    await client.updateRun(traceId, {
      outputs: {
        decision: result.decision,
        nodePath: result.traceMetadata.nodePath,
        tokenMetadata: result.tokenMetadata,
        costMetadata: result.costMetadata,
        errorMetadata: result.errorMetadata,
      },
      end_time: new Date().toISOString(),
    });
    const sharedTraceUrl = process.env.FLEETGRAPH_LANGSMITH_SHARE === '0'
      ? null
      : await shareRunWithRetry(client, traceId);

    return {
      result,
      traceId,
      traceUrl,
      sharedTraceUrl,
    };
  } catch (error) {
    try {
      await client.updateRun(traceId, {
        error: error instanceof Error ? error.message : String(error),
        end_time: new Date().toISOString(),
      });
    } catch {
      // Preserve the original FleetGraph/demo failure; LangSmith cleanup is secondary evidence.
    }
    throw error;
  }
}

function createLangSmithNodeRecorder(input: {
  client: Client;
  projectName: string;
  traceId: string;
  parentRunId: string;
  parentDottedOrder: string;
}): FleetGraphLangSmithNodeRecorder {
  return {
    async traceNode<T>(name: string, inputs: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
      const childRunId = randomUUID();
      const childOrder = convertToDottedOrderFormat(Date.now(), childRunId, 2);
      await input.client.createRun({
        id: childRunId,
        trace_id: input.traceId,
        parent_run_id: input.parentRunId,
        name: `fleetgraph.${name}`,
        run_type: 'chain',
        project_name: input.projectName,
        start_time: childOrder.microsecondPrecisionDatestring,
        dotted_order: `${input.parentDottedOrder}.${childOrder.dottedOrder}`,
        inputs: scrubTraceInputs({ node: name, ...inputs }),
        serialized: {},
      });

      try {
        const output = await run();
        await input.client.updateRun(childRunId, {
          outputs: nodeOutput(name, output),
          end_time: new Date().toISOString(),
        });
        return output;
      } catch (error) {
        await input.client.updateRun(childRunId, {
          error: error instanceof Error ? error.message : String(error),
          end_time: new Date().toISOString(),
        });
        throw error;
      }
    },
  };
}

async function postModelCallChildren(input: {
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
  await input.client.createRun({
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
  });
}

async function shareRunWithRetry(client: Client, runId: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await withTimeout(client.shareRun(runId), 15000, 'LangSmith shareRun timed out');
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
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

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}
