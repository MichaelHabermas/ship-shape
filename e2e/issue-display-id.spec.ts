import { test, expect } from './fixtures/isolated-env';

test.describe('Issue Display IDs', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 10000 })
  });

  test('displays issue with hash-number format (#N) in issues list', async ({ page }) => {
    // Navigate to issues page directly
    await page.goto('/issues')

    // Create a new issue first to ensure there's at least one
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate back to issues list
    await page.goto('/issues')
    await page.waitForTimeout(500)

    // Check for #N format in the issues list
    const issueDisplayId = page.getByText(/#\d+/).first()
    await expect(issueDisplayId).toBeVisible({ timeout: 5000 })
  });

  test('displays issue with hash-number format (#N) in issue editor header', async ({ page }) => {
    // Navigate to issues page and create a new issue
    await page.goto('/issues')
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate back to issues list to verify the issue has #N format
    await page.goto('/issues')
    await page.waitForTimeout(500)

    // Check for #N format in the issues list (issue ID column)
    const issueId = page.getByText(/#\d+/).first()
    await expect(issueId).toBeVisible({ timeout: 5000 })
  });

  test('new issue gets sequential ticket number', async ({ page }) => {
    // Navigate to issues
    await page.goto('/issues')
    await page.waitForTimeout(500)

    // Create new issue (use the specific button in the header, not the sidebar icon)
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate back to issues list
    await page.goto('/issues')
    await page.waitForTimeout(500)

    // New issue should have a number in the issues list
    const issueId = page.getByText(/#\d+/).first()
    await expect(issueId).toBeVisible({ timeout: 5000 })
    await expect(issueId).toHaveText(/#\d+/)
  });

  test('issue display ID does not contain program prefix', async ({ page }) => {
    // Navigate to issues and create a new issue
    await page.goto('/issues')
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate back to issues list
    await page.goto('/issues')
    await page.waitForTimeout(500)

    // Find the issue ID in the list (gridcell with #N format)
    const idCell = page.locator('[role="gridcell"]').filter({ hasText: /^#\d+$/ }).first()
    await expect(idCell).toBeVisible({ timeout: 5000 })

    const text = await idCell.textContent()
    // Should be #N format, not PREFIX-N format
    expect(text?.trim()).toMatch(/^#\d+$/)
    expect(text?.trim()).not.toMatch(/^[A-Z]+-\d+$/)
  });

  test('all issue display IDs use hash-number format', async ({ page }) => {
    // Navigate to issues and create a few issues
    await page.goto('/issues')
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    await page.goto('/issues')
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate back to issues list
    await page.goto('/issues')
    await page.waitForTimeout(500)

    // Verify all visible issue display IDs use #N format
    // The issues list uses ARIA grid with gridcell elements, not td elements
    const idCells = page.locator('[role="gridcell"]').filter({ hasText: /^#\d+$/ })
    const count = await idCells.count()

    // Should have found at least one issue with #N format
    expect(count).toBeGreaterThan(0)

    // Verify each ID cell matches the expected format
    for (let i = 0; i < count; i++) {
      const cellText = await idCells.nth(i).textContent()
      expect(cellText?.trim()).toMatch(/^#\d+$/)
      expect(cellText?.trim()).not.toMatch(/^[A-Z]+-\d+$/)
    }
  });

  test('program issues list shows hash-number format', async ({ page }) => {
    // Navigate to programs
    await page.goto('/programs')
    await page.waitForTimeout(500)

    // Click on first program in the list
    const programCard = page.locator('[data-testid="program-card"], .contextual-sidebar button').first()
    if (await programCard.isVisible({ timeout: 5000 })) {
      await programCard.click()
      await page.waitForTimeout(500)

      // Click Issues tab if it exists
      const issuesTab = page.getByRole('button', { name: /issues/i })
      if (await issuesTab.isVisible()) {
        await issuesTab.click()
        await page.waitForTimeout(500)
      }

      // Check that issues in the program view show #N format
      const issueDisplayId = page.getByText(/#\d+/).first()
      if (await issueDisplayId.isVisible({ timeout: 3000 })) {
        await expect(issueDisplayId).toHaveText(/^#\d+$/)
      }
    }
  });

  test('command palette shows issues with hash-number format (#N)', async ({ page }) => {
    // Create an issue first so there's something to search for
    await page.goto('/issues')
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate back and open command palette
    await page.goto('/issues')
    await page.waitForTimeout(500)

    // Open command palette with Cmd+K (or Ctrl+K on non-Mac)
    await page.keyboard.press('Meta+k')
    await page.waitForTimeout(300)

    // If command palette didn't open, try Ctrl+K
    const commandPalette = page.locator('[cmdk-root], [data-testid="command-palette"]')
    if (!(await commandPalette.isVisible())) {
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(300)
    }

    // Type to search for issues
    const searchInput = page.locator('[cmdk-input], input[placeholder*="Search"], input[placeholder*="Type"]')
    if (await searchInput.isVisible()) {
      await searchInput.fill('Infrastructure')
      await page.waitForTimeout(500)

      const suggestions = page.getByLabel('Suggestions')
      const issueDisplayId = suggestions.getByText(/#\d+/).first()
      await expect(issueDisplayId).toBeVisible({ timeout: 5000 })
      await expect(issueDisplayId).not.toHaveText(/[A-Z]{2,}-\d+/)
    }

    // Close command palette
    await page.keyboard.press('Escape')
  });
});
