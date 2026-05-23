import { test, expect } from './fixtures/isolated-env';

// Force serial execution — tests in this file mutate shared state (accept/reject triage issues)
// which causes flakiness when fullyParallel allows describe blocks to interleave
test.describe.configure({ mode: 'serial' });

/**
 * Feedback Consolidation Tests
 *
 * Tests for consolidating feedback into the Issues system with:
 * - New 'triage' state for external submissions
 * - Source column/badge in Issues list
 * - 'Needs Triage' filter
 * - Accept/Reject triage actions
 * - Migration of existing feedback data
 */

// Helper to login
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#email').fill('dev@ship.local');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL('/login', { timeout: 10000 });
}

// Helper to get CSRF token for API requests
async function getCsrfToken(page: import('@playwright/test').Page, apiUrl: string): Promise<string> {
  const response = await page.request.get(`${apiUrl}/api/csrf-token`);
  const { token } = await response.json();
  return token;
}

// Helper to get a program ID (programs use onClick navigation with table rows)
async function getProgramId(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/programs');
  await expect(page.locator('h1', { hasText: 'Programs' })).toBeVisible({ timeout: 10000 });

  // Click on the Ship Core program row in the table
  const programRow = page.locator('tr[role="row"]', { hasText: /ship core/i }).first();
  await programRow.click();
  await page.waitForURL(/\/documents\/[a-f0-9-]+/i, { timeout: 10000 });

  // Extract program ID from URL
  const url = page.url();
  const programId = url.split('/documents/')[1]?.split(/[?#/]/)[0];
  if (!programId) throw new Error('Could not extract program ID from URL');
  return programId;
}

test.describe('Issues List: Source Display', () => {
  test('source column/badge shows "External" for external issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Wait for issues table to load before interacting with filters
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });

    // Click "Needs Triage" filter to show triage issues (external issues are seeded as state=triage)
    const triageTab = page.getByRole('tab', { name: /needs triage/i });
    await expect(triageTab).toBeVisible({ timeout: 10000 });
    await triageTab.click();

    // Find an external issue (seeded: 'External feature request from user')
    const externalIssue = page.locator('tr[role="row"]', { hasText: 'External feature request' });
    await expect(externalIssue).toBeVisible({ timeout: 15000 });

    // Verify External badge is visible (using span to target badge, not title text)
    await expect(externalIssue.locator('span:text-is("External")')).toBeVisible();
  });

});

test.describe('Issues List: Needs Triage Filter', () => {
  test('Needs Triage filter tab is present', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // The Needs Triage filter tab should be visible
    const triageFilter = page.getByRole('tab', { name: /needs triage/i });
    await expect(triageFilter).toBeVisible();

    // Tab should have the text "Needs Triage"
    await expect(triageFilter).toHaveText(/needs triage/i);
  });

});

