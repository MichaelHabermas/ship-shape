/** E2E tests that /my-week refetches plan and retro edits after navigation. */
import { test, expect } from './fixtures/isolated-env'
import { readJsonAs } from './fixtures/typed-json'
import type { Page } from '@playwright/test'

/**
 * Tests that /my-week reflects plan/retro edits after navigating back.
 *
 * Bug: The my-week query had a 5-minute staleTime and content edits go through
 * Yjs WebSocket (no client-side mutation), so navigating back showed stale data.
 * Fix: staleTime set to 0 so every mount refetches fresh data from the API.
 *
 */

test.describe.configure({ mode: 'serial' })

async function waitForDocumentContentInApi(page: Page, text: string) {
  const docId = page.url().match(/\/documents\/([a-f0-9-]+)/i)?.[1]
  expect(docId, 'Editor URL should include document id').toBeTruthy()

  await expect.poll(async () => {
    const response = await page.request.get(`/api/documents/${docId}/content`)
    if (!response.ok()) return false
    const body = await readJsonAs<unknown>(response)
    return JSON.stringify(body).includes(text)
  }, {
    timeout: 30000,
    intervals: [500, 1000, 2000],
  }).toBe(true)
}

async function navigateToDashboardAndWaitForMyWeek(page: Page, expectedText: string) {
  await page.getByRole('button', { name: 'Dashboard' }).click()
  await expect(page.getByRole('heading', { name: /^Week \d+$/ })).toBeVisible({ timeout: 10000 })

  // Wait for aggregated my-week payload (initial fetch can race collab persistence).
  await expect.poll(async () => {
    const response = await page.request.get('/api/dashboard/my-week')
    if (!response.ok()) return false
    const body = await readJsonAs<unknown>(response)
    return JSON.stringify(body).includes(expectedText)
  }, {
    timeout: 30000,
    intervals: [500, 1000, 2000],
  }).toBe(true)
}

test.describe('My Week - stale data after editing plan/retro', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  // Run retro before plan: creating a retro when a plan already exists seeds planReference
  // blocks instead of plain listItems, so extractPlanItems (my-week API) won't see free-typed text.
  test('retro edits are visible on /my-week after navigating back', async ({ page }) => {
    // 1. Navigate to /my-week
    await page.goto('/my-week')
    await expect(page.getByRole('heading', { name: /^Week \d+$/ })).toBeVisible({ timeout: 10000 })

    // 2. Create a retro (click the main create button, not the nudge link)
    await page.getByRole('button', { name: /create retro for this week/i }).click()

    // 3. Should navigate to the document editor
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

    // 4. Wait for the TipTap editor to be ready
    const editor = page.locator('.tiptap')
    await expect(editor).toBeVisible({ timeout: 10000 })

    // 5. Type a list item into the editor
    await editor.click()
    await page.keyboard.type('1. Completed the API refactoring')

    // 6. Wait for the collaboration server to persist the content.
    // The status may show Cached when IndexedDB has the latest local state; the API is the durable signal.
    await waitForDocumentContentInApi(page, 'Completed the API refactoring')

    // 7. Navigate back to /my-week using client-side navigation
    await navigateToDashboardAndWaitForMyWeek(page, 'Completed the API refactoring')

    // 8. Verify the retro content is visible on the my-week page
    await expect(page.getByText('Completed the API refactoring')).toBeVisible({ timeout: 15000 })
  })

  test('plan edits are visible on /my-week after navigating back', async ({ page }) => {
    // 1. Navigate to /my-week
    await page.goto('/my-week')
    await expect(page.getByRole('heading', { name: /^Week \d+$/ })).toBeVisible({ timeout: 10000 })

    // 2. Create a plan (click the create button)
    await page.getByRole('button', { name: /create plan for this week/i }).click()

    // 3. Should navigate to the document editor
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

    // 4. Wait for the TipTap editor to be ready
    const editor = page.locator('.tiptap')
    await expect(editor).toBeVisible({ timeout: 10000 })

    // 5. Type a list item into the editor
    // Use "1. " prefix to create a numbered list (orderedList with listItem nodes)
    await editor.click()
    await page.keyboard.type('1. Ship the new dashboard feature')

    // 6. Wait for the collaboration server to persist content visible to /my-week
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 10000 })
    // Collaboration debounces yjs→content DB writes by 2s (api/src/collaboration/index.ts).
    await page.waitForTimeout(2500)
    await waitForDocumentContentInApi(page, 'Ship the new dashboard feature')

    // 7. Navigate back to /my-week using client-side navigation (Dashboard icon in rail)
    await navigateToDashboardAndWaitForMyWeek(page, 'Ship the new dashboard feature')

    // 8. Verify the plan content is visible on the my-week page
    await expect(page.getByText('Ship the new dashboard feature')).toBeVisible({ timeout: 15000 })
  })
})
