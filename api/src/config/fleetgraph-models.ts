export const FLEETGRAPH_DEFAULT_MODEL = 'gpt-5.5';

type FleetGraphModelPricing = {
  inputCostPer1M: number;
  cachedInputCostPer1M?: number;
  outputCostPer1M: number;
};

const FLEETGRAPH_MODEL_PRICING: Record<string, FleetGraphModelPricing> = {
  'gpt-5.5': { inputCostPer1M: 5.0, cachedInputCostPer1M: 0.5, outputCostPer1M: 30.0 },
  'gpt-5.4': { inputCostPer1M: 2.5, cachedInputCostPer1M: 0.25, outputCostPer1M: 15.0 },
  'gpt-4o-mini': { inputCostPer1M: 0.15, cachedInputCostPer1M: 0.075, outputCostPer1M: 0.6 },
};

export function resolveFleetGraphModelPricing(modelName: string): FleetGraphModelPricing | null {
  return FLEETGRAPH_MODEL_PRICING[modelName] ?? null;
}