test.describe('Public Feedback Form', () => {
  test('public form accessible without login', async ({ page }) => {
    // First need to get a program ID
    await login(page);
    const programId = await getProgramId(page);

    // Navigate away from protected page before clearing cookies to avoid auth redirect race
    await page.goto('about:blank');
    await page.context().clearCookies();

    // Navigate to public feedback form (Ship Core seed has public_feedback_enabled)
    await page.goto(`/feedback/${programId}`);

    // Should show form, not login redirect or "Program not found"
    await expect(page.getByRole('heading', { name: 'Submit Feedback' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Title')).toBeVisible();
  });

  test('submitting creates issue with source=external, state=triage', async ({ page }) => {
    // Get a program ID while logged in
    await login(page);
    const programId = await getProgramId(page);

    // Navigate away from protected page before clearing cookies to avoid auth redirect race
    await page.goto('about:blank');
    await page.context().clearCookies();
    await page.goto(`/feedback/${programId}`);

    const uniqueTitle = `Feedback test ${Date.now()}`;
    await page.locator('input[name="title"], input[placeholder*="title" i]').first().fill(uniqueTitle);
    await page.locator('input[name="submitter_email"], input[type="email"]').first().fill('feedback@test.com');
    await page.getByRole('button', { name: /submit/i }).click();

    // Wait for confirmation
    await expect(page.getByText(/thank/i)).toBeVisible({ timeout: 10000 });

    // Log back in and verify
    await login(page);

    // Clear IndexedDB to force fresh data fetch on next page load
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const req1 = indexedDB.deleteDatabase('ship-query-cache');
        const req2 = indexedDB.deleteDatabase('ship-mutation-queue');
        let completed = 0;
        const checkDone = () => { if (++completed >= 2) resolve(); };
        req1.onsuccess = req1.onerror = checkDone;
        req2.onsuccess = req2.onerror = checkDone;
        setTimeout(resolve, 3000);
      });
    });

    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Wait for issues list to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Apply triage filter to find it
    await page.getByRole('tab', { name: /needs triage/i }).click();

    // Wait for filtered results
    await page.waitForTimeout(500);

    const newIssue = page.locator('tr[role="row"]', { hasText: uniqueTitle });
    await expect(newIssue).toBeVisible({ timeout: 10000 });
    await expect(newIssue.locator('span:text-is("External")')).toBeVisible();
  });

  test('shows confirmation message after submission', async ({ page }) => {
    await login(page);
    const programId = await getProgramId(page);

    // Navigate away from protected page before clearing cookies to avoid auth redirect race
    await page.goto('about:blank');
    await page.context().clearCookies();
    await page.goto(`/feedback/${programId}`);

    await page.locator('input[name="title"], input[placeholder*="title" i]').first().fill('Confirmation test');
    await page.locator('input[name="submitter_email"], input[type="email"]').first().fill('confirm@test.com');
    await page.getByRole('button', { name: /submit/i }).click();

    // Should show thank you message
    await expect(page.getByText(/thank/i)).toBeVisible({ timeout: 10000 });
  });

  test('does not show tracking link or status updates', async ({ page }) => {
    await login(page);
    const programId = await getProgramId(page);

    // Navigate away from protected page before clearing cookies to avoid auth redirect race
    await page.goto('about:blank');
    await page.context().clearCookies();
    await page.goto(`/feedback/${programId}`);

    await page.locator('input[name="title"], input[placeholder*="title" i]').first().fill('No tracking test');
    await page.locator('input[name="submitter_email"], input[type="email"]').first().fill('notrack@test.com');
    await page.getByRole('button', { name: /submit/i }).click();

    await expect(page.getByText(/thank/i)).toBeVisible({ timeout: 10000 });

    // Should NOT show any tracking/status links
    await expect(page.locator('text=track')).not.toBeVisible();
    await expect(page.locator('text=status')).not.toBeVisible();
    await expect(page.locator('a[href*="issues"]')).not.toBeVisible();
  });
});

test.describe('Program View: Feedback Tab Removed', () => {
  test('Feedback tab does not appear in Program tabs', async ({ page }) => {
    await login(page);
    // Navigate to a program using the helper
    await getProgramId(page);

    // Wait for program editor to load (use specific tablist to avoid matching nav)
    await expect(page.getByRole('tablist', { name: 'Content tabs' })).toBeVisible({ timeout: 10000 });

    // Should have Overview, Issues, Projects, Weeks tabs
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /issues/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /weeks/i })).toBeVisible();

    // Should NOT have Feedback tab
    await expect(page.getByRole('tab', { name: /feedback/i })).not.toBeVisible();
  });

  test('Issues tab shows all issues including external ones', async ({ page }) => {
    await login(page);
    // Navigate to Ship Core program using the helper
    await getProgramId(page);

    // Click Issues tab
    await page.getByRole('tab', { name: /issues/i }).click();

    // Wait for issues table to load (lazy-loaded tab + API fetch can be slow under load)
    const tableRows = page.locator('table tbody tr');
    await expect(tableRows.first()).toBeVisible({ timeout: 15000 });

    // Verify issues exist in seed data (implicitly confirms "No issues found" is not showing)
    const issueCount = await tableRows.count();
    expect(issueCount, 'Seed data should provide issues for Ship Core program').toBeGreaterThan(0);
  });
});

test.describe('Data Migration', () => {
  // Note: These tests verify seeded data which represents post-migration state

  test('existing feedback with status=submitted migrates to state=triage', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Wait for table data to load before interacting with filters
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });

    // Filter to triage
    const triageTab = page.getByRole('tab', { name: /needs triage/i });
    await expect(triageTab).toBeVisible({ timeout: 10000 });
    await triageTab.click();

    // External issues in triage exist (represents migrated submitted feedback)
    // Use tbody to skip header row — wait for filtered results to appear
    const triageIssues = page.locator('tbody tr[role="row"]');
    await expect(triageIssues.first()).toBeVisible({ timeout: 10000 });

    const count = await triageIssues.count();
    expect(count).toBeGreaterThan(0);

    // Verify at least one external issue exists in triage (migrated feedback)
    await expect(triageIssues.first().locator('span:text-is("External")')).toBeVisible({ timeout: 5000 });
  });

  test('existing feedback with rejection_reason migrates to state=cancelled', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Wait for initial table to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Filter to cancelled
    await page.getByRole('tab', { name: /cancelled/i }).click();

    // Wait for filter to apply and table to re-render
    await page.waitForTimeout(500);

    // 'Rejected spam submission' should be here
    const rejectedExternal = page.locator('tr[role="row"]', { hasText: 'Rejected spam submission' });
    await expect(rejectedExternal).toBeVisible({ timeout: 10000 });
    await expect(rejectedExternal.locator('span:text-is("External")')).toBeVisible();
  });

  test('migrated feedback retains source=external (from source=feedback)', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Wait for table data to fully load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });

    // All external issues should show "External" not "feedback"
    await expect(page.locator('span:text-is("External")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('span:text-is("feedback")')).not.toBeVisible();
  });

  test('existing issues retain source=internal', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Wait for issue table data to fully load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // Internal issues should show "Internal"
    const internalIssue = page.locator('tr[role="row"]', { hasText: 'Initial project setup' });
    await expect(internalIssue).toBeVisible({ timeout: 15000 });
    await expect(internalIssue.locator('span:text-is("Internal")')).toBeVisible();
  });
});

