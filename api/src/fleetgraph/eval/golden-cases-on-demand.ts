import { restrictedCases } from './golden-cases-on-demand-restricted.js';
import { summarizeCases } from './golden-cases-on-demand-summarize.js';
import type { FleetGraphGoldenCase } from './types.js';

export const onDemandCases = [...summarizeCases, ...restrictedCases] satisfies readonly FleetGraphGoldenCase[];
