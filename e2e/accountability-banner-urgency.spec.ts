import { test, expect } from './fixtures/isolated-env';
import { login } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type { ActionItemsResponse } from './fixtures/e2e-api-types';


/**
 * E2E tests for accountability banner urgency colors.
 *
 * Tests that the banner shows:
 * - red (bg-red-600) when any overdue items exist
 * - response includes has_overdue and has_due_today flags
 * - clicking the banner opens the ActionItemsModal
 * - days_overdue values are correctly computed
 */

test.describe('Accountability Banner Urgency', () => {
  test('API response includes has_overdue and has_due_today flags', async ({ page, apiServer }) => {
    await login(page);

    // The seed data creates sprints 3 months ago - items will be overdue
    const response = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(response.ok()).toBe(true);
    const data = await readJsonAs<ActionItemsResponse>(response);

    // Verify the response shape includes urgency flags
    expect(data).toHaveProperty('has_overdue');
    expect(data).toHaveProperty('has_due_today');
    expect(typeof data.has_overdue).toBe('boolean');
    expect(typeof data.has_due_today).toBe('boolean');
  });

  test('banner is red when overdue items exist', async ({ page, apiServer }) => {
    await login(page);

    // Seed data has sprints from 3 months ago - items will be overdue
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await readJsonAs<ActionItemsResponse>(actionItemsResponse);

    // Verify we actually have overdue items from seed data
    expect(actionItems.items.length).toBeGreaterThan(0);
    expect(actionItems.has_overdue).toBe(true);

    // Navigate to app - banner should render with red background
    await page.goto('/');
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // Wait for the banner to appear - look for a button with red background
    const banner = page.locator('button.bg-red-600');
    await expect(banner).toBeVisible({ timeout: 10000 });

    // Verify the badge also has the matching red color
    const badge = banner.locator('.bg-red-800');
    await expect(badge).toBeVisible();
  });

  test('urgency flags correctly reflect item days_overdue values', async ({ page, apiServer }) => {
    await login(page);

    const response = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(response.ok()).toBe(true);
    const data = await readJsonAs<ActionItemsResponse>(response);

    // Seed data creates sprints from 3 months ago, so items should be overdue
    expect(data.items.length).toBeGreaterThan(0);

    const overdueItems = data.items.filter((item) => (item.days_overdue ?? 0) > 0);
    const dueTodayItems = data.items.filter((item) => item.days_overdue === 0);

    // Verify has_overdue flag matches actual items
    expect(data.has_overdue).toBe(overdueItems.length > 0);
    // Verify has_due_today flag matches actual items
    expect(data.has_due_today).toBe(dueTodayItems.length > 0);

    // Verify overdue items exist (seed data creates old sprints)
    expect(overdueItems.length).toBeGreaterThan(0);
  });

  test('clicking banner opens the action items modal', async ({ page }) => {
    await login(page);

    // Navigate to app
    await page.goto('/');
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // Wait for the accountability banner to appear
    // The fixture disables auto-open modal, so banner should be clickable
    const banner = page.locator('button.bg-red-600, button.bg-amber-600');
    await expect(banner).toBeVisible({ timeout: 10000 });

    // Click the banner to open the modal
    await banner.click();

    // Modal should open - look for the dialog
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });
});
