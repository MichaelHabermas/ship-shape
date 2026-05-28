// FleetGraph manual detector runner summarizes read-only detector decisions for local validation.
import { runFleetGraphTick, type FleetGraphDryRunTickSummary } from '../execution/tick-runner.js';

export type ManualFleetGraphDetectorSummary = FleetGraphDryRunTickSummary;

export async function runManualFleetGraphDetector(input: {
  workspaceId: string;
  today?: Date;
  limit?: number;
}): Promise<ManualFleetGraphDetectorSummary> {
  return runFleetGraphTick({
    mode: 'dryRun',
    workspaceId: input.workspaceId,
    today: input.today,
    limit: input.limit,
  });
}
