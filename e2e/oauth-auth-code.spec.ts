// Browser proof for OAuth Authorization Code + PKCE from authorize through /api/v1/me.
import crypto from 'crypto';
import type { ApiResponse, OAuthErrorResponse, OAuthTokenResponse, PublicMe } from '@ship/shared';
import { test, expect, type Page } from './fixtures/isolated-env';
import { loginAsAdmin } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type { components } from '../web/src/api/generated/ship-openapi';

type CreatedOAuthApp = components['schemas']['OAuthAppCreated'];

test.describe('OAuth Authorization Code + PKCE', () => {
  test('runs authorize consent token me and rejects a wrong verifier', async ({ page, apiServer, webServer }) => {
    const { csrfToken } = await loginAsAdmin(page, apiServer.url);
    const redirectUri = `${webServer.url}/oauth-test/callback`;
    const oauthApp = await createOAuthApp(page, apiServer.url, csrfToken, redirectUri);

    const validPkce = createPkcePair();
    const validCode = await authorizeAndApprove(page, {
      clientId: oauthApp.client_id,
      redirectUri,
      challenge: validPkce.challenge,
      state: 'valid-flow',
    });

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

    const wrongPkce = createPkcePair();
    const wrongCode = await authorizeAndApprove(page, {
      clientId: oauthApp.client_id,
      redirectUri,
      challenge: wrongPkce.challenge,
      state: 'wrong-verifier',
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
  });
});

async function createOAuthApp(
  page: Page,
  apiUrl: string,
  csrfToken: string,
  redirectUri: string
): Promise<CreatedOAuthApp> {
  const response = await page.request.post(`${apiUrl}/api/platform/apps`, {
    headers: {
      'x-csrf-token': csrfToken,
    },
    data: {
      name: `E2E OAuth ${Date.now()}`,
      redirect_uris: [redirectUri],
      requested_scopes: ['documents:read'],
    },
  });
  expect(response.ok()).toBeTruthy();

  const body = await readJsonAs<ApiResponse<CreatedOAuthApp>>(response);
  expect(body.success).toBe(true);
  expect(body.data?.client_id).toMatch(/^ship_app_/);
  expect(body.data?.redirect_uris).toEqual([redirectUri]);
  expect(body.data?.requested_scopes).toEqual(['documents:read']);
  if (!body.data) throw new Error('OAuth app creation response omitted data');
  return body.data;
}

async function authorizeAndApprove(
  page: Page,
  input: {
    clientId: string;
    redirectUri: string;
    challenge: string;
    state: string;
  }
): Promise<string> {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'documents:read',
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  });

  await page.goto(`/oauth/authorize?${params.toString()}`);
  await expect(page).toHaveURL(/\/oauth\/consent\?request_id=/);
  await expect(page.getByRole('heading', { name: 'Authorize app access' })).toBeVisible();
  await page.getByRole('button', { name: 'Authorize' }).click();
  await expect(page).toHaveURL(/\/oauth-test\/callback\?/);

  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe(input.state);
  const code = callback.searchParams.get('code');
  expect(code).toMatch(/^ship_oac_/);
  if (!code) throw new Error('OAuth callback omitted authorization code');
  return code;
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
