// Shared OAuth provider types, errors, and timing constants for grant flows.
import type { Pool, PoolClient } from 'pg';
import type { OAuthErrorCode, PublicApiScope } from '@ship/shared';

export type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
export const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
export const DEVICE_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;
export const DEVICE_SLOW_DOWN_INCREMENT_SECONDS = 5;
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_FAMILY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class OAuthProviderError extends Error {
  readonly oauthCode: OAuthErrorCode;
  readonly status: number;

  constructor(oauthCode: OAuthErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'OAuthProviderError';
    this.oauthCode = oauthCode;
    this.status = status;
  }
}

export type OAuthAppRow = {
  id: string;
  workspace_id: string;
  name: string;
  client_id: string;
  redirect_uris: string[];
  requested_scopes: unknown;
  is_active: boolean;
};

export type AuthorizationRequestRow = {
  id: string;
  app_id: string;
  user_id: string;
  workspace_id: string;
  client_id: string;
  redirect_uri: string;
  requested_scopes: unknown;
  state: string | null;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: Date | string;
  approved_at: Date | string | null;
  denied_at: Date | string | null;
  app_name: string;
  app_active: boolean;
};

export type GrantRow = {
  id: string;
  granted_scopes: unknown;
};

export type AuthorizationCodeRow = GrantRow & {
  grant_id: string;
  app_id: string;
  user_id: string;
  workspace_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  app_active: boolean;
};

export type RefreshTokenRow = GrantRow & {
  family_id: string;
  grant_id: string;
  app_id: string;
  user_id: string;
  workspace_id: string;
  client_id: string;
  token_expires_at: Date | string;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
  family_expires_at: Date | string;
  invalidated_at: Date | string | null;
  app_active: boolean;
};

export type DeviceAuthorizationRow = {
  id: string;
  app_id: string;
  workspace_id: string;
  client_id: string;
  requested_scopes: unknown;
  interval_seconds: number;
  last_polled_at: Date | string | null;
  expires_at: Date | string;
  authorized_user_id: string | null;
  grant_id: string | null;
  authorized_at: Date | string | null;
  denied_at: Date | string | null;
  consumed_at: Date | string | null;
  app_name: string;
  app_active: boolean;
};

export type AuthorizationRequestInput = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  userId: string;
  workspaceId: string;
};

export type CreatedAuthorizationRequest = {
  requestId: string;
};

export type ApprovedAuthorizationRequest = {
  redirectUrl: string;
  code: string;
};

export type TokenPairInput = {
  appId: string;
  grantId: string;
  userId: string;
  workspaceId: string;
  scopes: PublicApiScope[];
};
