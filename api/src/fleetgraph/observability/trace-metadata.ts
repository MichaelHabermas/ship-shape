import { execFileSync } from 'child_process';
import { fleetGraphStableHash } from '../trace-hash.js';
import { FLEETGRAPH_NO_MODEL_USAGE_REASON } from '../usage-metadata.js';
import type { FleetGraphResult, FleetGraphTraceMetadata } from '../types.js';

export type FleetGraphTraceIdentity = Pick<FleetGraphTraceMetadata, 'traceId' | 'traceUrl'>;

export type FleetGraphTraceProviderEvidence = {
  provider: 'langsmith' | 'langfuse';
  traceId: string;
  traceUrl: string;
  sharedTraceUrl: string | null;
  error?: string;
};

export type TraceProvider = {
  evidence: FleetGraphTraceProviderEvidence;
  startNode(name: string, inputs: Record<string, unknown>): Promise<TraceProviderNode | null>;
  end(result: FleetGraphResult): Promise<void>;
  fail(error: unknown): Promise<void>;
};

export type TraceProviderNode = {
  provider: FleetGraphTraceProviderEvidence['provider'];
  end(output: unknown): Promise<void>;
  fail(error: unknown): Promise<void>;
};

export type FleetGraphTraceEnablement = {
  reviewer?: boolean;
};

export const OBSERVABILITY_SCHEMA_VERSION = '2026-05-29.1';

let gitShaCache: string | null | undefined;

export function traceUsageSummary(result: FleetGraphResult): {
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
      usageSource: tokenMetadata.usageSource ?? (hasModelUsage ? 'unknown' : 'none'),
      ...(tokenMetadata.noUsageReason ? { noUsageReason: tokenMetadata.noUsageReason } : {}),
      ...(tokenMetadata.inputTokens !== undefined ? { inputTokens: tokenMetadata.inputTokens } : {}),
      ...(tokenMetadata.cachedInputTokens !== undefined ? { cachedInputTokens: tokenMetadata.cachedInputTokens } : {}),
      ...(tokenMetadata.billableInputTokens !== undefined ? { billableInputTokens: tokenMetadata.billableInputTokens } : {}),
      ...(tokenMetadata.outputTokens !== undefined ? { outputTokens: tokenMetadata.outputTokens } : {}),
      ...(tokenMetadata.totalTokens !== undefined ? { totalTokens: tokenMetadata.totalTokens } : {}),
    },
    costUsage: {
      label: hasKnownCost ? `$${costMetadata.estimatedCostUsd}` : 'none',
      ...(costMetadata.estimatedCostUsd !== undefined ? { estimatedCostUsd: costMetadata.estimatedCostUsd } : {}),
      ...(costMetadata.inputCostUsd !== undefined ? { inputCostUsd: costMetadata.inputCostUsd } : {}),
      ...(costMetadata.cachedInputCostUsd !== undefined ? { cachedInputCostUsd: costMetadata.cachedInputCostUsd } : {}),
      ...(costMetadata.outputCostUsd !== undefined ? { outputCostUsd: costMetadata.outputCostUsd } : {}),
      costSource: costMetadata.costSource ?? (hasKnownCost ? 'unknown' : 'none'),
      ...(costMetadata.noCostReason ? { noCostReason: costMetadata.noCostReason } : {}),
      currency: costMetadata.currency ?? (costMetadata.estimatedCostUsd !== undefined ? 'USD' : 'none'),
    },
  };
}