test.describe('API Changes', () => {
  test('GET /api/issues returns both internal and external issues', async ({ page, apiServer }) => {
    await login(page);

    // Make API call
    const response = await page.request.get(`${apiServer.url}/api/issues`);
    expect(response.ok()).toBeTruthy();

    const issues = await response.json();
    expect(Array.isArray(issues)).toBeTruthy();

    // Should have both internal and external
    const sources = issues.map((i: { source?: string }) => i.source);
    expect(sources).toContain('internal');
    expect(sources).toContain('external');
  });

  test('GET /api/issues?state=triage returns only triage items', async ({ page, apiServer }) => {
    await login(page);

    const response = await page.request.get(`${apiServer.url}/api/issues?state=triage`);
    expect(response.ok()).toBeTruthy();

    const issues = await response.json();
    expect(Array.isArray(issues)).toBeTruthy();
    expect(issues.length).toBeGreaterThan(0);

    // All should be in triage state
    for (const issue of issues) {
      expect(issue.state).toBe('triage');
    }
  });

  test('GET /api/issues?source=external returns only external items', async ({ page, apiServer }) => {
    await login(page);

    const response = await page.request.get(`${apiServer.url}/api/issues?source=external`);
    expect(response.ok()).toBeTruthy();

    const issues = await response.json();
    expect(Array.isArray(issues)).toBeTruthy();
    expect(issues.length).toBeGreaterThan(0);

    // All should be external
    for (const issue of issues) {
      expect(issue.source).toBe('external');
    }
  });

  test('POST /api/feedback creates issue with state=triage, source=external', async ({ page, apiServer }) => {
    // First get a program ID
    await login(page);
    const programId = await getProgramId(page);

    // Submit feedback via API (no auth needed for public feedback)
    const response = await page.request.post(`${apiServer.url}/api/feedback`, {
      data: {
        title: 'API feedback test',
        submitter_email: 'api@test.com',
        program_id: programId,
      },
    });
    expect(response.ok()).toBeTruthy();

    const created = await response.json();
    expect(created.state).toBe('triage');
    expect(created.source).toBe('external');
  });

  test('POST /api/issues/:id/accept moves to backlog', async ({ page, apiServer }) => {
    await login(page);

    // Get CSRF token
    const csrfToken = await getCsrfToken(page, apiServer.url);

    // First find a triage issue
    const listResponse = await page.request.get(`${apiServer.url}/api/issues?state=triage`);
    const triageIssues = await listResponse.json();
    expect(triageIssues.length).toBeGreaterThan(0);

    const issueId = triageIssues[0].id;

    // Accept it with CSRF token
    const acceptResponse = await page.request.post(`${apiServer.url}/api/issues/${issueId}/accept`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });
    expect(acceptResponse.ok()).toBeTruthy();

    const updated = await acceptResponse.json();
    expect(updated.state).toBe('backlog');
  });

  test('POST /api/issues/:id/reject moves to cancelled with reason', async ({ page, apiServer }) => {
    await login(page);

    // Get CSRF token
    const csrfToken = await getCsrfToken(page, apiServer.url);

    // First create a new triage issue to reject
    const programId = await getProgramId(page);

    // Create via feedback API (public, no CSRF needed)
    const createResponse = await page.request.post(`${apiServer.url}/api/feedback`, {
      data: {
        title: 'To be rejected',
        submitter_email: 'reject@test.com',
        program_id: programId,
      },
    });
    const created = await createResponse.json();
    const issueId = created.id;

    // Reject it with CSRF token
    const rejectResponse = await page.request.post(`${apiServer.url}/api/issues/${issueId}/reject`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        reason: 'Test rejection reason',
      },
    });
    expect(rejectResponse.ok()).toBeTruthy();

    const updated = await rejectResponse.json();
    expect(updated.state).toBe('cancelled');
    expect(updated.rejection_reason).toBe('Test rejection reason');
  });
});
