// OAuth provider tests prove the real Authorization Code + PKCE front door and refresh rotation.
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import {
  OAuthConsentApprovalResponseSchema,
  OAuthConsentRequestSchema,
  OAuthDeviceAuthorizationResponseSchema,
  OAuthErrorResponseSchema,
  OAuthTokenResponseSchema,
  PublicMeResponseSchema,
} from '@ship/shared';
import { createApp } from '../../app.js';
import { pool } from '../../db/client.js';
import { expectJsonBody } from '../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';
import { validateOAuthAccessToken } from './tokens.js';
import {
  OAuthProviderError,
  approveAuthorizationRequest,
  approveDeviceAuthorization,
  createAuthorizationRequest,
  createDeviceAuthorization,
  exchangeAuthorizationCode,
  exchangeDeviceCode,
  generateRefreshToken,
  getConsentRequest,
  getDeviceVerificationRequest,
  hashOAuthSecret,
  rotateRefreshToken,
} from './provider.js';

const ConsentRequestSchema = z.object({
  success: z.literal(true),
  data: OAuthConsentRequestSchema,
});

const ConsentApprovalSchema = z.object({
  success: z.literal(true),
  data: OAuthConsentApprovalResponseSchema,
});

const DeviceAuthorizationResponseSchema = OAuthDeviceAuthorizationResponseSchema;
const TokenResponseSchema = OAuthTokenResponseSchema;
const OAuthErrorSchema = OAuthErrorResponseSchema;

