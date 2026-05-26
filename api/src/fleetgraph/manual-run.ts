// FleetGraph manual runs execute detector decisions through the shared tick runner.
import type { Principal } from '../security/principal.js';
import type { FleetGraphCoreOptions } from './core.js';
import { runFleetGraphTick } from './tick-runner.js';
import type { FleetGraphResult } from './types.js';
import { pool } from '../db/client.js';

type QueryRunner = Pick<typeof pool, 'query'>;

export type RunFleetGraphManualInput = {
  workspaceId: string;
  principal: Principal;
  today?: Date;
  limit?: number;
  db?: QueryRunner;
  graphOptions?: Omit<FleetGraphCoreOptions, 'db'>;
};

export type FleetGraphManualRunSummary = {
  mode: 'proactive';
  detectorDecisions: number;
  results: FleetGraphResult[];
};

export async function runFleetGraphManualTick(input: RunFleetGraphManualInput): Promise<FleetGraphManualRunSummary> {
  return runFleetGraphTick({
    mode: 'execute',
    workspaceId: input.workspaceId,
    principal: input.principal,
    today: input.today,
    limit: input.limit,
    db: input.db,
    graphOptions: input.graphOptions,
  });
}
