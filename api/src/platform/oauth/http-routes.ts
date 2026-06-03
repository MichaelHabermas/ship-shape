// OAuth HTTP adapter parses protocol requests and delegates grant/code/token state to the provider service.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type {
  OAuthConsentApprovalResponse,
  OAuthDeviceApprovalResponse,
  OAuthDeviceAuthorizationResponse,
} from '@ship/shared';
import { sessionCookieOptions } from '../../config/session-cookies.js';
import { authMiddleware } from '../../middleware/auth.js';
import { validateAuthenticatedSession } from '../../services/session-auth.js';
import { getAuthenticatedRouteContext } from '../../utils/auth-context.js';
import {
  OAuthProviderError,
  approveAuthorizationRequest,
  approveDeviceAuthorization,
  createAuthorizationRequest,
  createDeviceAuthorization,
  exchangeAuthorizationCode,
  exchangeDeviceCode,
  getDeviceVerificationRequest,
  getConsentRequest,
  rotateRefreshToken,
} from './provider.js';

const authorizeQuerySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  response_type: z.string().min(1),
  scope: z.string().min(1),
  state: z.string().optional(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.string().min(1),
});

const consentApproveSchema = z.object({
  request_id: z.string().uuid(),
});

const authorizationCodeBodySchema = z.object({
  grant_type: z.literal('authorization_code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  code: z.string().min(1),
  code_verifier: z.string().min(1),
});

const refreshTokenBodySchema = z.object({
  grant_type: z.literal('refresh_token'),
  client_id: z.string().min(1),
  refresh_token: z.string().min(1),
});

const deviceCodeTokenBodySchema = z.object({
  grant_type: z.literal('urn:ietf:params:oauth:grant-type:device_code'),
  client_id: z.string().min(1),
  device_code: z.string().min(1),
});

const tokenBodySchema = z.discriminatedUnion('grant_type', [
  authorizationCodeBodySchema,
  refreshTokenBodySchema,
  deviceCodeTokenBodySchema,
]);

const deviceCodeRequestBodySchema = z.object({
  client_id: z.string().min(1),
  scope: z.string().min(1),
});

const deviceVerifyQuerySchema = z.object({
  user_code: z.string().min(1),
});

const deviceVerifyBodySchema = z.object({
  user_code: z.string().min(1),
});

const router = Router();

router.get('/authorize', async (req: Request, res: Response): Promise<void> => {
  const session = await validateSessionForBrowser(req, res);
  if (!session) {
    redirectToLogin(req, res);
    return;
  }
  if (!session.workspaceId) {
    res.status(403).json({ error: 'workspace_required' });
    return;
  }

  const parsed = authorizeQuerySchema.safeParse(stringRecordFromQuery(req.query));
  if (!parsed.success) {
    sendOAuthError(res, new OAuthProviderError('invalid_request', 'Invalid authorization request'));
    return;
  }

  try {
    const request = await createAuthorizationRequest({
      clientId: parsed.data.client_id,
      redirectUri: parsed.data.redirect_uri,
      responseType: parsed.data.response_type,
      scope: parsed.data.scope,
      state: parsed.data.state,
      codeChallenge: parsed.data.code_challenge,
      codeChallengeMethod: parsed.data.code_challenge_method,
      userId: session.userId,
      workspaceId: session.workspaceId,
    });
    res.redirect(302, consentPageUrl(req, request.requestId));
  } catch (error) {
    sendProviderOrUnknownError(res, error);
  }
});

router.get(
  '/consent/request/:requestId',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const requestId = z.string().uuid().safeParse(req.params.requestId);
    if (!requestId.success) {
      res.status(400).json({ success: false, error: { code: 'validation_error', message: 'Invalid consent request' } });
      return;
    }

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    try {
      const request = await getConsentRequest(requestId.data, userId, workspaceId);
      res.json({ success: true, data: request });
    } catch (error) {
      sendProviderOrUnknownError(res, error);
    }
  }
);

router.post(
  '/consent/approve',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = consentApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { code: 'validation_error', message: 'Invalid consent request' } });
      return;
    }

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    try {
      const approval = await approveAuthorizationRequest(parsed.data.request_id, userId, workspaceId);
      const data: OAuthConsentApprovalResponse = {
        redirect_url: approval.redirectUrl,
      };
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      sendProviderOrUnknownError(res, error);
    }
  }
);

router.post('/token', (req: Request, res: Response): void => {
  void handleTokenRequest(req, res);
});