describe('OAuth Authorization Code + PKCE provider', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `oauth-provider-${testRunId}@ship.local`;
  const clientId = `ship_app_provider_${testRunId}`;
  const redirectUri = 'http://localhost:4173/oauth-test/callback';

  let workspaceId: string;
  let userId: string;
  let sessionId: string;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`OAuth Provider ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'OAuth Provider User')
       RETURNING id`,
      [email]
    );
    userId = requireFirstRow(userResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [workspaceId, userId]
    );

    await pool.query(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, 'OAuth Provider Test App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        [redirectUri],
        ['documents:read', 'issues:read'],
      ]
    );

    sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, NOW() + interval '1 hour')`,
      [sessionId, userId, workspaceId]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2', [workspaceId, clientId]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_refresh_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_refresh_token_families WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_authorization_codes WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_authorization_requests WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_device_authorizations WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_grants WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('runs authorize to consent to token to /api/v1/me through HTTP routes', async () => {
    const pkce = createPkcePair();
    const authorizeResponse = await request(app)
      .get('/oauth/authorize')
      .set('Cookie', `session_id=${sessionId}`)
      .query(authorizeQuery(pkce.challenge, 'state-route-proof'));

    expect(authorizeResponse.status).toBe(302);
    expect(authorizeResponse.headers['x-frame-options']).toBe('DENY');
    expect(authorizeResponse.headers['content-security-policy']).toBe("frame-ancestors 'none'");

    const requestId = requestIdFromConsentLocation(authorizeResponse.headers.location);
    const consentResponse = await request(app)
      .get(`/oauth/consent/request/${requestId}`)
      .set('Cookie', `session_id=${sessionId}`);

    const consent = expectJsonBody(consentResponse, 200, ConsentRequestSchema);
    expect(consent.data).toMatchObject({
      request_id: requestId,
      redirect_uri: redirectUri,
      requested_scopes: ['documents:read'],
    });

    const csrf = await getCsrfCookie();
    const approvalResponse = await request(app)
      .post('/oauth/consent/approve')
      .set('Cookie', `${csrf.cookie}; session_id=${sessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({ request_id: requestId });

    const approval = expectJsonBody(approvalResponse, 200, ConsentApprovalSchema);
    const callbackUrl = new URL(approval.data.redirect_url);
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
    expect(callbackUrl.searchParams.get('state')).toBe('state-route-proof');
    const code = callbackUrl.searchParams.get('code');
    expect(code).toMatch(/^ship_oac_/);

    const tokenResponse = await request(app)
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: pkce.verifier,
      });

    const token = expectJsonBody(tokenResponse, 200, TokenResponseSchema);
    expect(tokenResponse.headers['cache-control']).toBe('no-store');
    expect(tokenResponse.headers.pragma).toBe('no-cache');
    expect(token.scope).toBe('documents:read');

    const meResponse = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token.access_token}`);
    const me = expectJsonBody(meResponse, 200, PublicMeResponseSchema);
    expect(me.user.email).toBe(email);
    expect(me.app.client_id).toBe(clientId);

    const wrongVerifier = await approvedAuthorizationCode(createPkcePair(), 'wrong-verifier-route');
    const wrongResponse = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code: wrongVerifier.code,
        code_verifier: pkce.verifier,
      });
    const wrong = expectJsonBody(wrongResponse, 400, OAuthErrorSchema);
    expect(wrong.error).toBe('invalid_grant');
  });

  it('redirects unauthenticated authorize requests to login with the authorize URL as returnTo', async () => {
    const pkce = createPkcePair();
    const response = await request(app)
      .get('/oauth/authorize')
      .query(authorizeQuery(pkce.challenge, 'needs-login'));

    expect(response.status).toBe(302);
    const location = response.headers.location;
    expect(location).toContain('/login?returnTo=');
    expect(decodeURIComponent(location)).toContain('/oauth/authorize');
  });

  it('returns configured web origin for Device Grant verification URLs', async () => {
    await withWebOriginEnv({
      FRONTEND_URL: 'https://ship-shape-web.onrender.com',
      WEB_URL: '',
      CORS_ORIGIN: 'https://ship-shape-api.onrender.com',
    }, async () => {
      const response = await request(app)
        .post('/oauth/device/code')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-host', 'ship-shape-api.onrender.com')
        .type('form')
        .send({
          client_id: clientId,
          scope: 'documents:read',
        });

      const authorization = expectJsonBody(response, 200, DeviceAuthorizationResponseSchema);
      expect(authorization.verification_uri).toBe('https://ship-shape-web.onrender.com/oauth/device');
      expect(authorization.verification_uri_complete).toBe(
        `https://ship-shape-web.onrender.com/oauth/device?user_code=${encodeURIComponent(authorization.user_code)}`
      );
    });
  });

  it('falls back to request origin for Device Grant verification URLs without a configured web origin', async () => {
    await withWebOriginEnv({
      FRONTEND_URL: '',
      WEB_URL: '',
      CORS_ORIGIN: '*',
    }, async () => {
      const response = await request(app)
        .post('/oauth/device/code')
        .set('x-forwarded-proto', 'https')
        .set('x-forwarded-host', 'api.local.test')
        .type('form')
        .send({
          client_id: clientId,
          scope: 'documents:read',
        });

      const authorization = expectJsonBody(response, 200, DeviceAuthorizationResponseSchema);
      expect(authorization.verification_uri).toBe('https://api.local.test/oauth/device');
      expect(authorization.verification_uri_complete).toBe(
        `https://api.local.test/oauth/device?user_code=${encodeURIComponent(authorization.user_code)}`
      );
    });
  });

  it('rejects invalid authorization request inputs', async () => {
    const pkce = createPkcePair();
    await expectOAuthError(
      () => createAuthorizationRequest({
        ...serviceAuthorizeInput(pkce.challenge),
        responseType: 'token',
      }),
      'invalid_request'
    );
    await expectOAuthError(
      () => createAuthorizationRequest({
        ...serviceAuthorizeInput(pkce.challenge),
        clientId: `ship_app_missing_${testRunId}`,
      }),
      'invalid_client'
    );
    await expectOAuthError(
      () => createAuthorizationRequest({
        ...serviceAuthorizeInput(pkce.challenge),
        redirectUri: 'https://example.test/not-registered',
      }),
      'invalid_request'
    );
    await expectOAuthError(
      () => createAuthorizationRequest({
        ...serviceAuthorizeInput(pkce.challenge),
        scope: 'documents:read me:read',
      }),
      'invalid_scope'
    );
    await expectOAuthError(
      () => createAuthorizationRequest({
        ...serviceAuthorizeInput(pkce.challenge),
        codeChallenge: 'short',
      }),
      'invalid_request'
    );
    await expectOAuthError(
      () => createAuthorizationRequest({
        ...serviceAuthorizeInput(pkce.challenge),
        codeChallengeMethod: 'plain',
      }),
      'invalid_request'
    );
  });

  it('runs Device Grant pending to slow-down to approval to /api/v1/me', async () => {
    const authorization = await createDeviceAuthorization({
      clientId,
      scope: 'documents:read',
    });

    expect(authorization.device_code).toMatch(/^ship_odc_/);
    expect(authorization.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(authorization.interval).toBe(5);

    await expectOAuthError(
      () => exchangeDeviceCode({
        clientId,
        deviceCode: authorization.device_code,
      }),
      'authorization_pending'
    );
    await expectOAuthError(
      () => exchangeDeviceCode({
        clientId,
        deviceCode: authorization.device_code,
      }),
      'slow_down'
    );

    const verification = await getDeviceVerificationRequest({
      userCode: authorization.user_code,
      userId,
      workspaceId,
    });
    expect(verification.requested_scopes).toEqual(['documents:read']);

    await approveDeviceAuthorization({
      userCode: authorization.user_code,
      userId,
      workspaceId,
    });
    const token = await exchangeDeviceCode({
      clientId,
      deviceCode: authorization.device_code,
    });
    expect(token.access_token).toMatch(/^ship_oat_/);
    expect(token.refresh_token).toMatch(/^ship_ort_/);

    const meResponse = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token.access_token}`);
    const me = expectJsonBody(meResponse, 200, z.object({
      user: z.object({ id: z.string().uuid(), email: z.string(), name: z.string() }),
      app: z.object({ client_id: z.string() }),
      workspace_id: z.string().uuid(),
      granted_scopes: z.array(z.string()),
    }));
    expect(me.app.client_id).toBe(clientId);
    expect(me.granted_scopes).toEqual(['documents:read']);

    await expectOAuthError(
      () => exchangeDeviceCode({
        clientId,
        deviceCode: authorization.device_code,
      }),
      'invalid_grant'
    );
  });

  it('allows five concurrent Device Grant polling sessions to remain independently pending', async () => {
    const sessions = await Promise.all(
      Array.from({ length: 5 }, () => createDeviceAuthorization({
        clientId,
        scope: 'documents:read',
      }))
    );

    const results = await Promise.all(sessions.map(async (authorization) => {
      try {
        await exchangeDeviceCode({
          clientId,
          deviceCode: authorization.device_code,
        });
        return 'unexpected_success';
      } catch (error) {
        if (error instanceof OAuthProviderError) return error.oauthCode;
        throw error;
      }
    }));

    expect(results).toEqual([
      'authorization_pending',
      'authorization_pending',
      'authorization_pending',
      'authorization_pending',
      'authorization_pending',
    ]);
  });

  it('approves consent, hashes codes, exchanges once, and rejects reused or mismatched codes', async () => {
    const pkce = createPkcePair();
    const approved = await approvedAuthorizationCode(pkce, 'service-once');

    const codeRow = await pool.query<{ code_hash: string; consumed_at: Date | null }>(
      'SELECT code_hash, consumed_at FROM oauth_authorization_codes WHERE code_hash = $1',
      [hashOAuthSecret(approved.code)]
    );
    expect(codeRow.rows).toHaveLength(1);
    expect(codeRow.rows[0]?.code_hash).not.toBe(approved.code);
    expect(codeRow.rows[0]?.consumed_at).toBeNull();

    const token = await exchangeAuthorizationCode({
      clientId,
      redirectUri,
      code: approved.code,
      codeVerifier: pkce.verifier,
    });
    expect(token.access_token).toMatch(/^ship_oat_/);
    expect(token.refresh_token).toMatch(/^ship_ort_/);

    await expect(validateOAuthAccessToken(token.access_token)).resolves.toMatchObject({
      ok: true,
      context: {
        clientId,
        userId,
        workspaceId,
        grantedScopes: ['documents:read'],
      },
    });

    await expectOAuthError(
      () => exchangeAuthorizationCode({
        clientId,
        redirectUri,
        code: approved.code,
        codeVerifier: pkce.verifier,
      }),
      'invalid_grant'
    );

    const mismatch = await approvedAuthorizationCode(createPkcePair(), 'mismatch');
    await expectOAuthError(
      () => exchangeAuthorizationCode({
        clientId: `ship_app_other_${testRunId}`,
        redirectUri,
        code: mismatch.code,
        codeVerifier: mismatch.verifier,
      }),
      'invalid_grant'
    );
  });

  it('issues 15-minute access tokens and 30-day refresh token families', async () => {
    const issuedStartedAt = Date.now();
    const token = await issueTokenPair('ttl-proof');
    const issuedFinishedAt = Date.now();

    expect(token.expires_in).toBe(15 * 60);
    const rows = await pool.query<{
      access_expires_at: Date;
      family_expires_at: Date;
      refresh_expires_at: Date;
    }>(
      `SELECT
         access.expires_at AS access_expires_at,
         family.expires_at AS family_expires_at,
         refresh.expires_at AS refresh_expires_at
       FROM oauth_access_tokens access
       JOIN oauth_refresh_token_families family ON family.id = access.refresh_token_family_id
       JOIN oauth_refresh_tokens refresh ON refresh.family_id = family.id
       WHERE access.token_hash = $1
         AND refresh.token_hash = $2`,
      [hashOAuthSecret(token.access_token), hashOAuthSecret(token.refresh_token)]
    );
    const row = requireFirstRow(rows.rows);
    expect(row.access_expires_at.getTime()).toBeGreaterThanOrEqual(issuedStartedAt + 15 * 60 * 1000 - 1_000);
    expect(row.access_expires_at.getTime()).toBeLessThanOrEqual(issuedFinishedAt + 15 * 60 * 1000 + 1_000);
    expect(row.family_expires_at.getTime()).toBeGreaterThanOrEqual(issuedStartedAt + 30 * 24 * 60 * 60 * 1000 - 1_000);
    expect(row.family_expires_at.getTime()).toBeLessThanOrEqual(issuedFinishedAt + 30 * 24 * 60 * 60 * 1000 + 1_000);
    expect(row.refresh_expires_at.getTime()).toBe(row.family_expires_at.getTime());
  });

  it('rejects wrong verifiers and expired codes with invalid_grant', async () => {
    const wrongVerifier = await approvedAuthorizationCode(createPkcePair(), 'wrong-verifier');
    await expectOAuthError(
      () => exchangeAuthorizationCode({
        clientId,
        redirectUri,
        code: wrongVerifier.code,
        codeVerifier: createPkcePair().verifier,
      }),
      'invalid_grant'
    );

    const expired = await approvedAuthorizationCode(createPkcePair(), 'expired');
    await pool.query(
      `UPDATE oauth_authorization_codes
       SET expires_at = NOW() - interval '1 minute'
       WHERE code_hash = $1`,
      [hashOAuthSecret(expired.code)]
    );
    await expectOAuthError(
      () => exchangeAuthorizationCode({
        clientId,
        redirectUri,
        code: expired.code,
        codeVerifier: expired.verifier,
      }),
      'invalid_grant'
    );
  });

  it('rotates refresh tokens and invalidates the family on reuse', async () => {
    const first = await issueTokenPair('refresh-first');
    const rotated = await rotateRefreshToken({
      clientId,
      refreshToken: first.refresh_token,
    });

    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    expect(rotated.access_token).not.toBe(first.access_token);

    const refreshRows = await pool.query<{ token_hash: string }>(
      `SELECT token_hash
       FROM oauth_refresh_tokens
       WHERE token_hash = ANY($1)`,
      [[hashOAuthSecret(first.refresh_token), hashOAuthSecret(rotated.refresh_token)]]
    );
    expect(refreshRows.rows).toHaveLength(2);
    expect(refreshRows.rows.map(row => row.token_hash)).not.toContain(first.refresh_token);
    const oldRefresh = await pool.query<{ used_at: Date | null }>(
      'SELECT used_at FROM oauth_refresh_tokens WHERE token_hash = $1',
      [hashOAuthSecret(first.refresh_token)]
    );
    expect(requireFirstRow(oldRefresh.rows).used_at).not.toBeNull();

    await expectOAuthError(
      () => rotateRefreshToken({
        clientId,
        refreshToken: first.refresh_token,
      }),
      'invalid_grant'
    );
    await expectOAuthError(
      () => rotateRefreshToken({
        clientId,
        refreshToken: rotated.refresh_token,
      }),
      'invalid_grant'
    );

    const family = await pool.query<{ invalidated_reason: string | null; revoked_access_tokens: number }>(
      `SELECT
         f.invalidated_reason,
         COUNT(t.id)::int AS revoked_access_tokens
       FROM oauth_refresh_token_families f
       JOIN oauth_access_tokens t ON t.refresh_token_family_id = f.id
       WHERE f.id = (
         SELECT family_id FROM oauth_refresh_tokens WHERE token_hash = $1
       )
       AND t.revoked_at IS NOT NULL
       GROUP BY f.id`,
      [hashOAuthSecret(first.refresh_token)]
    );
    expect(requireFirstRow(family.rows)).toEqual({
      invalidated_reason: 'refresh_token_reuse',
      revoked_access_tokens: 2,
    });
  });

  it('rejects unknown refresh tokens', async () => {
    await expectOAuthError(
      () => rotateRefreshToken({
        clientId,
        refreshToken: generateRefreshToken(),
      }),
      'invalid_grant'
    );
  });

  async function approvedAuthorizationCode(
    pkce: { verifier: string; challenge: string },
    state: string
  ): Promise<{ code: string; verifier: string }> {
    const created = await createAuthorizationRequest({
      ...serviceAuthorizeInput(pkce.challenge),
      state,
    });
    const consent = await getConsentRequest(created.requestId, userId, workspaceId);
    expect(consent.requested_scopes).toEqual(['documents:read']);
    const approval = await approveAuthorizationRequest(created.requestId, userId, workspaceId);
    const redirect = new URL(approval.redirectUrl);
    expect(redirect.searchParams.get('state')).toBe(state);
    return { code: approval.code, verifier: pkce.verifier };
  }

  async function issueTokenPair(state: string): Promise<{
    access_token: string;
    expires_in: number;
    refresh_token: string;
  }> {
    const pkce = createPkcePair();
    const approved = await approvedAuthorizationCode(pkce, state);
    return exchangeAuthorizationCode({
      clientId,
      redirectUri,
      code: approved.code,
      codeVerifier: pkce.verifier,
    });
  }

  function serviceAuthorizeInput(codeChallenge: string): Parameters<typeof createAuthorizationRequest>[0] {
    return {
      clientId,
      redirectUri,
      responseType: 'code',
      scope: 'documents:read',
      state: undefined,
      codeChallenge,
      codeChallengeMethod: 'S256',
      userId,
      workspaceId,
    };
  }

  function authorizeQuery(codeChallenge: string, state: string): Record<string, string> {
    return {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'documents:read',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };
  }

  async function getCsrfCookie(): Promise<{ token: string; cookie: string }> {
    const response = await request(app).get('/api/csrf-token');
    const token = z.object({ token: z.string() }).parse(response.body).token;
    const cookie = response.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    return { token, cookie };
  }
});

async function withWebOriginEnv<T>(
  values: Pick<NodeJS.ProcessEnv, 'FRONTEND_URL' | 'WEB_URL' | 'CORS_ORIGIN'>,
  fn: () => Promise<T>
): Promise<T> {
  const previous = {
    FRONTEND_URL: process.env.FRONTEND_URL,
    WEB_URL: process.env.WEB_URL,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === '') delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function requestIdFromConsentLocation(location: string | undefined): string {
  if (!location) throw new Error('Missing OAuth consent redirect location');
  const url = new URL(location, 'http://localhost');
  const requestId = url.searchParams.get('request_id');
  if (!requestId) throw new Error(`Missing request_id in consent location: ${location}`);
  return requestId;
}

async function expectOAuthError(
  fn: () => Promise<unknown>,
  oauthCode: OAuthProviderError['oauthCode']
): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected OAuth error ${oauthCode}`);
  } catch (error) {
    expect(error).toBeInstanceOf(OAuthProviderError);
    expect((error as OAuthProviderError).oauthCode).toBe(oauthCode);
  }
}
