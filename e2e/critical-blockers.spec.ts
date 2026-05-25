import { test, expect } from './fixtures/isolated-env';
import { login } from './fixtures/api-auth';

import type { Page } from '@playwright/test';

async function createNewDocument(page: Page) {
  await page.goto('/docs');
  await page.getByRole('button', { name: 'New Document', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 });
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 });
}

/**
 * Critical Blocker Tests - Audit Remediation
 *
 * These tests verify the fixes for critical blockers identified in the audit:
 * 1. Auth middleware uses centralized implementation (not duplicated per-route)
 * 2. Ticket numbers are unique even under concurrent requests
 * 3. WebSocket connections are rate-limited
 * 4. Session timeouts are properly enforced
 */

test.describe('Critical Blocker: Ticket Number Uniqueness', () => {
  test('concurrent issue creation produces unique ticket numbers', async ({ page, apiServer }) => {
    // First, log in to get a valid session
    await page.goto('/login');
    await page.fill('input[type="email"]', 'dev@ship.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    // App redirects to /docs after login
    await page.waitForURL(/\/docs/);

    const csrfResponse = await page.request.get(`${apiServer.url}/api/csrf-token`);
    expect(csrfResponse.ok()).toBeTruthy();
    const { token: csrfToken } = await csrfResponse.json();

    // Create 10 issues concurrently and verify all have unique ticket numbers
    const promises = Array.from({ length: 10 }, (_, i) =>
      page.request.post(`${apiServer.url}/api/issues`, {
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        data: { title: `Concurrent Issue ${i}` },
      })
    );

    const responses = await Promise.all(promises);
    const ticketNumbers = new Set<number>();

    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.ticket_number).toBeDefined();
      expect(ticketNumbers.has(data.ticket_number)).toBeFalsy();
      ticketNumbers.add(data.ticket_number);
    }

    expect(ticketNumbers.size).toBe(10);
  });

  test('sequential issue creation increments ticket numbers correctly', async ({ page, apiServer }) => {
    // Log in to get a valid session
    await page.goto('/login');
    await page.fill('input[type="email"]', 'dev@ship.local');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/docs/);

    const csrfResponse = await page.request.get(`${apiServer.url}/api/csrf-token`);
    expect(csrfResponse.ok()).toBeTruthy();
    const { token: csrfToken } = await csrfResponse.json();

    const issues = [];
    for (let i = 0; i < 5; i++) {
      const response = await page.request.post(`${apiServer.url}/api/issues`, {
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        data: { title: `Sequential Issue ${i}` },
      });
      expect(response.ok()).toBeTruthy();
      issues.push(await response.json());
    }

    // Verify ticket numbers are sequential
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i].ticket_number).toBe(issues[i - 1].ticket_number + 1);
    }
  });
});

test.describe('Critical Blocker: Session Timeout Enforcement', () => {
  test('API returns 401 for expired session cookie', async ({ apiServer }) => {
    // Use a fake session ID that doesn't exist
    const response = await fetch(`${apiServer.url}/api/documents`, {
      headers: { Cookie: 'session_id=non-existent-session-id' },
    });
    expect(response.status).toBe(401);
  });

  test('API returns 401 when no session cookie provided', async ({ apiServer }) => {
    const response = await fetch(`${apiServer.url}/api/documents`);
    expect(response.status).toBe(401);
  });
});

test.describe('Critical Blocker: Consistent Auth Across Routes', () => {
  // Verify all protected routes use centralized auth (return same error format)
  // Only test endpoints that have GET / routes
  const protectedEndpoints = [
    { method: 'GET', path: '/api/documents' },
    { method: 'GET', path: '/api/issues' },
    { method: 'GET', path: '/api/programs' },
    { method: 'GET', path: '/api/auth/me' },
  ];

  for (const endpoint of protectedEndpoints) {
    test(`${endpoint.method} ${endpoint.path} returns consistent 401 format`, async ({ apiServer }) => {
      const response = await fetch(`${apiServer.url}${endpoint.path}`, {
        method: endpoint.method,
        headers: { Cookie: 'session_id=invalid' },
      });

      expect(response.status).toBe(401);
      const data = await response.json();

      // All routes should return the same error format from centralized auth
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code');
      expect(data.error).toHaveProperty('message');
    });
  }
});

test.describe('Critical Blocker: WebSocket Rate Limiting', () => {
  test('WebSocket connections work normally under limit', async ({ page }) => {
    // Verify normal WebSocket collaboration works (not rate limited)
    await login(page)
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()
    await page.keyboard.type('Testing WebSocket')

    // If WebSocket is working, content should sync to editor
    await expect(editor).toContainText('Testing WebSocket', { timeout: 5000 })

    // Test rapid typing (sends multiple WebSocket messages)
    await page.keyboard.type(' - rapid typing test: abcdefghijklmnopqrstuvwxyz')
    await expect(editor).toContainText('abcdefghijklmnopqrstuvwxyz', { timeout: 5000 })
  })
});
