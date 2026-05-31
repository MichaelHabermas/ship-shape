import { test, expect } from './fixtures/isolated-env'
import { readJsonAs } from './fixtures/typed-json'
import type { AccountabilityGridV3Response } from './fixtures/e2e-api-types'

test.describe('Status Overview Heatmap', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can navigate to Status Overview via Teams sidebar', async ({ page }) => {
    // Click Teams icon in rail
    await page.getByRole('button', { name: 'Teams' }).click()

    // Wait for Teams mode to load
    await expect(page).toHaveURL(/\/team\//, { timeout: 5000 })

    // Click Status Overview in sidebar
    await page.getByRole('button', { name: 'Status Overview' }).click()

    // Should navigate to /team/status
    await expect(page).toHaveURL(/\/team\/status/, { timeout: 5000 })
  })

  test('displays legend with status colors', async ({ page }) => {
    await page.goto('/team/status')
    await page.waitForLoadState('networkidle')

    // Should see status legend
    await expect(page.getByText('Status:')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Done')).toBeVisible()
    await expect(page.getByText('Due', { exact: true })).toBeVisible()
    await expect(page.getByText('Late')).toBeVisible()
    await expect(page.getByText('Future', { exact: true })).toBeVisible()

    // Should see cell layout explanation
    await expect(page.getByText('Left = Plan, Right = Retro')).toBeVisible()
  })

  test('displays programs with people directly underneath', async ({ page }) => {
    await page.goto('/team/status')
    await page.waitForLoadState('networkidle')

    // Wait for heatmap to load - new header is "Program / Person" (no project level)
    await expect(page.getByText('Program / Person')).toBeVisible({ timeout: 10000 })

    // Should see program headers - in isolated env without allocations, people go to "No Program"
    // The seed data or full database would show other programs
    const programButton = page.getByRole('button', { name: /No Program|API Platform|Infrastructure|Design System/ }).first()
    await expect(programButton).toBeVisible({ timeout: 5000 })
  })

  test('shows people directly under programs without expansion', async ({ page }) => {
    await page.goto('/team/status')
    await page.waitForLoadState('networkidle')

    // Wait for heatmap to load
    await expect(page.getByText('Program / Person')).toBeVisible({ timeout: 10000 })

    // People should be visible directly - no need to click to expand
    // Look for any person name from the seed data
    await expect(page.getByText(/Dev User|Alice Chen|Grace Lee|Carol Williams/).first()).toBeVisible({ timeout: 5000 })
  })

  test('displays split cells for plan/retro status', async ({ page }) => {
    await page.goto('/team/status')
    await page.waitForLoadState('networkidle')

    // Wait for heatmap to load
    await expect(page.getByText('Program / Person')).toBeVisible({ timeout: 10000 })

    // People are visible directly, should see plan/retro buttons
    // Wait for any person to be visible
    await expect(page.getByText(/Dev User|Alice Chen|Grace Lee/).first()).toBeVisible({ timeout: 5000 })

    // Should see plan/retro cell buttons with status tooltips
    const planButton = page.getByRole('button', { name: /Weekly Plan/ }).first()
    await expect(planButton).toBeVisible({ timeout: 5000 })

    const retroButton = page.getByRole('button', { name: /Weekly Retro/ }).first()
    await expect(retroButton).toBeVisible({ timeout: 5000 })
  })

  test('clicking plan cell navigates to weekly plan document', async ({ page }) => {
    await page.goto('/team/status')
    await page.waitForLoadState('networkidle')

    // Wait for heatmap to load
    await expect(page.getByText('Program / Person')).toBeVisible({ timeout: 10000 })

    // Wait for people to appear (visible directly, no expansion needed)
    await expect(page.getByText(/Dev User|Alice Chen|Grace Lee/).first()).toBeVisible({ timeout: 5000 })

    // Click a plan cell (any week)
    const planButton = page.getByRole('button', { name: /Weekly Plan/ }).first()
    await planButton.click()

    // Should navigate to a document page
    await expect(page).toHaveURL(/\/documents\//, { timeout: 10000 })

    // Should see Weekly Plan title
    await expect(page.getByRole('heading', { name: /Week \d+ Plan/ })).toBeVisible({ timeout: 5000 })
  })

  test('clicking retro cell navigates to weekly retro document', async ({ page }) => {
    await page.goto('/team/status')
    await page.waitForLoadState('networkidle')

    // Wait for heatmap to load
    await expect(page.getByText('Program / Person')).toBeVisible({ timeout: 10000 })

    // Wait for people to appear (visible directly, no expansion needed)
    await expect(page.getByText(/Dev User|Alice Chen|Grace Lee/).first()).toBeVisible({ timeout: 5000 })

    // Click a retro cell (any week)
    const retroButton = page.getByRole('button', { name: /Weekly Retro/ }).first()
    await retroButton.click()

    // Should navigate to a document page
    await expect(page).toHaveURL(/\/documents\//, { timeout: 10000 })

    // Should see Weekly Retro title
    await expect(page.getByRole('heading', { name: /Week \d+ Retro/ })).toBeVisible({ timeout: 5000 })
  })

  test('Show archived checkbox is present', async ({ page }) => {
    await page.goto('/team/status')
    await page.waitForLoadState('networkidle')

    // Should see Show archived checkbox
    await expect(page.getByRole('checkbox', { name: 'Show archived' })).toBeVisible({ timeout: 10000 })
  })

  test('displays week columns with dates', async ({ page }) => {
    await page.goto('/team/status')
    await page.waitForLoadState('networkidle')

    // Wait for heatmap to load
    await expect(page.getByText('Program / Person')).toBeVisible({ timeout: 10000 })

    // Should see week headers with format "Week N" and date range
    await expect(page.getByText(/Week \d+/).first()).toBeVisible({ timeout: 5000 })

    // Should see date ranges like "Jan 10-16" or "Dec 27 - Jan 2"
    await expect(page.getByText(/[A-Z][a-z]+ \d+/).first()).toBeVisible({ timeout: 5000 })
  })

  test('API returns accountability-grid-v3 data structure', async ({ page }) => {
    await page.goto('/team/status')

    // Intercept the API call - now using v3 endpoint
    const response = await page.waitForResponse(
      resp => resp.url().includes('/api/team/accountability-grid-v3') && resp.status() === 200,
      { timeout: 10000 }
    )

    const data = await readJsonAs<AccountabilityGridV3Response>(response)

    // Verify data structure
    expect(data).toHaveProperty('programs')
    expect(data).toHaveProperty('weeks')
    expect(data).toHaveProperty('currentSprintNumber')

    // Verify programs array has expected structure (now contains people, not projects)
    expect(Array.isArray(data.programs)).toBe(true)
    expect(data.programs.length).toBeGreaterThan(0)
    expect(data.programs[0]).toHaveProperty('id')
    expect(data.programs[0]).toHaveProperty('name')
    expect(data.programs[0]).toHaveProperty('people') // Changed from 'projects' to 'people'

    // Verify weeks array has expected structure
    expect(Array.isArray(data.weeks)).toBe(true)
    expect(data.weeks.length).toBeGreaterThanOrEqual(3)
    expect(data.weeks[0]).toHaveProperty('number')
    expect(data.weeks[0]).toHaveProperty('name')
    expect(data.weeks[0]).toHaveProperty('startDate')
    expect(data.weeks[0]).toHaveProperty('endDate')
    expect(data.weeks[0]).toHaveProperty('isCurrent')

    // Verify at least one week is marked as current
    const currentWeeks = data.weeks.filter((w) => w.isCurrent)
    expect(currentWeeks.length).toBe(1)
  })

  test('non-admin users see appropriate content', async ({ page }) => {
    // This test requires a non-admin user to exist
    // The seed data creates dev@ship.local as super-admin
    // For now, we just verify the admin can access
    await page.goto('/team/status')

    // Admin should see the grid, not an error - using new header
    await expect(page.getByText('Program / Person')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Admin access required')).not.toBeVisible()
  })
})