export function baseObservabilityMetadata(
  inputs: Record<string, unknown>,
  provider: {
    provider: 'langsmith' | 'langfuse';
    traceId?: string;
    traceUrl?: string;
    projectName?: string;
  }
): Record<string, unknown> {
  const triggerType = stringValue(inputs.triggerType);
  const triggerReason = stringValue(inputs.triggerReason);
  const mode = stringValue(inputs.mode);
  return compactRecord({
    observabilitySchemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    telemetryLane: process.env.FLEETGRAPH_OBSERVABILITY_LANE || 'real',
    synthetic: process.env.FLEETGRAPH_OBSERVABILITY_LANE === 'synthetic_calibration',
    provider: provider.provider,
    providerProject: provider.projectName,
    providerTraceId: provider.traceId,
    providerTraceUrl: provider.traceUrl,
    app: 'ship-shape',
    subsystem: 'fleetgraph',
    environment: observabilityEnvironment(),
    release: observabilityRelease(),
    version: observabilityVersion(),
    gitSha: gitSha(),
    mode,
    triggerType,
    triggerReason,
    workspaceHash: stringValue(inputs.workspaceHash),
    promptSource: 'code_template',
    promptName: promptNameForTrigger(triggerType),
    promptVersion: promptVersionForTrigger(triggerType),
  });
}

export function resultObservabilityMetadata(
  inputs: Record<string, unknown>,
  result: FleetGraphResult,
  provider: {
    provider: 'langsmith' | 'langfuse';
    traceId?: string;
    traceUrl?: string;
    projectName?: string;
  }
): Record<string, unknown> {
  const usageSummary = traceUsageSummary(result);
  return compactRecord({
    ...baseObservabilityMetadata(inputs, provider),
    decision: result.decision,
    nodePath: result.traceMetadata.nodePath.join('>'),
    nodeCount: result.traceMetadata.nodePath.length,
    findingIdHash: result.finding?.id ? fleetGraphStableHash(result.finding.id) : undefined,
    sourceIssueHash: result.runInput.sourceIssueId ? fleetGraphStableHash(result.runInput.sourceIssueId) : undefined,
    sourceSprintHash: result.runInput.sourceSprintId ? fleetGraphStableHash(result.runInput.sourceSprintId) : undefined,
    modelBoundary: result.tokenMetadata.modelCalls > 0 ? 'real_model' : 'deterministic',
    modelCalls: result.tokenMetadata.modelCalls,
    modelProvider: result.tokenMetadata.provider ?? 'none',
    modelName: result.tokenMetadata.model ?? 'none',
    inputTokens: result.tokenMetadata.inputTokens,
    cachedInputTokens: result.tokenMetadata.cachedInputTokens,
    billableInputTokens: result.tokenMetadata.billableInputTokens,
    outputTokens: result.tokenMetadata.outputTokens,
    totalTokens: result.tokenMetadata.totalTokens,
    usageSource: result.tokenMetadata.usageSource ?? (result.tokenMetadata.modelCalls > 0 ? 'unknown' : 'none'),
    noUsageReason: result.tokenMetadata.noUsageReason ?? (
      result.tokenMetadata.modelCalls > 0 ? undefined : FLEETGRAPH_NO_MODEL_USAGE_REASON
    ),
    estimatedCostUsd: result.costMetadata.estimatedCostUsd,
    inputCostUsd: result.costMetadata.inputCostUsd,
    cachedInputCostUsd: result.costMetadata.cachedInputCostUsd,
    outputCostUsd: result.costMetadata.outputCostUsd,
    costSource: result.costMetadata.costSource ?? (result.costMetadata.estimatedCostUsd !== undefined ? 'unknown' : 'none'),
    noCostReason: result.costMetadata.noCostReason ?? (
      result.tokenMetadata.modelCalls > 0 ? undefined : FLEETGRAPH_NO_MODEL_USAGE_REASON
    ),
    tokenUsage: usageSummary.tokenUsage,
    costUsage: usageSummary.costUsage,
    visibleEvidenceCount: result.visibleOutput?.evidence.length ?? result.evidence.length,
    noSafeOutput: result.visibleOutput?.noSafeOutput ?? false,
    errorCategory: typeof result.errorMetadata.category === 'string' ? result.errorMetadata.category : undefined,
  });
}

