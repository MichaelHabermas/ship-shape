// Browser proof for OAuth Authorization Code + PKCE from authorize through /api/v1/me.
import crypto from 'crypto';
import type {
  ApiResponse,
  OAuthDeviceAuthorizationResponse,
  OAuthErrorResponse,
  OAuthTokenResponse,
  PublicMe,
} from '@ship/shared';
import { test, expect, type Page } from './fixtures/isolated-env';
import { loginAsAdmin } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type { components } from '../web/src/api/generated/ship-openapi';

type CreatedOAuthApp = components['schemas']['OAuthAppCreated'];

test.describe('OAuth Authorization Code + PKCE', () => {
  test('runs authorize consent token me and rejects a wrong verifier', async ({ page, apiServer, webServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);
    const redirectUri = `${webServer.url}/oauth-test/callback`;
    const oauthApp = await createOAuthApp(page, apiServer.url, csrfToken, redirectUri, [
      'documents:read',
      'issues:read',
    ]);

    const validPkce = createPkcePair();
    const validCode = await authorizeAndApprove(page, {
      apiUrl: apiServer.url,
      clientId: oauthApp.client_id,
      redirectUri,
      scope: 'documents:read',
      challenge: validPkce.challenge,
      state: 'valid-flow',
      expectedScopes: [
        ['documents:read', 'New'],
      ],
    });
    await expectNoBrowserSecret(page, oauthApp.client_secret);

    const tokenResponse = await page.request.post(`${apiServer.url}/oauth/token`, {
      form: {
        grant_type: 'authorization_code',
        client_id: oauthApp.client_id,
        redirect_uri: redirectUri,
        code: validCode,
        code_verifier: validPkce.verifier,
      },
    });
    expect(tokenResponse.ok()).toBeTruthy();
    expect(tokenResponse.headers()['cache-control']).toBe('no-store');
    const token = await readJsonAs<OAuthTokenResponse>(tokenResponse);
    expect(token).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      scope: 'documents:read',
    });
    expect(token.access_token).toMatch(/^ship_oat_/);
    expect(token.refresh_token).toMatch(/^ship_ort_/);

    const meResponse = await page.request.get(`${apiServer.url}/api/v1/me`, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    });
    expect(meResponse.ok()).toBeTruthy();
    const me = await readJsonAs<PublicMe>(meResponse);
    expect(me.user.email).toBe('dev@ship.local');
    expect(me.app.client_id).toBe(oauthApp.client_id);
    expect(me.granted_scopes).toEqual(['documents:read']);

    const upgradePkce = createPkcePair();
    await authorizeAndApprove(page, {
      apiUrl: apiServer.url,
      clientId: oauthApp.client_id,
      redirectUri,
      scope: 'documents:read issues:read',
      challenge: upgradePkce.challenge,
      state: 'scope-upgrade',
      expectedScopes: [
        ['documents:read', 'Granted'],
        ['issues:read', 'New'],
      ],
    });

    const wrongPkce = createPkcePair();
    const wrongCode = await authorizeAndApprove(page, {
      apiUrl: apiServer.url,
      clientId: oauthApp.client_id,
      redirectUri,
      scope: 'documents:read',
      challenge: wrongPkce.challenge,
      state: 'wrong-verifier',
      expectedScopes: [
        ['documents:read', 'Granted'],
      ],
    });
    const wrongResponse = await page.request.post(`${apiServer.url}/oauth/token`, {
      data: {
        grant_type: 'authorization_code',
        client_id: oauthApp.client_id,
        redirect_uri: redirectUri,
        code: wrongCode,
        code_verifier: validPkce.verifier,
      },
    });
    expect(wrongResponse.status()).toBe(400);
    const wrong = await readJsonAs<OAuthErrorResponse>(wrongResponse);
    expect(wrong.error).toBe('invalid_grant');
    await expectNoBrowserSecret(page, oauthApp.client_secret);
  });

  test('approves Device Grant manually and through a prefilled code with CSRF protection', async ({ page, apiServer, webServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);
    const oauthApp = await createOAuthApp(page, apiServer.url, csrfToken, `${webServer.url}/oauth-test/callback`, [
      'documents:read',
    ]);

    const prefilled = await createDeviceAuthorization(page, apiServer.url, oauthApp.client_id);
    await page.goto(`/oauth/device?user_code=${encodeURIComponent(prefilled.user_code)}`);
    await expect(page.getByRole('heading', { name: 'Approve device login' })).toBeVisible();
    await expect(page.locator('#user-code')).toHaveValue(prefilled.user_code);
    await expect(page.getByText(oauthApp.client_id)).toBeVisible();
    await expect(page.getByText('documents:read')).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved. You can return to the CLI.')).toBeVisible();

    const manual = await createDeviceAuthorization(page, apiServer.url, oauthApp.client_id);
    const csrfFailure = await page.request.post(`${apiServer.url}/oauth/device/verify`, {
      data: { user_code: manual.user_code },
    });
    expect(csrfFailure.status()).toBe(403);

    await page.goto('/oauth/device');
    await page.locator('#user-code').fill(manual.user_code.toLowerCase());
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText(oauthApp.client_id)).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved. You can return to the CLI.')).toBeVisible();
    await expectNoBrowserSecret(page, oauthApp.client_secret);
  });
});

