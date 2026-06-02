// OAuth app service owns client ids, shown-once secrets, and app registration persistence.
import crypto from 'crypto';
import argon2 from 'argon2';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/client.js';
import { PUBLIC_API_SCOPES, type PublicApiScope } from '../scopes/registry.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type CreateOAuthAppInput = {
  workspaceId: string;
  ownerUserId: string;
  name: string;
  redirectUris: string[];
  requestedScopes: PublicApiScope[];
};

export type CreatedOAuthApp = {
  id: string;
  client_id: string;
  client_secret: string;
  name: string;
  redirect_uris: string[];
  requested_scopes: PublicApiScope[];
  created_at: Date | string;
};

type CreatedOAuthAppRow = Omit<CreatedOAuthApp, 'client_secret'>;

const PUBLIC_SCOPE_SET = new Set<string>(PUBLIC_API_SCOPES);

export function isPublicApiScope(scope: string): scope is PublicApiScope {
  return PUBLIC_SCOPE_SET.has(scope);
}

export function generateOAuthClientId(): string {
  return `ship_app_${crypto.randomBytes(16).toString('hex')}`;
}

export function generateOAuthClientSecret(): string {
  return `ship_secret_${crypto.randomBytes(32).toString('hex')}`;
}

export async function hashOAuthClientSecret(secret: string): Promise<string> {
  return argon2.hash(secret, { type: argon2.argon2id });
}

export async function verifyOAuthClientSecret(hash: string, secret: string): Promise<boolean> {
  return argon2.verify(hash, secret);
}

export async function createOAuthApp(
  input: CreateOAuthAppInput,
  db: QueryRunner = pool
): Promise<CreatedOAuthApp> {
  const clientId = generateOAuthClientId();
  const clientSecret = generateOAuthClientSecret();
  const clientSecretHash = await hashOAuthClientSecret(clientSecret);

  const result = await db.query<CreatedOAuthAppRow>(
    `INSERT INTO oauth_apps (
       workspace_id,
       owner_user_id,
       name,
       client_id,
       client_secret_hash,
       redirect_uris,
       requested_scopes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, client_id, name, redirect_uris, requested_scopes, created_at`,
    [
      input.workspaceId,
      input.ownerUserId,
      input.name,
      clientId,
      clientSecretHash,
      input.redirectUris,
      input.requestedScopes,
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('OAuth app insert did not return a row');
  }

  return {
    ...row,
    requested_scopes: row.requested_scopes.filter(isPublicApiScope),
    client_secret: clientSecret,
  };
}
