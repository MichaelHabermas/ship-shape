// FleetGraph tracing creates reviewer-shareable traces without exposing raw Ship data.
import { Client } from 'langsmith';
import type { FleetGraphObservabilityScore } from '../observability-scores.js';
import type { FleetGraphResult } from '../types.js';
import { createLangfuseProvider, ensureLangfuseEnv, getLangfuseClient, getOrCreateLangfuseClient, shutdownLangfuseTracing } from './langfuse-provider.js';
import { createLangSmithProvider, ensureLangSmithEnv } from './langsmith-provider.js';
import {
  errorMessage,
  fleetGraphLangSmithEnabled,
  fleetGraphLangfuseEnabled,
  fleetGraphTracingEnabled,
  settleProviderCalls,
  TRACE_IO_TIMEOUT_MS,
  withTimeout,
  type FleetGraphTraceEnablement,
  type FleetGraphTraceIdentity,
  type FleetGraphTraceProviderEvidence,
  type TraceProvider,
  type TraceProviderNode,
} from './trace-metadata.js';

export type {
  FleetGraphTraceEnablement,
  FleetGraphTraceIdentity,
  FleetGraphTraceProviderEvidence,
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

export {
  fleetGraphLangSmithEnabled,
  fleetGraphLangfuseEnabled,
  fleetGraphTracingEnabled,
};

export async function withFleetGraphTrace<T extends FleetGraphResult>(
  input: {
    name: string;
    inputs: Record<string, unknown>;
    enablement?: FleetGraphTraceEnablement;
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
  await shutdownLangfuseTracing();
}

export async function postFleetGraphTraceScores(input: {
  providers: FleetGraphTraceProviderEvidence[];
  scores: readonly FleetGraphObservabilityScore[];
}): Promise<string[]> {
  const posts = input.providers.flatMap((provider) =>
    input.scores.map((score) => postProviderScore(provider, score))
  );
  const failures = await settleProviderCalls(posts);
  const langfuseClient = getLangfuseClient();
  if (langfuseClient) {
    failures.push(...await settleProviderCalls([
      withTimeout(langfuseClient.flush(), TRACE_IO_TIMEOUT_MS, 'Langfuse score flush timed out'),
    ]));
  }
  return failures;
}

async function createTraceProviders(input: {
  name: string;
  inputs: Record<string, unknown>;
  enablement?: FleetGraphTraceEnablement;
}): Promise<TraceProvider[]> {
  const providers: TraceProvider[] = [];
  const errors: string[] = [];

  if (fleetGraphLangSmithEnabled(input.enablement)) {
    try {
      providers.push(await createLangSmithProvider(input));
    } catch (error) {
      errors.push(providerError('LangSmith', error));
    }
  }

  if (fleetGraphLangfuseEnabled(input.enablement)) {
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

async function postProviderScore(
  provider: FleetGraphTraceProviderEvidence,
  score: FleetGraphObservabilityScore
): Promise<void> {
  if (provider.provider === 'langsmith') {
    ensureLangSmithEnv();
    const client = new Client({ autoBatchTracing: false, tracingSamplingRate: 1 });
    await withTimeout(client.createFeedback(provider.traceId, score.name, {
      score: score.value,
      comment: score.comment,
      sourceInfo: {
        source: 'fleetgraph-observability-trial',
        passed: score.passed,
        ...score.metadata,
      },
    }), TRACE_IO_TIMEOUT_MS, `LangSmith score ${score.name} timed out`);
    return;
  }

  ensureLangfuseEnv();
  const client = getLangfuseClient() ?? getOrCreateLangfuseClient();
  client.score.create({
    traceId: provider.traceId,
    name: score.name,
    value: score.value,
    comment: score.comment,
    metadata: {
      source: 'fleetgraph-observability-trial',
      passed: score.passed,
      ...score.metadata,
    },
  });
}

function providerError(provider: string, error: unknown): string {
  return `${provider} trace setup failed: ${errorMessage(error)}`;
}

function markProviderFailure(evidence: FleetGraphTraceProviderEvidence, message: string): string {
  evidence.error = message.slice(0, 500);
  return evidence.error;
}
