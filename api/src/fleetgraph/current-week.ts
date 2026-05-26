// FleetGraph current-week resolution reuses Ship's workspace sprint cadence.
import { computeCurrentSprintNumber, normalizeWorkspaceStartDate, utcToday } from '@ship/shared';
import { pool } from '../db/client.js';
import { requireFirstRow } from '../utils/query-rows.js';

type QueryRunner = Pick<typeof pool, 'query'>;

type WorkspaceSprintStartRow = {
  sprint_start_date: Date | string | null;
};

export type FleetGraphCurrentWeek = {
  workspaceStartDate: Date;
  currentSprintNumber: number;
};

export async function resolveFleetGraphCurrentWeek(
  workspaceId: string,
  input: {
    db?: QueryRunner;
    today?: Date;
  } = {}
): Promise<FleetGraphCurrentWeek> {
  const db = input.db ?? pool;
  const result = await db.query<WorkspaceSprintStartRow>(
    `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const workspaceStartDate = normalizeWorkspaceStartDate(requireFirstRow(result.rows).sprint_start_date);
  const currentSprintNumber = computeCurrentSprintNumber(
    workspaceStartDate,
    7,
    input.today ?? utcToday()
  );

  return {
    workspaceStartDate,
    currentSprintNumber,
  };
}
