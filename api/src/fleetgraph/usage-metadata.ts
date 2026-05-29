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