async function createOAuthApp(
  page: Page,
  apiUrl: string,
  csrfToken: string,
  redirectUri: string,
  requestedScopes = ['documents:read']
): Promise<CreatedOAuthApp> {
  const response = await page.request.post(`${apiUrl}/api/platform/apps`, {
    headers: {
      'x-csrf-token': csrfToken,
    },
    data: {
      name: `E2E OAuth ${Date.now()}`,
      redirect_uris: [redirectUri],
      requested_scopes: requestedScopes,
    },
  });
  expect(response.ok()).toBeTruthy();

  const body = await readJsonAs<ApiResponse<CreatedOAuthApp>>(response);
  expect(body.success).toBe(true);
  expect(body.data?.client_id).toMatch(/^ship_app_/);
  expect(body.data?.redirect_uris).toEqual([redirectUri]);
  expect(body.data?.requested_scopes).toEqual(requestedScopes);
  if (!body.data) throw new Error('OAuth app creation response omitted data');
  return body.data;
}

async function authorizeAndApprove(
  page: Page,
  input: {
    apiUrl: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    challenge: string;
    state: string;
    expectedScopes: Array<[string, 'New' | 'Granted']>;
  }
): Promise<string> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: input.scope,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  });

  const authorizeResponse = await page.goto(`/oauth/authorize?${params.toString()}`);
  expect(authorizeResponse?.headers()['x-frame-options']).toBe('DENY');
  expect(authorizeResponse?.headers()['content-security-policy']).toBe("frame-ancestors 'none'");
  await expect(page).toHaveURL(/\/oauth\/consent\?request_id=/);
  await expect(page.getByRole('heading', { name: 'Authorize app access' })).toBeVisible();
  const consentRequestId = new URL(page.url()).searchParams.get('request_id');
  if (!consentRequestId) throw new Error('Consent page omitted request_id');
  const csrfFailure = await page.request.post(`${input.apiUrl}/oauth/consent/approve`, {
    data: { request_id: consentRequestId },
  });
  expect(csrfFailure.status()).toBe(403);
  for (const [scope, badge] of input.expectedScopes) {
    const row = page.getByText(scope, { exact: true }).locator('xpath=..');
    await expect(row.getByText(badge, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Authorize' }).click();
  await expect(page).toHaveURL(/\/oauth-test\/callback\?/);

  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe(input.state);
  const code = callback.searchParams.get('code');
  expect(code).toMatch(/^ship_oac_/);
  if (!code) throw new Error('OAuth callback omitted authorization code');
  return code;
}

async function createDeviceAuthorization(
  page: Page,
  apiUrl: string,
  clientId: string
): Promise<OAuthDeviceAuthorizationResponse> {
  const response = await page.request.post(`${apiUrl}/oauth/device/code`, {
    data: {
      client_id: clientId,
      scope: 'documents:read',
    },
  });
  expect(response.ok()).toBeTruthy();
  return readJsonAs<OAuthDeviceAuthorizationResponse>(response);
}

async function expectNoBrowserSecret(page: Page, secret: string): Promise<void> {
  const storageText = await page.evaluate(() => JSON.stringify({
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  }));
  expect(storageText).not.toContain(secret);
  expect(storageText).not.toContain('client_secret');
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
