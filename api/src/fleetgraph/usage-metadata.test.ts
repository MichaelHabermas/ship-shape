// Verifies FleetGraph usage wire metadata is omitted or shaped from run token/cost facts.
import { describe, expect, it } from 'vitest';
import {
  noModelCostMetadata,
  noModelTokenMetadata,
  usageMetadataFromResult,
} from './usage-metadata.js';

describe('usageMetadataFromResult', () => {
  it('returns undefined when no model calls were recorded', () => {
    expect(usageMetadataFromResult({
      tokenMetadata: noModelTokenMetadata(),
      costMetadata: noModelCostMetadata(),
    })).toBeUndefined();
  });

  it('returns undefined when token and cost metadata are missing', () => {
    expect(usageMetadataFromResult({})).toBeUndefined();
  });

  it('returns reviewer-facing usage facts when the graph used a model', () => {
    expect(usageMetadataFromResult({
      tokenMetadata: {
        modelCalls: 1,
        inputTokens: 100,
        cachedInputTokens: 10,
        billableInputTokens: 90,
        outputTokens: 20,
        totalTokens: 120,
        usageSource: 'model_response',
      },
      costMetadata: {
        estimatedCostUsd: 0.00012,
        currency: 'USD',
        costSource: 'catalog_estimate',
      },
    })).toEqual({
      modelCalls: 1,
      inputTokens: 100,
      cachedInputTokens: 10,
      billableInputTokens: 90,
      outputTokens: 20,
      totalTokens: 120,
      estimatedCostUsd: 0.00012,
      costCurrency: 'USD',
      usageSource: 'model_response',
      costSource: 'catalog_estimate',
    });
  });
});
