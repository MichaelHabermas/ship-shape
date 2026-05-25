import { test, expect } from './fixtures/isolated-env'
import { login } from './fixtures/api-auth';


test.describe('Icon Tooltips', () => {
  test('rail icons show tooltips on hover', async ({ page }) => {
    await login(page)
    await page.waitForLoadState('networkidle')

    // Find a rail icon button (Docs, Issues, etc.)
    const railIcon = page.locator('button[aria-label="Docs"]').first()
    await expect(railIcon).toBeVisible()

    // Hover over the icon
    await railIcon.hover()

    // Wait for tooltip to appear (Radix tooltips have a delay)
    await page.waitForTimeout(400)

    // Check that tooltip content is visible
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('Docs')
  })

  test('new document button shows tooltip on hover', async ({ page }) => {
    await login(page)
    await page.waitForLoadState('networkidle')

    // Navigate to docs mode
    await page.goto('/docs')
    await page.waitForLoadState('networkidle')

    // Find the new document button
    const newDocButton = page.locator('button[aria-label="New document"]').first()
    await expect(newDocButton).toBeVisible()

    // Hover over the button
    await newDocButton.hover()

    // Wait for tooltip to appear
    await page.waitForTimeout(400)

    // Check that tooltip content is visible
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('New document')
  })

  test('document tree delete button shows tooltip on hover', async ({ page }) => {
    await login(page)
    await page.waitForLoadState('networkidle')

    // Navigate to docs mode
    await page.goto('/docs')
    await page.waitForLoadState('networkidle')

    // Find a document tree item and hover to reveal delete button
    const docItem = page.locator('[data-testid="doc-item"]').first()
    if (await docItem.count() > 0) {
      await docItem.hover()

      // Find and hover over delete button
      const deleteButton = page.locator('[data-testid="delete-document-button"]').first()
      if (await deleteButton.count() > 0) {
        await deleteButton.hover()

        // Wait for tooltip to appear
        await page.waitForTimeout(400)

        // Check that tooltip content is visible
        const tooltip = page.getByRole('tooltip')
        await expect(tooltip).toBeVisible()
        await expect(tooltip).toContainText('Delete')
      }
    }
  })

  test('command palette close button shows tooltip on hover', async ({ page }) => {
    await login(page)
    await page.waitForLoadState('networkidle')

    // Open command palette with keyboard shortcut
    await page.keyboard.press('Meta+k')

    // Wait for command palette to appear
    await page.waitForSelector('[role="dialog"][aria-label="Command palette"]', { timeout: 3000 })

    // Find and hover over close button
    const closeButton = page.locator('[role="dialog"][aria-label="Command palette"] button[aria-label="Close dialog"]')
    await expect(closeButton).toBeVisible()
    await closeButton.hover()

    // Wait for tooltip to appear
    await page.waitForTimeout(400)

    // Check that tooltip content is visible
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('Close')
  })
})
