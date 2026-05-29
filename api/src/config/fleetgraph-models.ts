export const FLEETGRAPH_DEFAULT_MODEL = 'gpt-4.1-mini';

const FLEETGRAPH_MODEL_PRICING: Record<string, { inputCostPer1M: number; outputCostPer1M: number }> = {
  'gpt-5.5': { inputCostPer1M: 5.0, outputCostPer1M: 30.0 },
  'gpt-4.1-mini': { inputCostPer1M: 0.4, outputCostPer1M: 1.6 },
  'gpt-4o-mini': { inputCostPer1M: 0.15, outputCostPer1M: 0.6 },
};

export function resolveFleetGraphModelPricing(modelName: string): { inputCostPer1M: number; outputCostPer1M: number } | null {
  return FLEETGRAPH_MODEL_PRICING[modelName] ?? null;
}
