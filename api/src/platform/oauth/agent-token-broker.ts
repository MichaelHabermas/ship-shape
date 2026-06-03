// Delegated Ship Agent token broker mints real OAuth access tokens for user-initiated agent turns.
import type { Pool, PoolClient } from 'pg';
import type { PublicApiScope } from '@ship/shared';
import { pool } from '../../db/client.js';
import {
  SHIP_AGENT_SCOPES,
  ensureShipAgentOAuthApp,
} from '../apps/service.js';
import {
  createOAuthAccessToken,
  type CreatedOAuthAccessToken,
} from './tokens.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

const SHIP_AGENT_TOKEN_TTL_MS = 15 * 60 * 1000;

export type DelegatedShipAgentToken = CreatedOAuthAccessToken & {
  appId: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  scopes: PublicApiScope[];
};

export async function mintDelegatedShipAgentToken(
  input: {
    workspaceId: string;
    userId: string;
    scopes?: readonly PublicApiScope[];
    now?: Date;
  },
  db: QueryRunner = pool
): Promise<DelegatedShipAgentToken> {
  const app = await ensureShipAgentOAuthApp({ workspaceId: input.workspaceId }, db);
  const scopes = boundedShipAgentScopes(input.scopes, app.requested_scopes);
  const now = input.now ?? new Date();
  const token = await createOAuthAccessToken({
    appId: app.id,
    userId: input.userId,
    workspaceId: input.workspaceId,
    grantedScopes: scopes,
    expiresAt: new Date(now.getTime() + SHIP_AGENT_TOKEN_TTL_MS),
  }, db);

  return {
    ...token,
    appId: app.id,
    clientId: app.client_id,
    userId: input.userId,
    workspaceId: input.workspaceId,
    scopes,
  };
}

function boundedShipAgentScopes(
  requestedScopes: readonly PublicApiScope[] | undefined,
  appScopes: readonly PublicApiScope[]
): PublicApiScope[] {
  const scopes = [...(requestedScopes ?? SHIP_AGENT_SCOPES)];
  const appAllowedScopes = new Set<PublicApiScope>(appScopes);
  const canonicalAgentScopes = new Set<PublicApiScope>(SHIP_AGENT_SCOPES);
  for (const scope of scopes) {
    if (!canonicalAgentScopes.has(scope) || !appAllowedScopes.has(scope)) {
      throw new Error(`SHIP_AGENT_SCOPE_NOT_ALLOWED:${scope}`);
    }
  }
  return scopes;
}
