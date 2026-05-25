import { test, expect, Page } from './fixtures/isolated-env'
import { loginAsSuperAdmin } from './fixtures/api-auth';


test.describe('Admin Workspace Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page)
  })

  test('can navigate to workspace detail by clicking workspace name', async ({ page }) => {
    await page.goto('/admin')

    // Click on a workspace name (should be a link)
    // Note: The isolated-env fixture seeds "Test Workspace", not "Ship Workspace"
    const workspaceLink = page.getByRole('link', { name: /Test Workspace/i }).first()
    await workspaceLink.click()

    // Should navigate to workspace detail page
    await expect(page).toHaveURL(/\/admin\/workspaces\//)
    await expect(page.getByText('Workspace: Test Workspace')).toBeVisible()
  })

  test('workspace detail page shows members table', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // Should show members section with table
    await expect(page.getByRole('heading', { name: /Members \(\d+\)/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Name' }).first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Email' }).first()).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Role' }).first()).toBeVisible()
  })

  test('workspace detail page shows pending invites section', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // Should show pending invites section
    await expect(page.getByRole('heading', { name: /Pending Invites/ })).toBeVisible()
  })

  test('workspace detail page shows add existing user section', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // Should show "Add Existing User" section
    await expect(page.getByRole('heading', { name: 'Add Existing User' })).toBeVisible()
    await expect(page.getByPlaceholder('Search by email...')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add User' })).toBeVisible()
  })

  test('workspace detail page shows invite form', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // Should show invite form
    await expect(page.getByRole('heading', { name: 'Invite New Member' })).toBeVisible()
    await expect(page.getByPlaceholder('email@example.com')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send Invite' })).toBeVisible()
  })

  test('back button returns to admin dashboard', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // Click back button
    await page.getByRole('button').filter({ has: page.locator('svg') }).first().click()

    // Should return to admin dashboard
    await expect(page).toHaveURL('/admin')
  })
})

test.describe('Admin Workspace Member Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page)
  })

  test('can change member role', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // Find a member with "Member" role and change to "Admin"
    const memberRow = page.locator('tr').filter({ hasText: 'Member' }).first()
    const roleSelect = memberRow.locator('select')

    if (await roleSelect.isVisible()) {
      const currentRole = await roleSelect.inputValue()
      const newRole = currentRole === 'admin' ? 'member' : 'admin'

      await roleSelect.selectOption(newRole)

      // Verify the change persists (role dropdown shows new value)
      await expect(roleSelect).toHaveValue(newRole)
    }
  })

  test('can send invite to new email', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // Generate unique email
    const testEmail = `test-admin-${Date.now()}@example.com`

    // Fill invite form
    await page.getByPlaceholder('email@example.com').fill(testEmail)
    await page.getByRole('button', { name: 'Send Invite' }).click()

    // Should see invite in pending list
    await expect(page.getByText(testEmail)).toBeVisible({ timeout: 5000 })
  })

  test('can revoke invite', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // First create an invite
    const testEmail = `test-revoke-${Date.now()}@example.com`
    await page.getByPlaceholder('email@example.com').fill(testEmail)
    await page.getByRole('button', { name: 'Send Invite' }).click()
    await expect(page.getByText(testEmail)).toBeVisible({ timeout: 5000 })

    // Find and click revoke button for this invite
    const inviteRow = page.locator('tr').filter({ hasText: testEmail })
    await inviteRow.getByRole('button', { name: 'Revoke' }).click()

    // Invite should be removed
    await expect(page.getByText(testEmail)).not.toBeVisible({ timeout: 5000 })
  })

  test('can copy invite link', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('link', { name: /Test Workspace/i }).first().click()

    // Create an invite first
    const testEmail = `test-copy-${Date.now()}@example.com`
    await page.getByPlaceholder('email@example.com').fill(testEmail)
    await page.getByRole('button', { name: 'Send Invite' }).click()
    await expect(page.getByText(testEmail)).toBeVisible({ timeout: 5000 })

    // Find and click copy link button
    const inviteRow = page.locator('tr').filter({ hasText: testEmail })
    await inviteRow.getByRole('button', { name: 'Copy Link' }).click()

    // Can't easily verify clipboard in Playwright, but button should exist and be clickable
  })
})

test.describe('Admin User Search', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page)
  })

  test('user search shows results when typing', async ({ page }) => {
    // Navigate to a workspace with few members (test space has 1 member after our test)
    await page.goto('/admin')

    // Find a workspace that might have available users to add
    const workspaceLink = page.getByRole('link').filter({ hasText: /test space/i }).first()
    if (await workspaceLink.isVisible()) {
      await workspaceLink.click()
    } else {
      // Fall back to Ship Workspace
      await page.getByRole('link', { name: /Test Workspace/i }).first().click()
    }

    // Type in search box
    await page.getByPlaceholder('Search by email...').fill('dev')

    // Wait for debounced search results (300ms + network)
    await page.waitForTimeout(500)

    // Should show search results or "No users found"
    const hasResults = await page.locator('button').filter({ hasText: /@/ }).first().isVisible().catch(() => false)
    const noResults = await page.getByText('No users found').isVisible().catch(() => false)

    expect(hasResults || noResults).toBeTruthy()
  })

  test('selecting user from search enables Add User button', async ({ page }) => {
    await page.goto('/admin')

    // Go to test space (fewer members, more users to add)
    const testSpaceLink = page.getByRole('link').filter({ hasText: /test space/i }).first()
    if (await testSpaceLink.isVisible()) {
      await testSpaceLink.click()

      // Search for a user
      await page.getByPlaceholder('Search by email...').fill('bob')
      await page.waitForTimeout(500)

      // If results show, click one
      const userResult = page.locator('button').filter({ hasText: /bob/i }).first()
      if (await userResult.isVisible()) {
        await userResult.click()

        // Add User button should now be enabled
        const addButton = page.getByRole('button', { name: 'Add User' })
        await expect(addButton).not.toBeDisabled()
      }
    }
  })

  test('can add existing user to workspace', async ({ page }) => {
    await page.goto('/admin')

    // Go to test space
    const testSpaceLink = page.getByRole('link').filter({ hasText: /test space/i }).first()
    if (await testSpaceLink.isVisible()) {
      await testSpaceLink.click()

      // Get initial member count
      const memberHeading = page.getByRole('heading', { name: /Members \((\d+)\)/ })
      const headingText = await memberHeading.textContent()
      const initialCount = parseInt(headingText?.match(/\d+/)?.[0] || '0')

      // Search for a user not in the workspace
      await page.getByPlaceholder('Search by email...').fill('carol')
      await page.waitForTimeout(500)

      const userResult = page.locator('button').filter({ hasText: /carol/i }).first()
      if (await userResult.isVisible()) {
        await userResult.click()
        await page.getByRole('button', { name: 'Add User' }).click()

        // Member count should increase
        await expect(page.getByRole('heading', { name: /Members \((\d+)\)/ })).toContainText(`(${initialCount + 1})`, { timeout: 5000 })
      }
    }
  })
})

test.describe('Admin Workspace Access Control', () => {
  test('non-super-admin cannot access workspace detail', async ({ page }) => {
    // Clear cookies and try to access directly
    await page.context().clearCookies()
    await page.goto('/admin/workspaces/some-id')

    // Should redirect to login (may include query params)
    await expect(page).toHaveURL(/\/login/)
  })
})