export function observabilityTags(
  inputs: Record<string, unknown>,
  options: {
    provider: 'langsmith' | 'langfuse';
    result?: FleetGraphResult;
    node?: string;
  }
): string[] {
  const triggerType = stringValue(inputs.triggerType);
  const mode = stringValue(inputs.mode);
  return [
    'fleetgraph',
    'provider_compare',
    `provider:${options.provider}`,
    process.env.FLEETGRAPH_OBSERVABILITY_LANE === 'synthetic_calibration' ? 'synthetic_calibration' : 'real',
    mode ? `mode:${mode}` : undefined,
    triggerType ? `trigger:${triggerType}` : undefined,
    options.result ? `decision:${options.result.decision}` : undefined,
    options.result ? `model_boundary:${options.result.tokenMetadata.modelCalls > 0 ? 'real_model' : 'deterministic'}` : undefined,
    options.node ? `node:${options.node}` : undefined,
  ].filter((tag): tag is string => Boolean(tag));
}

export function modelCallMetadata(
  traceInputs: Record<string, unknown>,
  tokenMetadata: FleetGraphResult['tokenMetadata'],
  costMetadata: FleetGraphResult['costMetadata']
): Record<string, unknown> {
  const triggerType = stringValue(traceInputs.triggerType);
  return compactRecord({
    modelBoundary: tokenMetadata.modelCalls > 0 ? 'real_model' : 'deterministic',
    modelProvider: tokenMetadata.provider,
    modelName: tokenMetadata.model,
    usageSource: tokenMetadata.usageSource,
    noUsageReason: tokenMetadata.noUsageReason,
    inputTokens: tokenMetadata.inputTokens,
    cachedInputTokens: tokenMetadata.cachedInputTokens,
    billableInputTokens: tokenMetadata.billableInputTokens,
    outputTokens: tokenMetadata.outputTokens,
    totalTokens: tokenMetadata.totalTokens,
    costSource: costMetadata.costSource,
    noCostReason: costMetadata.noCostReason,
    estimatedCostUsd: costMetadata.estimatedCostUsd,
    inputCostUsd: costMetadata.inputCostUsd,
    cachedInputCostUsd: costMetadata.cachedInputCostUsd,
    outputCostUsd: costMetadata.outputCostUsd,
    promptSource: 'code_template',
    promptName: promptNameForTrigger(triggerType),
    promptVersion: promptVersionForTrigger(triggerType),
  });
}

export function usageMetadataForLangSmith(tokenMetadata: FleetGraphResult['tokenMetadata']): Record<string, number> {
  return {
    ...(tokenMetadata.inputTokens !== undefined ? { input_tokens: tokenMetadata.inputTokens } : {}),
    ...(tokenMetadata.cachedInputTokens !== undefined ? { cached_input_tokens: tokenMetadata.cachedInputTokens } : {}),
    ...(tokenMetadata.billableInputTokens !== undefined ? { billable_input_tokens: tokenMetadata.billableInputTokens } : {}),
    ...(tokenMetadata.outputTokens !== undefined ? { output_tokens: tokenMetadata.outputTokens } : {}),
    ...(tokenMetadata.totalTokens !== undefined ? { total_tokens: tokenMetadata.totalTokens } : {}),
  };
}

export function usageMetadataForLangfuse(tokenMetadata: FleetGraphResult['tokenMetadata']): Record<string, number> {
  return {
    ...(tokenMetadata.inputTokens !== undefined ? { input: tokenMetadata.inputTokens } : {}),
    ...(tokenMetadata.cachedInputTokens !== undefined ? { cachedInput: tokenMetadata.cachedInputTokens } : {}),
    ...(tokenMetadata.billableInputTokens !== undefined ? { billableInput: tokenMetadata.billableInputTokens } : {}),
    ...(tokenMetadata.outputTokens !== undefined ? { output: tokenMetadata.outputTokens } : {}),
    ...(tokenMetadata.totalTokens !== undefined ? { total: tokenMetadata.totalTokens } : {}),
  };
}

