// Canonical FleetGraph model usage and cost metadata helpers for runs and API wire output.
import type { FleetGraphUsage } from '@ship/shared';
import type { FleetGraphCostMetadata, FleetGraphTokenMetadata } from './types.js';

export const FLEETGRAPH_NO_MODEL_USAGE_REASON = 'deterministic_no_model_call';

export function noModelTokenMetadata(): FleetGraphTokenMetadata {
  return {
    modelCalls: 0,
    usageSource: 'none',
    noUsageReason: FLEETGRAPH_NO_MODEL_USAGE_REASON,
  };
}

export function noModelCostMetadata(): FleetGraphCostMetadata {
  return {
    costSource: 'none',
    noCostReason: FLEETGRAPH_NO_MODEL_USAGE_REASON,
  };
}

export function usageMetadataFromResult(input: {
  tokenMetadata?: FleetGraphTokenMetadata;
  costMetadata?: FleetGraphCostMetadata;
}): FleetGraphUsage | undefined {
  const token = input.tokenMetadata ?? noModelTokenMetadata();
  const cost = input.costMetadata ?? noModelCostMetadata();
  const modelCalls = Number(token.modelCalls ?? 0);
  if (modelCalls === 0) return undefined;

  return {
    modelCalls,
    inputTokens: token.inputTokens,
    cachedInputTokens: token.cachedInputTokens,
    billableInputTokens: token.billableInputTokens,
    outputTokens: token.outputTokens,
    totalTokens: token.totalTokens,
    estimatedCostUsd: cost.estimatedCostUsd,
    costCurrency: cost.currency,
    usageSource: token.usageSource,
    costSource: cost.costSource,
  };
}
