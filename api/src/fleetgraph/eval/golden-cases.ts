// FleetGraph golden cases define expected graph decisions before graph implementation.
import { onDemandCases } from './golden-cases-on-demand.js';
import { proactiveErrorCases } from './golden-cases-proactive-error.js';
import { proactiveCases } from './golden-cases-proactive.js';
import type { FleetGraphGoldenCase } from './types.js';

export const fleetGraphGoldenCases = [
  ...proactiveCases,
  ...onDemandCases,
  ...proactiveErrorCases,
] satisfies readonly FleetGraphGoldenCase[];
