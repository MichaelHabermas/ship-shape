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
  run: (trace: FleetGraphLangSmithTraceIdentity) => Promise<T>
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

  try {
    const result = await run({ traceId, traceUrl });
    await postNodePathChildren({
      client,
      projectName,
      traceId,
      parentRunId: traceId,
      parentDottedOrder: rootOrder.dottedOrder,
      nodePath: result.traceMetadata.nodePath,
    });
    await client.updateRun(traceId, {
      outputs: {
        decision: result.decision,
        nodePath: result.traceMetadata.nodePath,
        modelCalls: result.tokenMetadata.modelCalls,
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

async function postNodePathChildren(input: {
  client: Client;
  projectName: string;
  traceId: string;
  parentRunId: string;
  parentDottedOrder: string;
  nodePath: string[];
}): Promise<void> {
  for (const nodeName of input.nodePath) {
    const childRunId = randomUUID();
    const childOrder = convertToDottedOrderFormat(Date.now(), childRunId, 2);
    await input.client.createRun({
      id: childRunId,
      trace_id: input.traceId,
      parent_run_id: input.parentRunId,
      name: `fleetgraph.${nodeName}`,
      run_type: 'chain',
      project_name: input.projectName,
      start_time: childOrder.microsecondPrecisionDatestring,
      end_time: new Date().toISOString(),
      dotted_order: `${input.parentDottedOrder}.${childOrder.dottedOrder}`,
      inputs: { node: nodeName },
      outputs: { ok: true },
      serialized: {},
    });
  }
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
