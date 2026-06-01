// Projects FleetGraph findings into actor-safe wire responses from durable rows.
import type { FleetGraphFindingResponse } from '@ship/shared';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/client.js';
import type { Principal } from '../security/principal.js';
import { fleetGraphFindingResponse } from './api-contract.js';
import { visibleOutputForFinding } from './evidence.js';
import { getFleetGraphFindingById, type FleetGraphFinding } from './persistence.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export async function projectFindingForActor(input: {
  principal?: Principal;
  workspaceId: string;
  finding: FleetGraphFinding;
  db?: QueryRunner;
}): Promise<FleetGraphFindingResponse | null> {
  const visible = await visibleOutputForFinding({
    principal: input.principal,
    workspaceId: input.workspaceId,
    finding: input.finding,
    db: input.db,
  });
  if (visible.output.noSafeOutput) return null;
  return fleetGraphFindingResponse({
    ...input.finding,
    visibleOutput: visible.output,
  });
}

export async function projectFindingByIdForActor(input: {
  principal?: Principal;
  workspaceId: string;
  findingId: string;
  db?: QueryRunner;
}): Promise<FleetGraphFindingResponse | null> {
  const db = input.db ?? pool;
  const finding = await getFleetGraphFindingById({
    workspaceId: input.workspaceId,
    findingId: input.findingId,
  }, db);
  if (!finding) return null;
  return projectFindingForActor({
    principal: input.principal,
    workspaceId: input.workspaceId,
    finding,
    db,
  });
}
