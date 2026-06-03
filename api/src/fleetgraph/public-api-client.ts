// FleetGraph public API client factory forces user-initiated agent reads through @ship/sdk.
import type { Pool, PoolClient } from 'pg';
import { ShipClient, type FetchLike } from '@ship/sdk';
import { pool } from '../db/client.js';
import {
  mintDelegatedShipAgentToken,
  type DelegatedShipAgentToken,
} from '../platform/oauth/agent-token-broker.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type ShipAgentPublicClient = {
  client: ShipClient;
  token: DelegatedShipAgentToken;
};

export async function createShipAgentPublicClient(
  input: {
    workspaceId: string;
    userId: string;
    baseUrl?: string;
    fetch?: FetchLike;
  },
  db: QueryRunner = pool
): Promise<ShipAgentPublicClient> {
  const token = await mintDelegatedShipAgentToken({
    workspaceId: input.workspaceId,
    userId: input.userId,
  }, db);
  return {
    token,
    client: new ShipClient({
      token: token.token,
      baseUrl: input.baseUrl ?? fleetGraphPublicApiBaseUrl(),
      fetch: input.fetch,
    }),
  };
}

export function fleetGraphPublicApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.FLEETGRAPH_PUBLIC_API_BASE_URL?.trim() ||
    env.PUBLIC_API_BASE_URL?.trim() ||
    env.SHIP_API_URL?.trim() ||
    env.API_BASE_URL?.trim() ||
    `http://127.0.0.1:${env.PORT?.trim() || '3000'}`
  );
}
