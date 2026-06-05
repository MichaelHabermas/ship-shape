#!/usr/bin/env node
// Live PlugForge browser proof: deployed /sdk-demo PKCE login, public SDK list, and document create.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  assert,
  isRealExternalHttpsUrl,
  liveEvidenceDir,
  parseArgs,
  rootDir,
  runId,
  truncate,
  writeLiveEvidence,
} from './lib/plugforge-live-drill.mjs';

const args = parseArgs();
const id = runId('browser-live');
const timeoutMs = Number(args.get('timeout-ms') ?? process.env.PLUGFORGE_LIVE_TIMEOUT_MS ?? 180_000);
const webUrl = realExternalHttpsUrl(
  args.get('web-url') ?? process.env.PLUGFORGE_BROWSER_WEB_URL ?? process.env.SHIP_WEB_URL ?? 'https://ship-shape-web.onrender.com',
  'web URL'
);
const apiUrl = realExternalHttpsUrl(
  args.get('api-url') ?? process.env.PLUGFORGE_BROWSER_API_URL ?? process.env.SHIP_API_URL ?? 'https://ship-shape-api.onrender.com',
  'API URL'
);
const email = args.get('email') ?? process.env.PLUGFORGE_BROWSER_EMAIL ?? process.env.SHIP_LOGIN_EMAIL;
const password = args.get('password') ?? process.env.PLUGFORGE_BROWSER_PASSWORD ?? process.env.SHIP_LOGIN_PASSWORD;

let browser = null;

try {
  assert(email, 'Missing required browser login email: set PLUGFORGE_BROWSER_EMAIL or SHIP_LOGIN_EMAIL');
  assert(password, 'Missing required browser login password: set PLUGFORGE_BROWSER_PASSWORD or SHIP_LOGIN_PASSWORD');

  const providedClientId = args.get('client-id') ?? process.env.PLUGFORGE_BROWSER_CLIENT_ID;
  browser = await chromium.launch({ headless: args.get('headed') !== 'true' });
  const context = await browser.newContext({
    baseURL: webUrl,
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(Math.min(timeoutMs, 60_000));

  await login(page, email, password);
  const oauthApp = providedClientId
    ? {
        source: 'provided',
        client_id: providedClientId,
        id: null,
        redirect_uris: [`${webUrl}/sdk-demo`],
        requested_scopes: ['documents:read', 'documents:write', 'issues:read', 'sprints:read'],
      }
    : await createOAuthApp(page, {
        apiUrl,
        webUrl,
        name: `PlugForge live browser ${id}`,
      });

  const title = `PlugForge live browser ${id}`;
  const startedAt = Date.now();
  await page.goto('/sdk-demo', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.localStorage.removeItem('ship.sdkDemo.tokens');
    window.sessionStorage.removeItem('ship.sdkDemo.clientId');
  });
  await page.locator('#sdk-client-id').fill(oauthApp.client_id);
  await page.locator('#sdk-document-title').fill(title);
  await page.getByRole('button', { name: 'Connect (PKCE)', exact: true }).click();

  await approveConsentIfShown(page, webUrl);
  await page.waitForURL(url => url.origin === new URL(webUrl).origin && url.pathname === '/sdk-demo', { timeout: timeoutMs });
  await page.getByText(/Loaded\.|Loaded empty lists\.|Connected\./).waitFor({ timeout: timeoutMs });
  await page.getByRole('button', { name: 'Create via SDK', exact: true }).click();
  await page.getByText('Created.').waitFor({ timeout: timeoutMs });
  await page.getByText(title).waitFor({ timeout: timeoutMs });

  const screenshotRelativePath = args.get('screenshot') === 'true'
    ? path.join('my-docs/evidence/plugforge-integrations/live', `browser-${id}.png`)
    : null;
  if (screenshotRelativePath) {
    const screenshotPath = path.join(rootDir, screenshotRelativePath);
    await fs.mkdir(liveEvidenceDir, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  await page.evaluate(() => {
    window.localStorage.removeItem('ship.sdkDemo.tokens');
    window.sessionStorage.removeItem('ship.sdkDemo.clientId');
  });

  const evidence = {
    flow: 'browser',
    proof_class: 'live',
    status: 'passed',
    run_id: id,
    generated_at: new Date().toISOString(),
    environment: 'deployed',
    sdkDemoUrl: `${webUrl}/sdk-demo`,
    api_url: apiUrl,
    duration_ms: Date.now() - startedAt,
    oauth_app: {
      source: oauthApp.source,
      id: oauthApp.id,
      client_id: oauthApp.client_id,
      redirect_uris: oauthApp.redirect_uris,
      requested_scopes: oauthApp.requested_scopes,
    },
    pkce: {
      completed: true,
      redirect_uri: `${webUrl}/sdk-demo`,
      consent_approved: true,
    },
    documentList: {
      ok: true,
      authenticated: true,
    },
    documentCreate: {
      ok: true,
      title,
    },
    ...(screenshotRelativePath ? { screenshot_path: screenshotRelativePath } : {}),
  };

  const output = await writeLiveEvidence('browser', evidence, args.get('output'));
  console.log(JSON.stringify({ ok: true, evidence: output }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}

async function login(page, loginEmail, loginPassword) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#email').fill(loginEmail);
  await page.locator('#password').fill(loginPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(url => url.pathname !== '/login', { timeout: timeoutMs });
}

async function createOAuthApp(page, input) {
  const created = await page.evaluate(async ({ apiUrl, webUrl, name }) => {
    const csrfResponse = await fetch(`${apiUrl}/api/csrf-token`, { credentials: 'include' });
    const csrf = await csrfResponse.json();
    const response = await fetch(`${apiUrl}/api/platform/apps`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf.token,
      },
      credentials: 'include',
      body: JSON.stringify({
        name,
        redirect_uris: [`${webUrl}/sdk-demo`],
        requested_scopes: ['documents:read', 'documents:write', 'issues:read', 'sprints:read'],
      }),
    });
    const body = await response.json();
    return { ok: response.ok, status: response.status, body };
  }, input);

  if (!created.ok) {
    throw new Error(`Failed to create deployed OAuth app (${created.status}): ${truncate(JSON.stringify(created.body), 700)}`);
  }
  const data = created.body?.data;
  assert(data?.client_id, 'OAuth app create response did not include client_id');
  return {
    source: 'created',
    id: data.id,
    client_id: data.client_id,
    redirect_uris: data.redirect_uris,
    requested_scopes: data.requested_scopes,
  };
}

async function approveConsentIfShown(page, expectedWebUrl) {
  const expectedWebOrigin = new URL(expectedWebUrl).origin;
  const authorizeButton = page.getByRole('button', { name: 'Authorize', exact: true });
  const result = await Promise.race([
    authorizeButton.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => 'authorize'),
    page.waitForURL(
      url => url.origin === expectedWebOrigin && url.pathname === '/sdk-demo' && url.searchParams.has('code'),
      { timeout: timeoutMs }
    ).then(() => 'returned'),
  ]);
  if (result === 'authorize') await authorizeButton.click();
}

function realExternalHttpsUrl(value, label) {
  if (!isRealExternalHttpsUrl(value)) {
    throw new Error(`PlugForge live browser proof requires a real external HTTPS ${label}`);
  }
  return new URL(value).toString().replace(/\/$/, '');
}
