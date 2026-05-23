#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const outDir = resolve(repoRoot, 'test-results/category-6-ai-unavailable');
const baseUrl = process.env.WEB_BASE_URL || 'http://localhost:5173';
const apiUrl = process.env.API_BASE_URL || 'http://localhost:3000';

async function login(context) {
  const tokenResponse = await context.request.get(`${apiUrl}/api/csrf-token`);
  if (!tokenResponse.ok()) throw new Error(`csrf failed: ${tokenResponse.status()}`);
  const { token } = await tokenResponse.json();

  const response = await context.request.post(`${apiUrl}/api/auth/login`, {
    headers: { 'x-csrf-token': token },
    data: {
      email: process.env.A11Y_EMAIL || 'dev@ship.local',
      password: process.env.A11Y_PASSWORD || 'admin123',
    },
  });
  if (!response.ok()) throw new Error(`login failed: ${response.status()} ${await response.text()}`);
}

async function firstWeeklyPlanPath(page) {
  if (process.env.CAT6_DOCUMENT_PATH) return process.env.CAT6_DOCUMENT_PATH;

  const bootstrap = await page.evaluate(async () => {
    const response = await fetch('/api/bootstrap', { credentials: 'include' });
    if (!response.ok) throw new Error(`bootstrap failed: ${response.status}`);
    return response.json();
  });

  const documents = bootstrap.data?.documents ?? bootstrap.documents;
  const document = documents?.find((doc) => doc.document_type === 'weekly_plan');
  if (document) return `/documents/${document.id}`;

  throw new Error('No weekly_plan document found in bootstrap data. Seed the local database or set CAT6_DOCUMENT_PATH=/documents/<id>.');
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  try {
    await login(context);
    const documentPath = process.env.CAT6_DOCUMENT_PATH
      ? process.env.CAT6_DOCUMENT_PATH
      : await (async () => {
          await page.goto(`${baseUrl}/docs`, { waitUntil: 'domcontentloaded' });
          return firstWeeklyPlanPath(page);
        })();

    await page.route('**/api/ai/status', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: false, error: 'ai_unavailable' }),
      });
    });
    await page.route('**/api/ai/analyze-plan', (route) => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'ai_unavailable' }),
      });
    });

    await page.goto(`${baseUrl}${documentPath}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('AI unavailable', { exact: true }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    await page.locator('.ProseMirror').waitFor({ state: 'visible', timeout: 10_000 });

    const screenshotPath = resolve(outDir, 'cat6-ai-unavailable-degraded-ui.png');
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });

    console.log(
      JSON.stringify(
        {
          documentPath,
          screenshot: 'test-results/category-6-ai-unavailable/cat6-ai-unavailable-degraded-ui.png',
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
