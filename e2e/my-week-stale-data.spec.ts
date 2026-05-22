import { test, expect } from './fixtures/isolated-env'
import type { Page } from '@playwright/test'

/**
 * Tests that /my-week reflects plan/retro edits after navigating back.
 *
 * Bug: The my-week query had a 5-minute staleTime and content edits go through
 * Yjs WebSocket (no client-side mutation), so navigating back showed stale data.
 * Fix: staleTime set to 0 so every mount refetches fresh data from the API.
 *
 */

async function waitForMyWeekApiText(page: Page, text: string) {
  await expect.poll(async () => {
    const response = await page.request.get('/api/dashboard/my-week')
    if (!response.ok()) return false

    const body = await response.json()
    return JSON.stringify(body).includes(text)
  }, {
    timeout: 15000,
    intervals: [500, 1000, 1500],
  }).toBe(true)
}

async function navigateToDashboardAndWaitForMyWeek(page: Page) {
  const myWeekResponse = page.waitForResponse(response =>
    response.url().includes('/api/dashboard/my-week') && response.status() === 200
  )
  await page.getByRole('button', { name: 'Dashboard' }).click()
  await myWeekResponse
}

test.describe('My Week - stale data after editing plan/retro', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
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
    await waitForMyWeekApiText(page, 'Ship the new dashboard feature')

    // 7. Navigate back to /my-week using client-side navigation (Dashboard icon in rail)
    await navigateToDashboardAndWaitForMyWeek(page)
    await expect(page.getByRole('heading', { name: /^Week \d+$/ })).toBeVisible({ timeout: 10000 })

    // 8. Verify the plan content is visible on the my-week page
    // The my-week API reads from the `content` column which is updated by the
    // collaboration server's persistence layer (async from WebSocket edits)
    await expect(page.getByText('Ship the new dashboard feature')).toBeVisible({ timeout: 15000 })
  })

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

    // 6. Wait for the collaboration server to persist the content
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 10000 })
    await waitForMyWeekApiText(page, 'Completed the API refactoring')

    // 7. Navigate back to /my-week using client-side navigation
    await navigateToDashboardAndWaitForMyWeek(page)
    await expect(page.getByRole('heading', { name: /^Week \d+$/ })).toBeVisible({ timeout: 10000 })

    // 8. Verify the retro content is visible on the my-week page
    await expect(page.getByText('Completed the API refactoring')).toBeVisible({ timeout: 15000 })
  })
})