router.post('/device/code', async (req: Request, res: Response): Promise<void> => {
  applyTokenResponseHeaders(res);
  const parsed = deviceCodeRequestBodySchema.safeParse(stringRecordFromBody(req.body));
  if (!parsed.success) {
    sendOAuthError(res, new OAuthProviderError('invalid_request', 'Invalid device authorization request'));
    return;
  }

  try {
    const authorization = await createDeviceAuthorization({
      clientId: parsed.data.client_id,
      scope: parsed.data.scope,
    });
    const verificationUri = `${requestOrigin(req)}/oauth/device`;
    const body: OAuthDeviceAuthorizationResponse = {
      ...authorization,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(authorization.user_code)}`,
    };
    res.json(body);
  } catch (error) {
    sendProviderOrUnknownError(res, error);
  }
});

router.get(
  '/device/verify',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = deviceVerifyQuerySchema.safeParse(stringRecordFromQuery(req.query));
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { code: 'validation_error', message: 'Invalid user code' } });
      return;
    }

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    try {
      const request = await getDeviceVerificationRequest({
        userCode: parsed.data.user_code,
        userId,
        workspaceId,
      });
      res.json({ success: true, data: request });
    } catch (error) {
      sendProviderOrUnknownError(res, error);
    }
  }
);

router.post(
  '/device/verify',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = deviceVerifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { code: 'validation_error', message: 'Invalid user code' } });
      return;
    }

    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    try {
      await approveDeviceAuthorization({
        userCode: parsed.data.user_code,
        userId,
        workspaceId,
      });
      const data: OAuthDeviceApprovalResponse = { approved: true };
      res.json({ success: true, data });
    } catch (error) {
      sendProviderOrUnknownError(res, error);
    }
  }
);

async function handleTokenRequest(req: Request, res: Response): Promise<void> {
  applyTokenResponseHeaders(res);
  const rawBody = stringRecordFromBody(req.body);
  if (
    rawBody.grant_type &&
    rawBody.grant_type !== 'authorization_code' &&
    rawBody.grant_type !== 'refresh_token' &&
    rawBody.grant_type !== 'urn:ietf:params:oauth:grant-type:device_code'
  ) {
    sendOAuthError(res, new OAuthProviderError('unsupported_grant_type', 'Unsupported grant_type'));
    return;
  }

  const parsed = tokenBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    sendOAuthError(res, new OAuthProviderError('invalid_request', 'Invalid token request'));
    return;
  }

  try {
    const tokenResponse = await exchangeTokenByGrant(parsed.data);

    res.json(tokenResponse);
  } catch (error) {
    sendProviderOrUnknownError(res, error);
  }
}

async function exchangeTokenByGrant(
  data: z.infer<typeof tokenBodySchema>
): Promise<Awaited<ReturnType<typeof exchangeAuthorizationCode>>> {
  switch (data.grant_type) {
    case 'authorization_code':
      return exchangeAuthorizationCode({
        clientId: data.client_id,
        redirectUri: data.redirect_uri,
        code: data.code,
        codeVerifier: data.code_verifier,
      });
    case 'refresh_token':
      return rotateRefreshToken({
        clientId: data.client_id,
        refreshToken: data.refresh_token,
      });
    case 'urn:ietf:params:oauth:grant-type:device_code':
      return exchangeDeviceCode({
        clientId: data.client_id,
        deviceCode: data.device_code,
      });
  }
}

async function validateSessionForBrowser(
  req: Request,
  res: Response
): Promise<{ userId: string; workspaceId: string | null; isSuperAdmin: boolean } | null> {
  if (typeof req.cookies?.session_id !== 'string') return null;

  const userAgentHeader = req.headers['user-agent'];
  const validation = await validateAuthenticatedSession(req.cookies.session_id, {
    updateActivity: true,
    userAgent: Array.isArray(userAgentHeader)
      ? String(userAgentHeader[0])
      : typeof userAgentHeader === 'string'
        ? userAgentHeader
        : null,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
  });

  if (!validation.ok) return null;
  if (validation.activityUpdated) {
    res.cookie('session_id', validation.session.sessionId, sessionCookieOptions());
  }

  return {
    userId: validation.session.userId,
    workspaceId: validation.session.workspaceId,
    isSuperAdmin: validation.session.isSuperAdmin,
  };
}

function redirectToLogin(req: Request, res: Response): void {
  const returnTo = absoluteRequestUrl(req);
  const frontendOrigin = configuredFrontendOrigin();
  if (frontendOrigin) {
    const loginUrl = new URL('/login', frontendOrigin);
    loginUrl.searchParams.set('returnTo', returnTo);
    res.redirect(302, loginUrl.toString());
    return;
  }

  res.redirect(302, `/login?returnTo=${encodeURIComponent(returnTo)}`);
}

function consentPageUrl(req: Request, requestId: string): string {
  const frontendOrigin = configuredFrontendOrigin();
  const path = `/oauth/consent?request_id=${encodeURIComponent(requestId)}`;
  if (!frontendOrigin) return path;

  return new URL(path, frontendOrigin).toString();
}

function configuredFrontendOrigin(): string | null {
  const value = [
    process.env.FRONTEND_URL,
    process.env.WEB_URL,
    process.env.CORS_ORIGIN,
  ]
    .flatMap(candidate => (candidate ?? '').split(','))
    .map(candidate => candidate.trim())
    .find(candidate => candidate && candidate !== '*');

  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function absoluteRequestUrl(req: Request): string {
  return `${requestOrigin(req)}${req.originalUrl}`;
}

function requestOrigin(req: Request): string {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const protocol = forwardedProto ?? req.protocol;
  const host = forwardedHost ?? req.get('host') ?? '';
  return `${protocol}://${host}`;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function stringRecordFromQuery(query: Request['query']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : []))
  );
}

function stringRecordFromBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return Object.fromEntries(
    Object.entries(body).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : []))
  );
}

function applyTokenResponseHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

function sendProviderOrUnknownError(res: Response, error: unknown): void {
  if (error instanceof OAuthProviderError) {
    sendOAuthError(res, error);
    return;
  }

  console.error('OAuth provider error:', error);
  sendOAuthError(res, new OAuthProviderError('invalid_request', 'OAuth request failed', 500));
}

function sendOAuthError(res: Response, error: OAuthProviderError): void {
  res.status(error.status).json({
    error: error.oauthCode,
    error_description: error.message,
  });
}

export default router;
