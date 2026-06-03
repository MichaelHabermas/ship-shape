import {
  fleetGraphForbiddenTraceData,
  fleetGraphSharedGraphRequiredNodes,
} from './boundaries.js';
import type {
  FleetGraphEvalModelBoundary,
  FleetGraphEvalTraceBoundary,
} from './types.js';

export const findingRunDraftTraceWrites = [
  'fleetgraph_findings',
  'fleetgraph_runs',
  'fleetgraph_findings.draft_content',
  'fleetgraph_findings.trace_metadata',
] as const;

export const runOnlyWrites = ['fleetgraph_runs'] as const;

export const findingStatusAndRunWrites = ['fleetgraph_findings.status', 'fleetgraph_runs'] as const;

export const draftAndRunWrites = ['fleetgraph_findings.draft_content', 'fleetgraph_runs'] as const;

export const sqlOnlyBoundary = {
  expectedModelCalls: 0,
  expectedModelCost: 0,
} as const satisfies FleetGraphEvalModelBoundary;

export const boundedModelBoundary = {
  expectedModelCalls: 'bounded',
  expectedModelCost: 'bounded',
} as const satisfies FleetGraphEvalModelBoundary;

export const sharedGraphTraceBoundary = {
  requiredNodes: fleetGraphSharedGraphRequiredNodes,
  forbiddenTraceData: fleetGraphForbiddenTraceData,
} as const satisfies FleetGraphEvalTraceBoundary;

export const detectorOnlyTraceBoundary = {
  requiredNodes: ['detector', 'quietExit', 'persistFleetGraphState'],
  forbiddenTraceData: sharedGraphTraceBoundary.forbiddenTraceData,
} as const satisfies FleetGraphEvalTraceBoundary;

export const changeSummaryTraceBoundary = {
  requiredNodes: ['normalizeTrigger', 'resolveScope', 'fetchCurrentObject', 'filterVisibleEvidence', 'compareAnchor', 'produceOutput'],
  forbiddenTraceData: sharedGraphTraceBoundary.forbiddenTraceData,
} as const satisfies FleetGraphEvalTraceBoundary;
