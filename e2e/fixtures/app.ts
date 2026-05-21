/**
 * Shared Playwright fixtures for authenticated flows and document creation.
 */
import { test as base, expect, Page } from '@playwright/test';

export const E2E_LOGIN_EMAIL = 'dev@ship.local';
export const E2E_LOGIN_PASSWORD = 'admin123';

type AppFixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<AppFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

export { expect };

export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(E2E_LOGIN_EMAIL);
  await page.locator('#password').fill(E2E_LOGIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL('/login', { timeout: 15000 });
}

export async function createWikiDoc(page: Page): Promise<string> {
  await page.goto('/docs');
  await page.getByRole('button', { name: 'New Document', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 15000 });
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10000 });
  return page.url();
}

export async function setDocumentTitle(page: Page, title: string): Promise<void> {
  const titleInput = page.getByPlaceholder('Untitled');
  await expect(titleInput).toBeVisible({ timeout: 10000 });
  await titleInput.fill(title);
  await page.waitForResponse(
    (resp) => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
    { timeout: 10000 }
  );
}

/** Navigate to issues list (global route). */
export async function gotoIssues(page: Page): Promise<void> {
  await page.goto('/issues');
  await expect(page).toHaveURL(/\/issues/, { timeout: 15000 });
}

/** Create or open an issue document for collab/isolation tests (uses first seeded issue when available). */
export async function createIssueDoc(page: Page): Promise<string> {
  const url = await openFirstIssueFromList(page);
  if (url) return url;
  await gotoIssues(page);
  throw new Error('No issue documents in seed data — run pnpm db:seed');
}

/** Open first issue from issues list if present (seed should provide issues). */
export async function openFirstIssueFromList(page: Page): Promise<string | null> {
  await gotoIssues(page);
  const issueLink = page.locator('a[href*="/documents/"]').first();
  if ((await issueLink.count()) === 0) return null;
  await issueLink.click();
  await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 15000 });
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10000 });
  return page.url();
}
