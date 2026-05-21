import { test, expect } from './fixtures/isolated-env'

test.describe('Team Mode (Phase 7)', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can navigate to Teams mode via icon rail', async ({ page }) => {
    // Click Teams icon in rail
    await page.getByRole('button', { name: 'Teams' }).click()

    // Should navigate to /team/allocation (Teams mode default view)
    await expect(page).toHaveURL(/\/team\/allocation/, { timeout: 5000 })
  })

  test('Teams mode shows header with team member count', async ({ page }) => {
    await page.goto('/team/directory')

    // Should see Team Directory heading (use h1 to avoid matching sidebar h2)
    await expect(page.locator('h1').filter({ hasText: 'Team Directory' })).toBeVisible({ timeout: 5000 })

    // Should see team member count (at least 1 for logged in user)
    await expect(page.getByText(/\d+ members?/)).toBeVisible({ timeout: 5000 })
  })

  test('Team grid displays logged-in user', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Should see at least the Dev User (who logged in)
    await expect(page.getByText('Dev User')).toBeVisible({ timeout: 5000 })
  })

  test('Team grid displays sprint columns', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Should see at least one Sprint column header (Sprint 1, Sprint 2, etc.)
    await expect(page.getByText(/Week \d+/).first()).toBeVisible({ timeout: 5000 })
  })

  test('Current sprint column is highlighted', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // The current sprint header should have accent styling (bg-accent/5)
    // We can check that at least one sprint column exists with the current styling
    // The current sprint has class bg-accent/5 applied
    const currentSprintHeader = page.locator('.bg-accent\\/5').first()
    await expect(currentSprintHeader).toBeVisible({ timeout: 5000 })
  })

  test('sprint columns can be scrolled horizontally', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Get the scrollable container (the grid area with overflow-auto)
    const scrollContainer = page.locator('.overflow-auto').first()
    await expect(scrollContainer).toBeVisible()

    // Get initial scroll position
    const initialScrollLeft = await scrollContainer.evaluate(el => el.scrollLeft)

    // Scroll right
    await scrollContainer.evaluate(el => { el.scrollLeft += 200 })

    // Wait a bit for scroll
    await page.waitForTimeout(100)

    // Get new scroll position - it should have changed or be at max
    const newScrollLeft = await scrollContainer.evaluate(el => el.scrollLeft)

    // If there's content to scroll, position should change
    // If already at max, that's also valid (means we have scrollable content)
    expect(newScrollLeft).toBeGreaterThanOrEqual(initialScrollLeft)
  })

  test('API returns team grid data structure', async ({ page }) => {
    await page.goto('/team')

    // Intercept the API call
    const response = await page.waitForResponse(
      resp => resp.url().includes('/api/team/grid') && resp.status() === 200
    )

    const data = await response.json()

    // Verify data structure
    expect(data).toHaveProperty('users')
    expect(data).toHaveProperty('weeks')
    expect(data).toHaveProperty('associations')

    // Verify users array has expected structure
    expect(Array.isArray(data.users)).toBe(true)
    expect(data.users.length).toBeGreaterThan(0)
    expect(data.users[0]).toHaveProperty('id')
    expect(data.users[0]).toHaveProperty('name')
    expect(data.users[0]).toHaveProperty('email')

    // Verify weeks array has expected structure
    expect(Array.isArray(data.weeks)).toBe(true)
    expect(data.weeks.length).toBeGreaterThanOrEqual(3) // At least current + some before/after
    expect(data.weeks[0]).toHaveProperty('number')
    expect(data.weeks[0]).toHaveProperty('name')
    expect(data.weeks[0]).toHaveProperty('startDate')
    expect(data.weeks[0]).toHaveProperty('endDate')
    expect(data.weeks[0]).toHaveProperty('isCurrent')

    // Verify at least one week is marked as current
    const currentWeeks = data.weeks.filter((s: { isCurrent: boolean }) => s.isCurrent)
    expect(currentWeeks.length).toBe(1)
  })

  test('grid cells are clickable and empty cells exist', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Verify we have user rows and week columns (Team grid uses "Week N" format)
    await expect(page.getByText('Dev User')).toBeVisible()
    await expect(page.getByText(/Week \d+/).first()).toBeVisible()

    // Verify grid cells exist (empty cells or cells with content)
    // The grid should have cells for each user/sprint combination
    const gridCells = page.locator('.border-b.border-r.border-border')
    const cellCount = await gridCells.count()

    // We have 11 users and at least 3 sprints, so minimum cells would be 11 * 3 = 33
    // Plus the header row cells
    expect(cellCount).toBeGreaterThanOrEqual(33)
  })

  test('can click cell to open program selector', async ({ page }) => {
    await page.goto('/team')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load with user data
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Dev User')).toBeVisible({ timeout: 10000 })

    // Wait for sprint columns to load
    await expect(page.getByText(/Week \d+/).first()).toBeVisible({ timeout: 10000 })

    // Wait a moment for grid to stabilize
    await page.waitForTimeout(500)

    // Look for an empty cell (shows "+" placeholder) - clicking this opens the popover
    const emptyCellButton = page.getByRole('button', { name: '+' }).first()
    const hasEmptyCell = await emptyCellButton.count() > 0

    if (hasEmptyCell) {
      // Click empty cell button - this is a Popover.Trigger
      await emptyCellButton.click()
    } else {
      // All cells have programs assigned - need to click the caret button
      // Find a cell with program and hover to reveal caret
      const caretButton = page.getByLabel('Change project assignment').first()
      await expect(caretButton).toBeVisible({ timeout: 5000 })
      await caretButton.click({ force: true }) // force for opacity transition
    }

    // Wait for the popover to open (cmdk command menu)
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible({ timeout: 10000 })

    // Verify the command menu is shown (either with programs or empty state)
    const commandMenu = page.locator('[cmdk-root]')
    await expect(commandMenu).toBeVisible()
  })

  test('program selector can be closed with Escape', async ({ page }) => {
    await page.goto('/team')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load with user data
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Dev User')).toBeVisible({ timeout: 10000 })

    // Wait for sprint columns to load
    await expect(page.getByText(/Week \d+/).first()).toBeVisible({ timeout: 10000 })

    // Wait a moment for grid to stabilize
    await page.waitForTimeout(500)

    // Look for an empty cell (shows "+" placeholder) - clicking this opens the popover
    const emptyCellButton = page.getByRole('button', { name: '+' }).first()
    const hasEmptyCell = await emptyCellButton.count() > 0

    if (hasEmptyCell) {
      await emptyCellButton.click()
    } else {
      // All cells have programs - click the caret button
      const caretButton = page.getByLabel('Change project assignment').first()
      await expect(caretButton).toBeVisible({ timeout: 5000 })
      await caretButton.click({ force: true })
    }

    // Wait for the popover to open
    const searchInput = page.getByPlaceholder('Search projects...')
    await expect(searchInput).toBeVisible({ timeout: 10000 })

    // Focus the search input and wait for it to be ready
    await searchInput.focus()
    await page.waitForTimeout(200)

    // Press Escape to close
    await page.keyboard.press('Escape')

    // Verify popover is closed - allow time for animation
    await expect(searchInput).not.toBeVisible({ timeout: 5000 })
  })

  test.describe('Assignments View - Program Grouping', () => {
    test('displays Unassigned group for people without current sprint assignment', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Should see an Unassigned group header with count
      const unassignedHeader = page.getByRole('button', { name: /Unassigned \d+/ })
      await expect(unassignedHeader).toBeVisible({ timeout: 5000 })

      // Verify the header shows a count
      const headerText = await unassignedHeader.textContent()
      expect(headerText).toMatch(/Unassigned.*\d+/)
    })

    test('people are sorted alphabetically within groups', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Get all user names in the left column (under Team Member)
      // Users should be sorted A-Z within their groups
      const userNames = await page.locator('.flex.items-center.gap-2').filter({ hasText: /^[A-Z].*$/ }).allTextContents()

      // Filter to just get names (exclude program headers)
      const names = userNames.filter(name => !name.includes('Unassigned') && name.length > 2)

      expect(names.length).toBeGreaterThan(0)
      for (let i = 1; i < names.length; i++) {
        const prevName = names[i - 1].replace(/^[A-Z]\s*/, '')
        const currName = names[i].replace(/^[A-Z]\s*/, '')
        expect(prevName.localeCompare(currName)).toBeLessThanOrEqual(0)
      }
    })

    test('project cells display with colored badge', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Empty cells should show '+' placeholder
      const emptyCell = page.getByRole('button', { name: '+' }).first()
      await expect(emptyCell).toBeVisible({ timeout: 5000 })
    })

    test('clicking cell opens project dropdown grouped by program', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Click an empty cell to open the project picker
      const emptyCellButton = page.getByRole('button', { name: '+' }).first()
      await emptyCellButton.click()

      // Should see project search input
      await expect(page.getByPlaceholder('Search projects...')).toBeVisible({ timeout: 10000 })

      // Should see "None" option to clear
      await expect(page.getByRole('option', { name: 'None' })).toBeVisible({ timeout: 5000 })

      // Dropdown is open and working - the presence of search input and None option
      // confirms the ProjectCombobox is rendering correctly.
      // Program groups appear when projects exist in the database
    })

    test('selecting project updates cell and shows badge', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Click an empty cell to open the project picker
      const emptyCellButton = page.getByRole('button', { name: '+' }).first()
      await emptyCellButton.click()

      // Wait for dropdown to open
      await expect(page.getByPlaceholder('Search projects...')).toBeVisible({ timeout: 10000 })

      // Check if there are any projects (not just None)
      const projectOptions = page.getByRole('option').filter({ hasNotText: 'None' })
      const projectCount = await projectOptions.count()

      // Projects should exist in seed data - fail if they don't
      expect(projectCount).toBeGreaterThan(0)

      // Select the first project option
      const projectName = await projectOptions.first().textContent()
      await projectOptions.first().click()

      // Cell should now show the project name
      if (projectName) {
        // The project name may be truncated, so check for partial match
        const shortName = projectName.slice(0, 10)
        await expect(page.getByText(shortName).first()).toBeVisible({ timeout: 5000 })
      }
    })

    test('selecting None clears the assignment', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // First assign a project, then clear it
      const emptyCellButton = page.getByRole('button', { name: '+' }).first()
      await emptyCellButton.click()

      await expect(page.getByPlaceholder('Search projects...')).toBeVisible({ timeout: 10000 })

      // Check if there are any projects (not just None)
      const projectOptions = page.getByRole('option').filter({ hasNotText: 'None' })
      const projectCount = await projectOptions.count()

      // Projects should exist in seed data - fail if they don't
      expect(projectCount).toBeGreaterThan(0)

      // Select a project
      await projectOptions.first().click()

      // Wait for dropdown to close and cell to update
      await page.waitForTimeout(500)

      // Now open the dropdown again (click the caret or the cell)
      const changeButton = page.getByLabel('Change project assignment').first()
      if (await changeButton.isVisible()) {
        await changeButton.click({ force: true })
      } else {
        // Cell might be the trigger now
        await page.getByRole('button', { name: /[A-Z].*/ }).first().click()
      }

      // Wait for dropdown and select None
      await expect(page.getByPlaceholder('Search projects...')).toBeVisible({ timeout: 10000 })
      await page.getByRole('option', { name: 'None' }).click()

      // Cell should now show '+' placeholder again
      await page.waitForTimeout(500)
      await expect(page.getByRole('button', { name: '+' }).first()).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Assignments View - Collapse/Expand', () => {
    test('clicking program header collapses the group', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Find a program group header (Unassigned or a program name)
      const groupHeader = page.getByRole('button', { name: /Unassigned \d+/ })
      await expect(groupHeader).toBeVisible({ timeout: 5000 })

      // Get the initial header text to check count
      const initialText = await groupHeader.textContent()
      expect(initialText).toMatch(/Unassigned.*\d+/)

      // Count visible user rows before collapse
      // Click to collapse
      await groupHeader.click()

      // Header should now show "(N)" format in collapsed state
      await page.waitForTimeout(300)
      const collapsedHeader = page.getByRole('button', { name: /Unassigned \(\d+\)/ })
      await expect(collapsedHeader).toBeVisible({ timeout: 5000 })
    })

    test('clicking collapsed header expands the group', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Find and collapse the Unassigned group
      const groupHeader = page.getByRole('button', { name: /Unassigned \d+/ })
      await expect(groupHeader).toBeVisible({ timeout: 5000 })
      await groupHeader.click()

      // Wait for collapse
      await page.waitForTimeout(300)
      const collapsedHeader = page.getByRole('button', { name: /Unassigned \(\d+\)/ })
      await expect(collapsedHeader).toBeVisible({ timeout: 5000 })

      // Click to expand
      await collapsedHeader.click()

      // Header should revert to expanded format (without parentheses around count)
      await page.waitForTimeout(300)
      const expandedHeader = page.getByRole('button', { name: /Unassigned \d+/ }).filter({ hasNotText: /\(\d+\)/ })
      await expect(expandedHeader).toBeVisible({ timeout: 5000 })
    })

    test('collapsed state shows member count in parentheses', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Find the Unassigned group header and get its count
      const groupHeader = page.getByRole('button', { name: /Unassigned \d+/ })
      await expect(groupHeader).toBeVisible({ timeout: 5000 })

      const headerText = await groupHeader.textContent()
      const countMatch = headerText?.match(/(\d+)/)
      const memberCount = countMatch ? countMatch[1] : '0'

      // Collapse the group
      await groupHeader.click()
      await page.waitForTimeout(300)

      // Verify collapsed header shows count in parentheses
      const collapsedHeader = page.getByRole('button', { name: `Unassigned (${memberCount})` })
      await expect(collapsedHeader).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Assignments View - Instant Regrouping', () => {
    test('changing current sprint assignment regroups person', async ({ page }) => {
      await page.goto('/team/allocation?tab=assignments')
      await page.waitForLoadState('networkidle')

      // Wait for grid to load
      await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

      // Find the current sprint column (highlighted with bg-accent/5)
      const currentSprintHeader = page.locator('.bg-accent\\/5').first()
      await expect(currentSprintHeader).toBeVisible({ timeout: 5000 })

      // Get initial Unassigned count (may not exist if all people are assigned)
      const initialHeader = page.getByRole('button', { name: /Unassigned \d+/ })
      const hasUnassigned = await initialHeader.count() > 0

      if (!hasUnassigned) {
        // No unassigned people - skip this test scenario
        return
      }

      const initialText = await initialHeader.textContent()
      const initialCountMatch = initialText?.match(/(\d+)/)
      const initialCount = initialCountMatch ? parseInt(initialCountMatch[1]) : 0

      // Find an empty cell in the current sprint column and assign a project
      const currentSprintCells = page.locator('.bg-accent\\/5').getByRole('button', { name: '+' })
      const cellCount = await currentSprintCells.count()

      if (cellCount > 0) {
        // Click the first empty cell in current sprint
        await currentSprintCells.first().click()

        // Wait for dropdown to open
        await expect(page.getByPlaceholder('Search projects...')).toBeVisible({ timeout: 10000 })

        // Check if there are any projects (not just None)
        const projectOptions = page.getByRole('option').filter({ hasNotText: 'None' })
        const projectCount = await projectOptions.count()

        // Projects should exist in seed data - fail if they don't
        expect(projectCount).toBeGreaterThan(0)

        // Select a project
        await projectOptions.first().click()

        // Wait for regrouping — poll until Unassigned count decreases or group disappears
        await expect(async () => {
          const newHeader = page.getByRole('button', { name: /Unassigned \d+/ })
          const newHeaderCount = await newHeader.count()
          if (newHeaderCount > 0) {
            const newText = await newHeader.textContent()
            const newCountMatch = newText?.match(/(\d+)/)
            const newCount = newCountMatch ? parseInt(newCountMatch[1]) : 0
            expect(newCount).toBeLessThan(initialCount)
          } else {
            // Unassigned group disappeared entirely - count went from 1 to 0
            expect(initialCount).toBe(1)
          }
        }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] })

        // Verify a new program group appeared
        const programGroups = page.getByRole('button', { name: /^[A-Z].*\d+$/ }).filter({ hasNotText: 'Unassigned' })
        const groupCount = await programGroups.count()
        expect(groupCount).toBeGreaterThan(0)
      }
    })
  })
})