export function costDetailsForLangfuse(costMetadata: FleetGraphResult['costMetadata']): Record<string, number> {
  return {
    ...(costMetadata.inputCostUsd !== undefined ? { input: costMetadata.inputCostUsd } : {}),
    ...(costMetadata.cachedInputCostUsd !== undefined ? { cachedInput: costMetadata.cachedInputCostUsd } : {}),
    ...(costMetadata.outputCostUsd !== undefined ? { output: costMetadata.outputCostUsd } : {}),
    ...(costMetadata.estimatedCostUsd !== undefined ? { total: costMetadata.estimatedCostUsd } : {}),
  };
}

function promptNameForTrigger(triggerType?: string): string | undefined {
  if (!triggerType) return undefined;
  if (triggerType === 'detector_decision') return 'fleetgraph.proactive_create';
  if (triggerType === 'refine_draft') return 'fleetgraph.refine_draft';
  if (triggerType === 'explain_finding') return 'fleetgraph.explain_finding';
  if (triggerType === 'context_chat') return 'fleetgraph.context_chat';
  return `fleetgraph.${triggerType}`;
}

function promptVersionForTrigger(triggerType?: string): string | undefined {
  return triggerType ? OBSERVABILITY_SCHEMA_VERSION : undefined;
}

export function observabilityEnvironment(): string {
  return process.env.LANGFUSE_TRACING_ENVIRONMENT?.trim() ||
    process.env.FLEETGRAPH_OBSERVABILITY_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV ||
    'development';
}

export function observabilityVersion(): string {
  return process.env.npm_package_version?.trim() || '0.0.0';
}

function observabilityRelease(): string {
  return process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    gitSha() ||
    'local';
}

function gitSha(): string | undefined {
  if (gitShaCache !== undefined) return gitShaCache ?? undefined;
  const fromEnv = process.env.GIT_SHA?.trim() || process.env.COMMIT_SHA?.trim();
  if (fromEnv) {
    gitShaCache = fromEnv.slice(0, 40);
    return gitShaCache;
  }
  try {
    gitShaCache = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    gitShaCache = null;
  }
  return gitShaCache ?? undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) =>
    value !== undefined &&
    !(Array.isArray(value) && value.length === 0)
  ));
}

export const TRACE_IO_TIMEOUT_MS = 5000;
export const TRACE_SHARE_TIMEOUT_MS = 5000;
export const TRACE_SHUTDOWN_TIMEOUT_MS = 10000;

export async function settleProviderCalls(promises: Promise<void>[]): Promise<string[]> {
  const results = await Promise.allSettled(promises);
  return results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

export function nodeOutput(name: string, output: unknown): Record<string, unknown> {
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

export function scrubTraceInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inputs).filter(([key, value]) =>
      !/prompt|completion|authorization|cookie|token|password|secret/i.test(key) &&
      typeof value !== 'object'
    )
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isEnabled(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function fleetGraphExternalTracingEnabled(enablement: FleetGraphTraceEnablement = {}): boolean {
  return isEnabled(process.env.FLEETGRAPH_EXTERNAL_TRACING_ENABLED)
    || enablement.reviewer === true;
}

export function fleetGraphTracingEnabled(enablement: FleetGraphTraceEnablement = {}): boolean {
  return fleetGraphExternalTracingEnabled(enablement) && (
    fleetGraphLangSmithEnabled(enablement) || fleetGraphLangfuseEnabled(enablement)
  );
}

export function fleetGraphLangSmithEnabled(enablement: FleetGraphTraceEnablement = {}): boolean {
  return fleetGraphExternalTracingEnabled(enablement) && (
    isEnabled(process.env.LANGSMITH_TRACING) || isEnabled(process.env.LANGCHAIN_TRACING_V2)
  );
}

export function fleetGraphLangfuseEnabled(enablement: FleetGraphTraceEnablement = {}): boolean {
  return fleetGraphExternalTracingEnabled(enablement) && (
    isEnabled(process.env.LANGFUSE_TRACING) || Boolean(
      process.env.LANGFUSE_PUBLIC_KEY?.trim() &&
      process.env.LANGFUSE_SECRET_KEY?.trim()
    )
  );
}
