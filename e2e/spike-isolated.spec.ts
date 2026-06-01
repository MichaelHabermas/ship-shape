/**
 * Spike test for isolated environment (Testcontainers Postgres + API + Vite).
 *
 * Run with: npx playwright test --config=playwright.isolated.config.ts
 */

import { test, expect } from './fixtures/isolated-env';
import { readJsonAs } from './fixtures/typed-json';
import type { HealthResponse } from './fixtures/e2e-api-types';

test.describe('Isolated Environment Spike', () => {
  test('login page shows with seeded database (proves isolation + seeding)', async ({ page }) => {
    // With seeded database (has users), the app should show login page
    await page.goto('/');

    // Should redirect to login (may have query params like ?expired=true)
    await expect(page).toHaveURL(/\/login/);

    // Should show login form
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('API health endpoint responds (proves API + DB work)', async ({ request, apiServer }) => {
    // The API health endpoint is at /health (not /api/health)
    // Use apiServer.url directly instead of going through Vite proxy
    const response = await request.get(`${apiServer.url}/health`);

    expect(response.ok()).toBe(true);
    const body = await readJsonAs<HealthResponse>(response);
    expect(body.status).toBe('ok');
  });

  test('API routes work through Vite proxy', async ({ request, baseURL }) => {
    // Try to access documents endpoint through Vite proxy - should get 401
    // This proves: Vite → proxy → API → DB all work
    const response = await request.get(`${baseURL}/api/documents`);

    // 401 means the full chain is working (just needs auth)
    expect(response.status()).toBe(401);
  });

  test('can login with seeded credentials', async ({ page }) => {
    // Go to login page
    await page.goto('/login');

    // Login with seeded credentials
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Should redirect to app after successful login
    await expect(page).not.toHaveURL('/login', { timeout: 10000 });

    // Should see the Documents page (default landing after login)
    await expect(page.locator('h1', { hasText: 'Documents' })).toBeVisible({ timeout: 10000 });
  });
});
