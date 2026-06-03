// FleetGraph core facade exposes the graph runner and its public option types.
export type { FleetGraphCoreOptions, FleetGraphPersistencePort } from './core/types.js';
export { runFleetGraph, shouldAutoCaptureTrace } from './core/graph.js';
