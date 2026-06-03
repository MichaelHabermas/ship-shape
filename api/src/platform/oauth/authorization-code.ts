// Authorization Code + PKCE request, consent, approval, and code exchange flows.
import type { OAuthConsentRequest } from '@ship/shared';
import { pool } from '../../db/client.js';
import { findActiveOAuthAppByClientId, upsertGrant } from './grants.js';
import { isValidPkceChallenge } from './pkce.js';
import { generateAuthorizationCode, hashOAuthSecret } from './secrets.js';
import { normalizeScopes, parseOAuthScope } from './scopes.js';
import {
  AUTHORIZATION_CODE_TTL_MS,
  AUTHORIZATION_REQUEST_TTL_MS,
  OAuthProviderError,
  type ApprovedAuthorizationRequest,
  type AuthorizationRequestInput,
  type AuthorizationRequestRow,
  type CreatedAuthorizationRequest,
  type GrantRow,
  type QueryRunner,
} from './types.js';

function appendOAuthRedirectParams(redirectUri: string, code: string, state: string | null): string {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) {
    url.searchParams.set('state', state);
  }
  return url.toString();
}

async function findPendingAuthorizationRequest(
  requestId: string,
  userId: string,
  workspaceId: string,
  db: QueryRunner,
  forUpdate = false
): Promise<AuthorizationRequestRow> {
  const result = await db.query<AuthorizationRequestRow>(
    `SELECT
       r.id,
       r.app_id,
       r.user_id,
       r.workspace_id,
       r.client_id,
       r.redirect_uri,
       r.requested_scopes,
       r.state,
       r.code_challenge,
       r.code_challenge_method,
       r.expires_at,
       r.approved_at,
       r.denied_at,
       a.name AS app_name,
       a.is_active AS app_active
     FROM oauth_authorization_requests r
     JOIN oauth_apps a ON a.id = r.app_id AND a.workspace_id = r.workspace_id
     WHERE r.id = $1
       AND r.user_id = $2
       AND r.workspace_id = $3
     ${forUpdate ? 'FOR UPDATE OF r' : ''}`,
    [requestId, userId, workspaceId]
  );
  const row = result.rows[0];
  if (
    !row ||
    !row.app_active ||
    row.approved_at ||
    row.denied_at ||
    new Date(row.expires_at) <= new Date()
  ) {
    throw new OAuthProviderError('invalid_request', 'Authorization request not found');
  }
  return row;
}

export async function createAuthorizationRequest(
  input: AuthorizationRequestInput,
  db: QueryRunner = pool
): Promise<CreatedAuthorizationRequest> {
  if (input.responseType !== 'code') {
    throw new OAuthProviderError('invalid_request', 'response_type must be code');
  }
  if (input.codeChallengeMethod !== 'S256') {
    throw new OAuthProviderError('invalid_request', 'code_challenge_method must be S256');
  }
  if (!isValidPkceChallenge(input.codeChallenge)) {
    throw new OAuthProviderError('invalid_request', 'Invalid code_challenge');
  }

  const requestedScopes = parseOAuthScope(input.scope);
  const app = await findActiveOAuthAppByClientId(input.clientId, db);
  if (!app) {
    throw new OAuthProviderError('invalid_client', 'Invalid client_id');
  }
  if (app.workspace_id !== input.workspaceId) {
    throw new OAuthProviderError('invalid_client', 'OAuth app is not in the active workspace');
  }
  if (!app.redirect_uris.includes(input.redirectUri)) {
    throw new OAuthProviderError('invalid_request', 'Invalid redirect_uri');
  }

  const appScopes = normalizeScopes(app.requested_scopes);
  const disallowedScope = requestedScopes.find(scope => !appScopes.includes(scope));
  if (disallowedScope) {
    throw new OAuthProviderError('invalid_scope', `Scope not registered for this app: ${disallowedScope}`);
  }

  const membership = await db.query(
    `SELECT 1
     FROM workspace_memberships
     WHERE workspace_id = $1
       AND user_id = $2`,
    [app.workspace_id, input.userId]
  );
  if (!membership.rows[0]) {
    throw new OAuthProviderError('invalid_client', 'User is not a member of the app workspace');
  }

  const result = await db.query<{ id: string }>(
    `INSERT INTO oauth_authorization_requests (
       app_id,
       user_id,
       workspace_id,
       client_id,
       redirect_uri,
       requested_scopes,
       state,
       code_challenge,
       code_challenge_method,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'S256', $9)
     RETURNING id`,
    [
      app.id,
      input.userId,
      input.workspaceId,
      input.clientId,
      input.redirectUri,
      requestedScopes,
      input.state ?? null,
      input.codeChallenge,
      new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS),
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('OAuth authorization request insert did not return a row');
  }

  return { requestId: row.id };
}

export async function getConsentRequest(
  requestId: string,
  userId: string,
  workspaceId: string,
  db: QueryRunner = pool
): Promise<OAuthConsentRequest> {
  const request = await findPendingAuthorizationRequest(requestId, userId, workspaceId, db);
  const existingGrant = await db.query<GrantRow>(
    `SELECT granted_scopes
     FROM oauth_grants
     WHERE app_id = $1
       AND user_id = $2
       AND workspace_id = $3
       AND revoked_at IS NULL`,
    [request.app_id, userId, workspaceId]
  );

  const requestedScopes = normalizeScopes(request.requested_scopes);
  const previouslyGrantedScopes = normalizeScopes(existingGrant.rows[0]?.granted_scopes);
  return {
    request_id: request.id,
    app: {
      name: request.app_name,
      client_id: request.client_id,
    },
    redirect_uri: request.redirect_uri,
    requested_scopes: requestedScopes,
    previously_granted_scopes: previouslyGrantedScopes,
    new_scopes: requestedScopes.filter(scope => !previouslyGrantedScopes.includes(scope)),
  };
}

export async function approveAuthorizationRequest(
  requestId: string,
  userId: string,
  workspaceId: string
): Promise<ApprovedAuthorizationRequest> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await findPendingAuthorizationRequest(requestId, userId, workspaceId, client, true);
    const requestedScopes = normalizeScopes(request.requested_scopes);
    const grant = await upsertGrant({
      appId: request.app_id,
      userId,
      workspaceId,
      requestedScopes,
    }, client);
    const code = generateAuthorizationCode();
    const codeHash = hashOAuthSecret(code);
    await client.query(
      `INSERT INTO oauth_authorization_codes (
         authorization_request_id,
         grant_id,
         app_id,
         user_id,
         workspace_id,
         code_hash,
         redirect_uri,
         granted_scopes,
         state,
         code_challenge,
         code_challenge_method,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'S256', $11)`,
      [
        request.id,
        grant.id,
        request.app_id,
        userId,
        workspaceId,
        codeHash,
        request.redirect_uri,
        requestedScopes,
        request.state,
        request.code_challenge,
        new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
      ]
    );
    await client.query(
      `UPDATE oauth_authorization_requests
       SET approved_at = NOW()
       WHERE id = $1`,
      [request.id]
    );
    await client.query('COMMIT');

    return {
      code,
      redirectUrl: appendOAuthRedirectParams(request.redirect_uri, code, request.state),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { exchangeAuthorizationCode } from './refresh-rotation.js';
