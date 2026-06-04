// Developer ops drill covers portal app creation, webhook DLQ visibility, and replay idempotency.
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ApiResponse, OAuthTokenResponse, PublicDocument } from '@ship/shared';
import { test, expect, type Page } from './fixtures/isolated-env';
import { loginAsAdmin } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';

type PlatformAppList = {
  apps: Array<{
    id: string;
    name: string;
    client_id: string;
  }>;
};

type CapturedDelivery = {
  headers: http.IncomingHttpHeaders;
  rawBody: string;
};

class DrillWebhookReceiver {
  readonly deliveries: CapturedDelivery[] = [];
  private server: http.Server | null = null;
  mode: 'fail' | 'success' = 'fail';

  async listen(): Promise<string> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        this.deliveries.push({
          headers: req.headers,
          rawBody: Buffer.concat(chunks).toString('utf8'),
        });
        if (this.mode === 'fail') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"ok":false}');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/webhook`;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = null;
  }
}

test('developer portal replays a DLQ webhook with the original idempotency key', async ({ page, apiServer, webServer }) => {
  const receiver = new DrillWebhookReceiver();
  const targetUrl = await receiver.listen();

  try {
    await loginAsAdmin(page, apiServer.url);
    const appName = `Portal Drill ${Date.now()}`;
    const redirectUri = `${webServer.url}/oauth-test/callback`;

    await page.goto('/settings?tab=developer');
    await expect(page.getByRole('button', { name: 'Create App' })).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder('App name').fill(appName);
    await page.getByPlaceholder('https://example.com/oauth/callback').fill(redirectUri);
    await page.getByText('documents:write').click();
    await page.getByRole('button', { name: 'Create App' }).click();
    const createdSecret = page.locator('code', { hasText: /^ship_secret_/ });
    await expect(createdSecret).toBeVisible({ timeout: 15000 });
    await expectNoBrowserSecret(page, await textContentOrThrow(createdSecret));
    await page.getByRole('button', { name: 'Dismiss' }).click();

    const createdApp = await findPlatformApp(page, apiServer.url, appName);
    await expect(page.getByText(createdApp.client_id).first()).toBeVisible();
    await page.getByLabel('Revoke previous immediately').check();
    await page.getByRole('button', { name: 'Rotate' }).click();
    const rotatedSecret = page.locator('code', { hasText: /^ship_secret_/ });
    await expect(rotatedSecret).toBeVisible({ timeout: 15000 });
    await expectNoBrowserSecret(page, await textContentOrThrow(rotatedSecret));
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('code', { hasText: /^ship_secret_/ })).toHaveCount(0);

    await page.getByPlaceholder('https://hooks.example.com/ship').fill(targetUrl);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(targetUrl)).toBeVisible({ timeout: 15000 });

    const token = await issueWriteToken(page, {
      apiUrl: apiServer.url,
      clientId: createdApp.client_id,
      redirectUri,
    });

    receiver.mode = 'fail';
    const publicRequestId = `developer-ops-${Date.now()}`;
    const documentResponse = await page.request.post(`${apiServer.url}/api/v1/documents`, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'x-request-id': publicRequestId,
      },
      data: {
        title: `portal webhook drill ${Date.now()}`,
      },
    });
    expect(documentResponse.ok()).toBeTruthy();
    const document = await readJsonAs<PublicDocument>(documentResponse);
    const idempotencyKey = `document.created:${document.id}`;

    await expect.poll(() => receiver.deliveries.some(delivery => (
      headerValue(delivery.headers, 'idempotency-key') === idempotencyKey
    )), { timeout: 15000 }).toBe(true);

    await page.goto('/settings?tab=developer');
    await expect(page.getByText(appName).first()).toBeVisible({ timeout: 15000 });

    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect(page.getByText(idempotencyKey)).toBeVisible({ timeout: 3000 });
      await expect(page.getByText('dlq', { exact: true })).toBeVisible({ timeout: 3000 });
      await expect(page.getByText(publicRequestId)).toBeVisible({ timeout: 3000 });
      await expect(page.getByText('POST /api/v1/documents')).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 15000 });

    receiver.mode = 'success';
    const deliveryCountBeforeReplay = receiver.deliveries.length;
    await page.getByRole('button', { name: 'Replay' }).click();
    await expect.poll(() => receiver.deliveries.length, { timeout: 15000 }).toBeGreaterThan(deliveryCountBeforeReplay);
    expect(headerValue(receiver.deliveries.at(-1)?.headers ?? {}, 'idempotency-key')).toBe(idempotencyKey);
  } finally {
    await receiver.close();
  }
});

async function findPlatformApp(page: Page, apiUrl: string, appName: string) {
  const response = await page.request.get(`${apiUrl}/api/platform/apps`);
  expect(response.ok()).toBeTruthy();
  const body = await readJsonAs<ApiResponse<PlatformAppList>>(response);
  const app = body.data?.apps.find(candidate => candidate.name === appName);
  if (!app) throw new Error(`Could not find platform app ${appName}`);
  return app;
}

async function textContentOrThrow(locator: ReturnType<Page['locator']>): Promise<string> {
  const text = await locator.textContent();
  if (!text) throw new Error('Expected visible secret text');
  return text;
}

async function expectNoBrowserSecret(page: Page, secret: string): Promise<void> {
  const storageSnapshot = await page.evaluate(() => JSON.stringify({
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  }));
  expect(storageSnapshot).not.toContain(secret);
}

async function issueWriteToken(
  page: Page,
  input: {
    apiUrl: string;
    clientId: string;
    redirectUri: string;
  }
): Promise<OAuthTokenResponse> {
  const pkce = createPkcePair();
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'documents:write',
    state: 'developer-ops-drill',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  });

  await page.goto(`/oauth/authorize?${params.toString()}`);
  await expect(page).toHaveURL(/\/oauth\/consent\?request_id=/);
  await page.getByRole('button', { name: 'Authorize' }).click();
  await expect(page).toHaveURL(/\/oauth-test\/callback\?/);

  const callback = new URL(page.url());
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('OAuth callback omitted authorization code');

  const tokenResponse = await page.request.post(`${input.apiUrl}/oauth/token`, {
    form: {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code,
      code_verifier: pkce.verifier,
    },
  });
  expect(tokenResponse.ok()).toBeTruthy();
  return readJsonAs<OAuthTokenResponse>(tokenResponse);
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function headerValue(headers: http.IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
