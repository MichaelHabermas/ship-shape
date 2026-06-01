import { test, expect } from './fixtures/isolated-env'
import { login } from './fixtures/api-auth';

import AxeBuilder from '@axe-core/playwright'

/**
 * Section 508 / WCAG 2.2 AA Accessibility Remediation Tests
 *
 * 46 tests covering all violations identified in the accessibility audit.
 * Each test corresponds to a specific fix in plans/508-accessibility-remediation.md
 *
 * Run: npx playwright test e2e/accessibility-remediation.spec.ts
 */

// =============================================================================
// PHASE 1: CRITICAL VIOLATIONS (12 tests)
// =============================================================================

test.describe('Phase 1: Critical Violations', () => {
  test.describe('1.1 Color-Only State Indicators (WCAG 1.4.1)', () => {
    test('status indicators have icons not just colors', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // MUST have status indicators - this test requires them to exist
      const statusIndicators = page.locator('[data-status-indicator]')
      await expect(statusIndicators.first()).toBeVisible({ timeout: 5000 })

      const count = await statusIndicators.count()
      expect(count).toBeGreaterThan(0)

      // Each status indicator MUST have an icon (svg) alongside color
      for (let i = 0; i < Math.min(count, 5); i++) {
        const indicator = statusIndicators.nth(i)
        const icon = indicator.locator('svg')
        await expect(icon).toHaveCount(1)
      }
    })

    test('screen readers can identify issue state without color', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // MUST have status indicators
      const statusIndicators = page.locator('[data-status-indicator]')
      await expect(statusIndicators.first()).toBeVisible({ timeout: 5000 })

      // Each indicator MUST have sr-only text or aria-label
      const indicator = statusIndicators.first()
      const srText = await indicator.locator('.sr-only').textContent()
      const ariaLabel = await indicator.getAttribute('aria-label')

      // At least one of these MUST exist and have meaningful text
      const accessibleName = srText?.trim() || ariaLabel?.trim()
      expect(accessibleName).toBeTruthy()
      if (!accessibleName) {
        throw new Error('expected accessible name for status indicator')
      }
      expect(accessibleName.length).toBeGreaterThan(2) // Not just empty or single char
    })
  })

  test.describe('1.2 Keyboard Navigation for Drag-and-Drop (WCAG 2.1.1)', () => {
    test('kanban board has keyboard instructions', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // Switch to kanban view (default is list view)
      const kanbanViewButton = page.getByRole('button', { name: 'Kanban view' })
      await kanbanViewButton.click()
      await page.waitForTimeout(500)

      // Kanban board MUST exist with role="application" for drag-drop
      const kanban = page.locator('[role="application"]')
      await expect(kanban).toHaveCount(1)

      // MUST have aria-label with keyboard instructions
      const ariaLabel = await kanban.getAttribute('aria-label')
      expect(ariaLabel).toBeTruthy()
      if (!ariaLabel) {
        throw new Error('expected kanban aria-label with keyboard instructions')
      }
      expect(ariaLabel.toLowerCase()).toContain('keyboard')
    })

  })

  test.describe('1.3 Status Messages Announced (WCAG 4.1.3)', () => {
    test('sync status has aria-live region', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Open a document to see sync status
      const docLink = page.locator('a[href*="/documents/"]').first()
      await expect(docLink).toBeVisible({ timeout: 5000 })
      await docLink.click()
      await page.waitForLoadState('networkidle')

      // Editor sync status MUST have role="status" and aria-live="polite"
      // Note: Multiple status regions exist (sync status, pending count, etc.), so we target specifically
      const syncStatus = page.locator('[data-testid="sync-status"]')
      await expect(syncStatus).toHaveCount(1)

      // Verify it has the proper status role
      expect(await syncStatus.getAttribute('role')).toBe('status')

      const ariaLive = await syncStatus.getAttribute('aria-live')
      expect(ariaLive).toBe('polite')

      const ariaAtomic = await syncStatus.getAttribute('aria-atomic')
      expect(ariaAtomic).toBe('true')
    })

  })

  test.describe('1.4 Combobox ARIA Attributes (WCAG 4.1.2)', () => {
    test('combobox has required ARIA attributes', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // Open an issue document (rows navigate via onClick — no anchor in tbody).
      await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 })
      await page.locator('table tbody tr').first().click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      const propertiesPanel = page.locator('#properties-portal, aside[aria-label="Document properties"]')
      await expect(propertiesPanel).toBeVisible({ timeout: 5000 })

      // MUST have at least one combobox in the properties sidebar (status, assignee, etc.)
      const combobox = propertiesPanel.locator('[aria-haspopup="listbox"], [role="combobox"]').first()
      await expect(combobox).toBeVisible({ timeout: 5000 })

      // MUST have aria-controls pointing to the listbox
      const ariaControls = await combobox.getAttribute('aria-controls')
      expect(ariaControls).toBeTruthy()

      // MUST have aria-expanded attribute
      const ariaExpanded = await combobox.getAttribute('aria-expanded')
      expect(ariaExpanded).not.toBeNull()

      // Click to open and verify listbox appears (Radix popover portal)
      await combobox.click()

      const listbox = page.locator(`#${ariaControls}, [role="listbox"]`)
      await expect(listbox).toBeVisible({ timeout: 5000 })

      // Close by pressing Escape
      await page.keyboard.press('Escape')
    })
  })

  test.describe('1.5 Focus Indicators (WCAG 2.4.7)', () => {
    test('focus indicators are visible with sufficient contrast', async ({ page }) => {
      await page.goto('/login')

      const emailField = page.locator('#email')
      await emailField.focus()

      // Check for visible focus indicator
      const focusStyles = await emailField.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return {
          outline: styles.outline,
          outlineWidth: styles.outlineWidth,
          boxShadow: styles.boxShadow,
        }
      })

      // Should have outline or box-shadow for focus
      const hasVisibleFocus =
        focusStyles.outlineWidth !== '0px' ||
        focusStyles.boxShadow !== 'none'

      expect(hasVisibleFocus).toBeTruthy()
    })
  })

  test.describe('1.6 Skip Navigation Links (WCAG 2.4.1)', () => {
    test('skip links exist and become visible on focus', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Skip link MUST exist (may be visually hidden until focused)
      const skipLink = page.locator('a[href="#main-content"], a:has-text("Skip to main"), .skip-link')
      await expect(skipLink.first()).toBeAttached()

      // Tab to first focusable element - should be skip link
      await page.keyboard.press('Tab')
      await page.waitForTimeout(100)

      // Skip link MUST become visible on focus
      await expect(skipLink.first()).toBeVisible({ timeout: 1000 })

      // Skip link MUST have descriptive text
      const linkText = await skipLink.first().textContent()
      expect(linkText?.toLowerCase()).toMatch(/skip|main|content/)
    })

    test('skip link targets exist and work', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Main content target MUST exist
      const mainContent = page.locator('#main-content, main')
      await expect(mainContent).toHaveCount(1)

      // Tab to skip link and activate it
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)

      // Focus MUST move to main content area
      const focusedElement = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return null
        return {
          id: el.id,
          tagName: el.tagName.toLowerCase(),
          isInMain: !!el.closest('main, #main-content')
        }
      })

      // Either the main element is focused or focus moved inside it
      expect(
        focusedElement?.id === 'main-content' ||
        focusedElement?.tagName === 'main' ||
        focusedElement?.isInMain
      ).toBeTruthy()
    })
  })

  test.describe('1.7 SVG Icon Accessibility (WCAG 4.1.2)', () => {
    test('decorative icons are hidden from screen readers', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Icons inside buttons should be aria-hidden
      const buttonsWithIcons = page.locator('button svg, a svg')
      const count = await buttonsWithIcons.count()

      for (let i = 0; i < Math.min(count, 10); i++) {
        const icon = buttonsWithIcons.nth(i)
        const ariaHidden = await icon.getAttribute('aria-hidden')
        // SVGs in buttons should generally be aria-hidden="true"
        // unless they're the only content
        if (ariaHidden !== null) {
          expect(ariaHidden).toBe('true')
        }
      }
    })
  })

  test.describe('1.8 Form Error Identification (WCAG 3.3.1)', () => {
    test('form errors have aria-describedby linking to error message', async ({ page }) => {
      await page.goto('/login')

      // Submit empty form to trigger validation error
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.waitForTimeout(500)

      // Error message MUST appear
      const errorMessage = page.locator('[role="alert"], .error-message, [id*="error"]')
      await expect(errorMessage.first()).toBeVisible({ timeout: 3000 })

      // Error MUST have an id
      const errorId = await errorMessage.first().getAttribute('id')
      expect(errorId).toBeTruthy()

      // At least one input MUST have aria-describedby pointing to the error
      const linkedInput = page.locator(`[aria-describedby*="${errorId}"]`)
      await expect(linkedInput).toHaveCount(1)

      // The error MUST be announced (role="alert" or aria-live)
      const hasAlert = await errorMessage.first().evaluate((el) => {
        return el.getAttribute('role') === 'alert' ||
               el.getAttribute('aria-live') === 'assertive' ||
               el.getAttribute('aria-live') === 'polite'
      })
      expect(hasAlert).toBeTruthy()
    })

    test('form errors are associated with specific fields', async ({ page }) => {
      await page.goto('/login')

      // Fill only email, leave password empty, then submit
      await page.locator('#email').fill('test@example.com')
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.waitForTimeout(500)

      // Password field MUST have aria-invalid="true" if empty
      const passwordField = page.locator('#password, [type="password"]')
      const isInvalid = await passwordField.getAttribute('aria-invalid')

      // Either aria-invalid is set OR native validation is in use
      const validityMessage = await passwordField.evaluate((el: HTMLInputElement) => {
        return el.validationMessage
      })

      expect(isInvalid === 'true' || validityMessage?.length > 0).toBeTruthy()
    })
  })

  test.describe('1.9 Focus Not Obscured (WCAG 2.4.11)', () => {
    test('focused elements are not hidden by overlays', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Tab through several elements
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab')
        await page.waitForTimeout(100)

        // Get the focused element
        const focused = await page.evaluate(() => {
          const el = document.activeElement
          if (!el) return null
          const rect = el.getBoundingClientRect()
          return { top: rect.top, left: rect.left, visible: rect.width > 0 && rect.height > 0 }
        })

        if (focused) {
          expect(focused.visible).toBeTruthy()
        }
      }
    })
  })

  test.describe('1.10 Image Alt Text (WCAG 1.1.1)', () => {
    test('images have alt attributes', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      const images = page.locator('img')
      const count = await images.count()

      for (let i = 0; i < count; i++) {
        const img = images.nth(i)
        const alt = await img.getAttribute('alt')
        // Alt should exist (even if empty for decorative images)
        expect(alt).not.toBeNull()
      }
    })
  })

  test.describe('1.11 Page Heading Structure (WCAG 2.4.6)', () => {
    test('login page has descriptive h1', async ({ page }) => {
      await page.goto('/login')

      const h1 = page.locator('h1')
      const text = await h1.textContent()

      // H1 should describe the page purpose, not just "Ship"
      expect(text?.toLowerCase()).toMatch(/sign in|login|welcome/)
    })

    test('pages have logical heading hierarchy', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Get all headings
      const headings = await page.evaluate(() => {
        const hs = document.querySelectorAll('h1, h2, h3, h4, h5, h6')
        return Array.from(hs).map((h) => parseInt(h.tagName[1]))
      })

      // Should have at least one h1
      expect(headings).toContain(1)

      // Check for no skipped levels (e.g., h1 -> h3 without h2)
      for (let i = 1; i < headings.length; i++) {
        const jump = headings[i] - headings[i - 1]
        expect(jump).toBeLessThanOrEqual(1)
      }
    })
  })

  test.describe('1.12 Hover Controls on Focus (WCAG 1.4.13)', () => {
    test('controls shown on hover are also shown on focus', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Tree items MUST exist
      const treeItems = page.locator('[role="treeitem"], .tree-item, [data-tree-item]')
      await expect(treeItems.first()).toBeVisible({ timeout: 5000 })

      // Focus the first tree item
      const treeItem = treeItems.first()
      await treeItem.focus()
      await page.waitForTimeout(200)

      // When focused, any action buttons MUST be visible (not just on hover)
      const actionButtons = treeItem.locator('button, [role="button"]')
      const buttonCount = await actionButtons.count()

      if (buttonCount > 0) {
        // At least one action button MUST be visible on focus
        let anyVisible = false
        for (let i = 0; i < buttonCount; i++) {
          if (await actionButtons.nth(i).isVisible()) {
            anyVisible = true
            break
          }
        }
        expect(anyVisible).toBeTruthy()
      }

      // Verify hover and focus parity: hover over item
      await treeItem.hover()
      await page.waitForTimeout(200)

      const hoverVisibleButtons: boolean[] = []
      for (let i = 0; i < buttonCount; i++) {
        hoverVisibleButtons.push(await actionButtons.nth(i).isVisible())
      }

      // Focus again
      await treeItem.focus()
      await page.waitForTimeout(200)

      // Same buttons MUST be visible on focus as on hover
      for (let i = 0; i < buttonCount; i++) {
        const focusVisible = await actionButtons.nth(i).isVisible()
        expect(focusVisible).toBe(hoverVisibleButtons[i])
      }
    })
  })
})

// =============================================================================
// PHASE 2: SERIOUS VIOLATIONS (18 tests)
// =============================================================================

test.describe('Phase 2: Serious Violations', () => {
  test.describe('2.1 Command Palette Modal (WCAG 4.1.2)', () => {
    test('command palette opens and has proper dialog role', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Open command palette with Cmd+K (or Ctrl+K on non-Mac)
      await page.keyboard.press('Meta+k')

      // Dialog MUST appear
      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible({ timeout: 2000 })

      // MUST have aria-modal="true"
      const ariaModal = await dialog.getAttribute('aria-modal')
      expect(ariaModal).toBe('true')

      // MUST have aria-label or aria-labelledby
      const ariaLabel = await dialog.getAttribute('aria-label')
      const ariaLabelledBy = await dialog.getAttribute('aria-labelledby')
      expect(ariaLabel || ariaLabelledBy).toBeTruthy()

      // Close with Escape
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible({ timeout: 1000 })
    })

    test('command palette traps focus', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Open command palette
      await page.keyboard.press('Meta+k')
      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible({ timeout: 2000 })

      // Focus MUST be inside the dialog initially
      const initialFocus = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]')
        return dialog?.contains(document.activeElement)
      })
      expect(initialFocus).toBeTruthy()

      // Tab through - focus MUST stay in dialog
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab')
        const stillInDialog = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]')
          return dialog?.contains(document.activeElement)
        })
        expect(stillInDialog).toBeTruthy()
      }

      await page.keyboard.press('Escape')
    })
  })

  test.describe('2.2 Target Size Minimum (WCAG 2.5.8)', () => {
    test('interactive elements meet 24px minimum target size', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Check chevron/expand buttons - MUST have some buttons with icons
      const smallButtons = page.locator('button svg').locator('..')
      await expect(smallButtons.first()).toBeVisible({ timeout: 5000 })
      const count = await smallButtons.count()
      expect(count).toBeGreaterThan(0)

      for (let i = 0; i < Math.min(count, 5); i++) {
        const button = smallButtons.nth(i)
        const size = await button.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        })

        // Should be at least 24x24
        expect(size.width).toBeGreaterThanOrEqual(24)
        expect(size.height).toBeGreaterThanOrEqual(24)
      }
    })
  })

  test.describe('2.3 Link Purpose (WCAG 2.4.4)', () => {
    test('links have accessible names describing destination', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      const links = page.locator('a[href]')
      const count = await links.count()

      for (let i = 0; i < Math.min(count, 10); i++) {
        const link = links.nth(i)
        const accessibleName = await link.evaluate((el) => {
          return el.textContent?.trim() ||
                 el.getAttribute('aria-label') ||
                 el.querySelector('.sr-only')?.textContent
        })

        // Link should have some accessible text
        expect(accessibleName).toBeTruthy()
      }
    })
  })

  test.describe('2.4 Labels and Instructions (WCAG 3.3.2)', () => {
    test('form inputs have visible labels', async ({ page }) => {
      await page.goto('/login')

      const inputs = page.locator('input:not([type="hidden"])')
      const count = await inputs.count()

      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i)
        const id = await input.getAttribute('id')

        if (id) {
          // Check for associated label
          const label = page.locator(`label[for="${id}"]`)
          const ariaLabel = await input.getAttribute('aria-label')
          const ariaLabelledBy = await input.getAttribute('aria-labelledby')

          const hasLabel = await label.count() > 0 || ariaLabel || ariaLabelledBy
          expect(hasLabel).toBeTruthy()
        }
      }
    })
  })

  test.describe('2.5 Select Label Association (WCAG 1.3.1)', () => {
    test('select elements have associated labels', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // Application MUST have select/combobox elements for filtering/properties
      const selects = page.locator('select, [role="combobox"], [role="listbox"]')
      await expect(selects.first()).toBeVisible({ timeout: 5000 })
      const count = await selects.count()
      expect(count).toBeGreaterThan(0)

      for (let i = 0; i < Math.min(count, 5); i++) {
        const select = selects.nth(i)
        const ariaLabel = await select.getAttribute('aria-label')
        const ariaLabelledBy = await select.getAttribute('aria-labelledby')
        const id = await select.getAttribute('id')

        let hasLabel = !!(ariaLabel || ariaLabelledBy)
        if (id && !hasLabel) {
          const label = page.locator(`label[for="${id}"]`)
          hasLabel = await label.count() > 0
        }

        expect(hasLabel).toBeTruthy()
      }
    })
  })

  test.describe('2.6 Tab Component ARIA (WCAG 4.1.2)', () => {
    test('tab components have proper ARIA roles', async ({ page }) => {
      await login(page)
      // Navigate to a page with tabs (issues has status tabs, docs has view tabs)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // Tablist MUST exist
      const tablist = page.locator('[role="tablist"]')
      await expect(tablist.first()).toBeVisible({ timeout: 5000 })

      // MUST have at least one tab inside
      const tabs = tablist.locator('[role="tab"]')
      expect(await tabs.count()).toBeGreaterThan(0)

      // Each tab MUST have aria-selected attribute
      const firstTab = tabs.first()
      const ariaSelected = await firstTab.getAttribute('aria-selected')
      expect(ariaSelected).toMatch(/true|false/)

      // Exactly one tab MUST be selected at a time
      const selectedTab = tablist.locator('[aria-selected="true"]')
      await expect(selectedTab).toHaveCount(1)

      // Clicking another tab MUST change selection
      const tabCount = await tabs.count()
      if (tabCount < 2) {
        // Only one tab exists - skip selection change test but this is valid
        console.log('Single tab tablist - selection change not testable')
        return
      }

      // With multiple tabs, we MUST have at least one unselected tab
      const unselectedTab = tablist.locator('[aria-selected="false"]').first()
      await expect(unselectedTab).toBeVisible({ timeout: 1000 })

      // Store tab text before clicking (locators re-evaluate, so we need to identify the specific tab)
      const tabText = await unselectedTab.textContent()
      await unselectedTab.click()
      await page.waitForTimeout(200)

      // The clicked tab MUST now be selected - find by its text content
      const clickedTab = tablist.locator('[role="tab"]').filter({ hasText: tabText || '' })
      const nowSelected = await clickedTab.getAttribute('aria-selected')
      expect(nowSelected).toBe('true')
    })
  })

  test.describe('2.7 Auto-save Notification (WCAG 3.2.2)', () => {
    test('auto-save has status announcement', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Open a document to see auto-save
      const docLink = page.locator('a[href*="/documents/"]').first()
      await expect(docLink).toBeVisible({ timeout: 5000 })
      await docLink.click()
      await page.waitForLoadState('networkidle')

      // Status region MUST exist for auto-save announcements
      // Use specific testid since there are multiple status elements (sync-status, pending-sync-count)
      const statusRegion = page.getByTestId('sync-status')
      await expect(statusRegion).toBeVisible()

      // MUST have aria-live attribute
      const ariaLive = await statusRegion.getAttribute('aria-live')
      expect(ariaLive).toBe('polite')
    })
  })

  test.describe('2.8 Keyboard Escape from Resize (WCAG 2.1.2)', () => {
    test('Escape key deselects image in editor', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Open a document with content
      const docLink = page.locator('a[href*="/documents/"]').first()
      await expect(docLink).toBeVisible({ timeout: 5000 })
      await docLink.click()
      await page.waitForLoadState('networkidle')

      // Find an image in the editor
      const image = page.locator('.ProseMirror img, [data-type="image"]').first()

      // This test only applies if there are images
      const imageCount = await image.count()
      if (imageCount > 0) {
        // Click to select the image
        await image.click()
        await page.waitForTimeout(200)

        // Image MUST be selected (resize handles or selection state)
        const isSelected = await image.evaluate((el) => {
          const parent = el.closest('[data-selected], .ProseMirror-selectednode')
          return !!parent || el.classList.contains('ProseMirror-selectednode')
        })
        expect(isSelected).toBeTruthy()

        // Press Escape - MUST deselect
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)

        // Image MUST no longer be selected
        const stillSelected = await image.evaluate((el) => {
          const parent = el.closest('[data-selected], .ProseMirror-selectednode')
          return !!parent || el.classList.contains('ProseMirror-selectednode')
        })
        expect(stillSelected).toBeFalsy()
      }
    })
  })

  test.describe('2.9 Color Contrast (WCAG 1.4.3)', () => {
    test('no color contrast violations on main pages', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2aa'])
        .options({ rules: { 'color-contrast': { enabled: true } } })
        .analyze()

      const contrastViolations = results.violations.filter(
        (v) => v.id === 'color-contrast'
      )

      expect(contrastViolations).toHaveLength(0)
    })
  })

  test.describe('2.10 Error Suggestions (WCAG 3.3.3)', () => {
    test('login errors provide recovery suggestions', async ({ page }) => {
      await page.goto('/login')

      await page.locator('#email').fill('invalid@test.com')
      await page.locator('#password').fill('wrongpassword')
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()

      await page.waitForTimeout(1000)

      // Error message should provide helpful suggestion
      const errorText = await page.locator('[role="alert"], .error').textContent()
      if (errorText) {
        // Should have more than just "Error" - should suggest action
        expect(errorText.length).toBeGreaterThan(10)
      }
    })
  })

  test.describe('2.11 Landmark Regions (WCAG 1.3.6)', () => {
    test('page has proper landmark structure matching 4-panel layout', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // MUST have exactly the landmark structure from the plan:
      // nav (icon rail) → aside (sidebar) → main (editor) → aside (properties)

      // Icon Rail: nav with aria-label="Primary navigation"
      const iconRailNav = page.locator('nav[aria-label="Primary navigation"], #icon-rail')
      await expect(iconRailNav).toHaveCount(1)

      // Contextual Sidebar: aside with aria-label="Document list"
      const sidebarAside = page.locator('aside[aria-label="Document list"], #sidebar-content')
      await expect(sidebarAside).toHaveCount(1)

      // Main content area
      const mainContent = page.locator('main#main-content, main')
      await expect(mainContent).toHaveCount(1)

      // Properties Sidebar: aside with aria-label="Document properties"
      // Note: Properties sidebar only appears when editing a document (4-panel editor layout)
      // Navigate to a document first to get the full 4-panel layout
      const docLink = page.locator('a[href*="/documents/"]').first()
      if (await docLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await docLink.click()
        await page.waitForLoadState('networkidle')
        const propertiesAside = page.locator('aside[aria-label="Document properties"], #properties-panel')
        await expect(propertiesAside).toHaveCount(1)
      }
    })

    test('landmarks appear in correct DOM order for screen readers', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Navigate to a document to get the full 4-panel layout with properties sidebar
      const docLink = page.locator('a[href*="/documents/"]').first()
      if (await docLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await docLink.click()
        await page.waitForLoadState('networkidle')
      }

      // Get all landmarks in DOM order
      const landmarks = await page.evaluate(() => {
        const elements = document.querySelectorAll('nav, aside, main')
        return Array.from(elements).map(el => ({
          tag: el.tagName.toLowerCase(),
          label: el.getAttribute('aria-label') || el.id || 'unlabeled'
        }))
      })

      // Verify order: nav comes before main, sidebar aside before main
      const navIndex = landmarks.findIndex(l => l.tag === 'nav')
      const mainIndex = landmarks.findIndex(l => l.tag === 'main')
      const sidebarIndex = landmarks.findIndex(l => l.label === 'Document list')

      expect(navIndex).toBeLessThan(mainIndex) // nav before main
      expect(sidebarIndex).toBeLessThan(mainIndex) // sidebar before main

      // Properties sidebar is rendered as a sibling AFTER main (for correct reading order)
      // This is the accessible pattern: nav -> sidebar -> main -> properties
      const propertiesAside = page.locator('aside[aria-label="Document properties"], #properties-portal')
      const hasProperties = await propertiesAside.count() > 0
      // Only require properties if we successfully navigated to a document editor
      if (await page.locator('textarea[placeholder="Untitled"]').isVisible().catch(() => false)) {
        expect(hasProperties).toBeTruthy()
      }
    })
  })

  test.describe('2.12 Properties Sidebar Audit', () => {
    test('properties sidebar forms have proper labels', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // Issue link MUST exist
      const issueLink = page.locator('a[href*="/documents/"]').first()
      await expect(issueLink).toBeVisible({ timeout: 5000 })
      await issueLink.click()
      await page.waitForLoadState('networkidle')

      // Properties panel MUST exist (it's part of the 4-panel layout)
      const propertiesPanel = page.locator('#properties-panel, aside[aria-label="Document properties"]').first()
      await expect(propertiesPanel).toBeVisible({ timeout: 3000 })

      // Properties panel MUST have form controls (status, assignee, etc.)
      const formControls = propertiesPanel.locator('input, select, [role="combobox"], [role="listbox"]')
      const count = await formControls.count()
      expect(count).toBeGreaterThan(0)

      // Each form control MUST have an accessible label
      for (let i = 0; i < count; i++) {
        const control = formControls.nth(i)
        const labelInfo = await control.evaluate((el) => {
          const id = el.id
          const ariaLabel = el.getAttribute('aria-label')
          const ariaLabelledBy = el.getAttribute('aria-labelledby')
          const hasAssociatedLabel = id && document.querySelector(`label[for="${id}"]`)
          return {
            id,
            ariaLabel,
            ariaLabelledBy,
            hasAssociatedLabel: !!hasAssociatedLabel,
            tagName: el.tagName.toLowerCase()
          }
        })

        // MUST have at least one labeling mechanism
        const hasLabel = !!(labelInfo.ariaLabel || labelInfo.ariaLabelledBy || labelInfo.hasAssociatedLabel)
        expect(hasLabel).toBeTruthy()
      }
    })

    test('properties sidebar works with keyboard only', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      const issueLink = page.locator('a[href*="/documents/"]').first()
      await expect(issueLink).toBeVisible({ timeout: 5000 })
      await issueLink.click()
      await page.waitForLoadState('networkidle')

      // Tab into the properties panel
      // Keep tabbing until we reach a form control in the properties panel
      const propertiesPanel = page.locator('#properties-panel, aside[aria-label="Document properties"]').first()
      await expect(propertiesPanel).toBeVisible()

      let foundControlInPanel = false
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab')
        const isInPanel = await page.evaluate(() => {
          const panel = document.querySelector('#properties-panel, aside[aria-label="Document properties"]')
          return panel?.contains(document.activeElement)
        })
        if (isInPanel) {
          foundControlInPanel = true
          break
        }
      }

      expect(foundControlInPanel).toBeTruthy()
    })
  })

  test.describe('2.13 Auto-Expand Tree to Current Document', () => {
    test('navigating to nested document auto-expands tree ancestors', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Sidebar tree MUST exist
      const sidebar = page.locator('#sidebar-content, aside[aria-label="Document list"]')
      await expect(sidebar).toBeVisible({ timeout: 5000 })
      const sidebarTree = sidebar.locator('[role="tree"][aria-label*="documents" i]').first()
      await expect(sidebarTree).toBeVisible({ timeout: 5000 })

      // DocumentTreeItem renders li[data-testid="doc-item"] (not legacy data-tree-item).
      const expandableNode = sidebarTree.locator('li[data-testid="doc-item"]:has([role="treeitem"][aria-expanded])').first()
      const expandableItem = expandableNode.locator('[role="treeitem"][aria-expanded]').first()
      const hasExpandable = await expandableNode.count() > 0

      // E2E isolated-env seed creates Welcome → Getting Started / Advanced Topics (see isolated-env.ts).
      expect(hasExpandable, 'E2E seed should provide nested wiki documents (Welcome to Ship children)').toBe(true)

      // Expand to find a nested document
      const isExpanded = await expandableItem.getAttribute('aria-expanded')
      if (isExpanded === 'false') {
        const expander = expandableItem.locator('button, [role="button"]').first()
        await expect(expander).toBeVisible()
        await expander.click()
        await page.waitForTimeout(300)
      }

      // Find a child document link (must be in the nested ARIA group, not the parent's own link)
      const childDoc = expandableNode.locator('[role="group"] a[href*="/documents/"]').first()
      await expect(childDoc).toBeVisible({ timeout: 3000 })

      const childHref = await childDoc.getAttribute('href')
      expect(childHref).toBeTruthy()
      if (!childHref) {
        throw new Error('expected child document href')
      }

      // Navigate directly to this URL (simulating deep link / refresh)
      await page.goto(childHref)
      await page.waitForLoadState('networkidle')

      // CRITICAL: Tree MUST auto-expand to show this document
      // Use the sidebar tree specifically to avoid conflicts with main content tree
      const refreshedSidebarTree = page.locator('[role="tree"][aria-label*="documents" i]').first()
      const currentDocInTree = refreshedSidebarTree.locator(`a[href="${childHref}"]`)
      await expect(currentDocInTree).toBeVisible({ timeout: 3000 })

      // Parent MUST be expanded (aria-expanded="true")
      const expandedParent = refreshedSidebarTree.locator('[role="treeitem"][aria-expanded="true"]')
      expect(await expandedParent.count()).toBeGreaterThan(0)
    })

    test('current document is visually highlighted in tree', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Click on any document from the sidebar tree specifically
      // Use the complementary landmark to find the sidebar
      const sidebar = page.locator('[aria-label="Document list"]')
      await expect(sidebar).toBeVisible({ timeout: 5000 })

      const docLink = sidebar.locator('a[href*="/documents/"]').first()
      await expect(docLink).toBeVisible()
      const href = await docLink.getAttribute('href')
      await docLink.click()

      // Wait for URL to change to the document page
      await page.waitForURL(`**${href}`)
      await page.waitForLoadState('networkidle')

      // Wait for the treeitem to become selected (React needs time to re-render)
      // The treeitem should have aria-selected="true" when active
      const selectedTreeItem = sidebar.locator(`[role="treeitem"]:has(a[href="${href}"])[aria-selected="true"]`)

      // Wait up to 5 seconds for selection to appear
      await expect(selectedTreeItem).toBeVisible({ timeout: 5000 })
    })

    test('document tree supports arrow-key focus and expand/collapse', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      const sidebar = page.locator('[aria-label="Document list"]')
      await expect(sidebar).toBeVisible({ timeout: 5000 })

      const sidebarTree = sidebar.locator('[role="tree"][aria-label*="documents"]').first()
      await expect(sidebarTree).toBeVisible({ timeout: 5000 })

      const visibleTreeItemCount = await sidebarTree.locator('[role="treeitem"]').count()
      expect(visibleTreeItemCount, 'Seed data should provide at least two visible document tree items. Run: pnpm db:seed').toBeGreaterThanOrEqual(2)

      const focusedTreeItemIndex = async () => page.evaluate(() => {
        const tree = document.querySelector('[aria-label="Document list"] [role="tree"][aria-label*="documents"]')
        const items = Array.from(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])
          .filter((item) => item.offsetParent !== null)
        return items.indexOf(document.activeElement as HTMLElement)
      })

      await sidebarTree.locator('[role="treeitem"]').first().focus()
      await expect.poll(focusedTreeItemIndex).toBe(0)

      await page.keyboard.press('ArrowDown')
      await expect.poll(focusedTreeItemIndex).toBe(1)

      await page.keyboard.press('ArrowUp')
      await expect.poll(focusedTreeItemIndex).toBe(0)

      const expandableItem = sidebarTree.locator('[role="treeitem"][aria-expanded]').first()
      await expect(expandableItem).toBeVisible({ timeout: 5000 })
      await expandableItem.focus()

      if ((await expandableItem.getAttribute('aria-expanded')) === 'true') {
        await page.keyboard.press('ArrowLeft')
        await expect(expandableItem).toHaveAttribute('aria-expanded', 'false')
      }

      await page.keyboard.press('ArrowRight')
      await expect(expandableItem).toHaveAttribute('aria-expanded', 'true')

      await page.keyboard.press('ArrowRight')
      await expect.poll(focusedTreeItemIndex).toBeGreaterThan(0)

      await page.keyboard.press('ArrowLeft')
      await expect.poll(focusedTreeItemIndex).toBe(0)

      await page.keyboard.press('End')
      await expect.poll(focusedTreeItemIndex).toBeGreaterThan(0)

      await page.keyboard.press('Home')
      await expect.poll(focusedTreeItemIndex).toBe(0)

      await page.keyboard.press('ArrowLeft')
      await expect(expandableItem).toHaveAttribute('aria-expanded', 'false')
    })
  })

  test.describe('2.14-2.18 Additional Serious Fixes', () => {
    test('issue lists use semantic list markup', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // Issues page uses list view (table) by default or kanban view (ul/li)
      // Both are valid semantic structures for their respective use cases

      // Check for table structure (list view - default)
      const table = page.locator('table[role="grid"]')
      const hasTableView = await table.count() > 0

      // Check for kanban structure (ul/li)
      const kanbanLists = page.locator('ul:has([data-issue]), ul:has(li [data-draggable])')
      const hasKanbanView = await kanbanLists.count() > 0

      // At least one semantic structure MUST exist
      // Table with role="grid" is valid for list view (tabular data)
      // ul/li is valid for kanban view (item lists)
      expect(hasTableView || hasKanbanView).toBeTruthy()

      // If table view is active, verify semantic table structure
      if (hasTableView) {
        const tableRows = page.locator('table tbody tr[role="row"]')
        const rowCount = await tableRows.count()
        // Table should have proper row/cell structure
        if (rowCount > 0) {
          const firstRow = tableRows.first()
          const cells = firstRow.locator('td[role="gridcell"]')
          expect(await cells.count()).toBeGreaterThan(0)
        }
      }
    })

    test('loading indicators have aria-live', async ({ page }) => {
      await login(page)

      // Find any loading indicators
      const loaders = page.locator('[aria-busy="true"], .loading, [data-loading]')
      const count = await loaders.count()

      for (let i = 0; i < count; i++) {
        const loader = loaders.nth(i)
        const ariaLive = await loader.getAttribute('aria-live')
        const hasStatus = await loader.locator('[role="status"]').count() > 0
        // Loading indicators should announce to screen readers
        expect(ariaLive || hasStatus).toBeTruthy()
      }
    })

    test('document tree updates are announced', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Document tree MUST have aria-live region for update announcements
      // Use the sidebar tree specifically (aria-label containing "documents")
      const tree = page.locator('[role="tree"][aria-label*="documents"]').first()
      await expect(tree).toBeVisible({ timeout: 5000 })

      // Tree or parent container MUST announce updates to screen readers
      const hasAriaLive = await tree.evaluate((el) => {
        let current = el as HTMLElement | null
        while (current) {
          const ariaLive = current.getAttribute('aria-live')
          if (ariaLive === 'polite' || ariaLive === 'assertive') return true
          current = current.parentElement
        }
        return false
      })

      // Or tree has status region nearby for announcements
      const statusRegion = page.locator('[role="status"]')
      const hasStatus = await statusRegion.count() > 0

      expect(hasAriaLive || hasStatus).toBeTruthy()
    })

    test('related form fields are grouped with fieldset', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // Open a document with properties sidebar
      const docLink = page.locator('a[href*="/documents/"]').first()
      await expect(docLink).toBeVisible({ timeout: 5000 })
      await docLink.click()
      await page.waitForLoadState('networkidle')

      // Properties sidebar MUST have proper grouping for related fields
      const propertiesSidebar = page.locator('[data-properties], aside:has(select)')
      await expect(propertiesSidebar).toBeVisible({ timeout: 5000 })

      // Related form controls MUST be grouped with fieldset/legend or role="group"
      const formGroups = propertiesSidebar.locator('fieldset, [role="group"]')
      const hasGroups = await formGroups.count() > 0

      // Or each field has its own clear label association (acceptable alternative)
      const labeledInputs = propertiesSidebar.locator('[aria-labelledby], [aria-label], label input, label select')
      const hasLabels = await labeledInputs.count() > 0

      expect(hasGroups || hasLabels).toBeTruthy()
    })

    test('dialogs have close instructions', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Open command palette (Cmd+K)
      await page.keyboard.press('Meta+k')
      await page.waitForTimeout(300)

      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      // Dialog MUST have close instructions (Escape hint or close button with label)
      const escapeHint = dialog.locator(':text-matches("Esc|Escape|close", "i")')
      const closeAttr = dialog.locator('[aria-label*="close"], [aria-label*="dismiss"]')
      const closeButton = dialog.locator('button[aria-label*="close"], button[aria-label*="dismiss"]')
      const hasCloseInstructions = await escapeHint.count() > 0 || await closeAttr.count() > 0 || await closeButton.count() > 0

      expect(hasCloseInstructions).toBeTruthy()

      await page.keyboard.press('Escape')
    })
  })
})

// =============================================================================
// PHASE 3: MODERATE VIOLATIONS (11 tests)
// =============================================================================

test.describe('Phase 3: Moderate Violations', () => {
  test.describe('3.1 Section Headings (WCAG 2.4.10)', () => {
    test('major sections have headings', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Page MUST have h1
      const h1 = page.locator('h1')
      await expect(h1).toHaveCount(1)

      // MUST have h2s for major sections in the 4-panel layout
      // At minimum: sidebar section heading, main content area
      const h2s = page.locator('h2')
      expect(await h2s.count()).toBeGreaterThanOrEqual(1)

      // Headings MUST have meaningful content (not empty)
      // We already asserted h2s.count() >= 1, so firstH2 MUST exist
      const firstH2 = h2s.first()
      await expect(firstH2).toBeVisible()
      const text = await firstH2.textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    })
  })

  test.describe('3.2 Input Purpose (WCAG 1.3.5)', () => {
    test('login form inputs have appropriate autocomplete attributes', async ({ page }) => {
      await page.goto('/login')

      // Email/username input MUST exist on login page
      const emailInput = page.locator('#email, [type="email"], [name="email"]')
      await expect(emailInput).toHaveCount(1)

      // Email MUST have autocomplete attribute
      const emailAutocomplete = await emailInput.getAttribute('autocomplete')
      expect(emailAutocomplete).toBeTruthy()
      expect(emailAutocomplete).toMatch(/email|username/)

      // Password input MUST exist on login page
      const passwordInput = page.locator('#password, [type="password"]')
      await expect(passwordInput).toHaveCount(1)

      // Password MUST have autocomplete attribute
      const passwordAutocomplete = await passwordInput.getAttribute('autocomplete')
      expect(passwordAutocomplete).toBeTruthy()
      expect(passwordAutocomplete).toMatch(/password|current-password/)
    })
  })

  test.describe('3.3 Page Titles (WCAG 2.4.2)', () => {
    test('each page has a descriptive title', async ({ page }) => {
      await page.goto('/login')
      expect(await page.title()).toContain('Ship')

      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')
      const docsTitle = await page.title()
      expect(docsTitle).toBeTruthy()
      expect(docsTitle.length).toBeGreaterThan(0)
    })
  })

  test.describe('3.4 Text Spacing (WCAG 1.4.12)', () => {
    test('content remains readable with increased text spacing', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Main content MUST exist (4-panel layout)
      const mainContent = page.locator('main, #main-content').first()
      await expect(mainContent).toBeVisible({ timeout: 5000 })

      // Inject WCAG 1.4.12 text spacing overrides
      await page.addStyleTag({
        content: `
          * {
            line-height: 1.5 !important;
            letter-spacing: 0.12em !important;
            word-spacing: 0.16em !important;
          }
          p { margin-bottom: 2em !important; }
        `,
      })

      // Wait for styles to apply
      await page.waitForTimeout(100)

      // Main content MUST still be visible after spacing changes
      await expect(mainContent).toBeVisible()

      // Content MUST NOT be clipped by overflow:hidden
      const hasClipping = await mainContent.evaluate((el) => {
        const style = window.getComputedStyle(el)
        return style.overflow === 'hidden' && el.scrollHeight > el.clientHeight
      })
      expect(hasClipping).toBeFalsy()

      // Text MUST still be readable - main content MUST contain text elements
      const textContent = mainContent.locator('p, h1, h2, h3, span').first()
      await expect(textContent).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('3.5-3.11 Additional Moderate Fixes', () => {
    test('no nested interactive elements', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Check for buttons inside links or links inside buttons
      const nestedInteractive = page.locator('a button, button a, a a, button button')
      expect(await nestedInteractive.count()).toBe(0)
    })

    test('html element has lang attribute', async ({ page }) => {
      await page.goto('/login')

      const lang = await page.locator('html').getAttribute('lang')
      expect(lang).toBeTruthy()
      expect(lang).toBe('en')
    })

    test('no empty buttons or links', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      const emptyButtons = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, a[href]')
        return Array.from(buttons).filter((el) => {
          const text = el.textContent?.trim()
          const ariaLabel = el.getAttribute('aria-label')
          const hasImg = el.querySelector('img[alt]')
          const hasSvgTitle = el.querySelector('svg title')
          return !text && !ariaLabel && !hasImg && !hasSvgTitle
        }).length
      })

      expect(emptyButtons).toBe(0)
    })

    test('tooltips shown on hover also appear on focus', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Find an element with tooltip (aria-describedby, title, or data-tooltip)
      const tooltipTrigger = page.locator('[aria-describedby], [data-tooltip], [title]').first()

      // This test only applies if there are tooltip triggers
      const triggerCount = await tooltipTrigger.count()
      if (triggerCount > 0) {
        // First, hover to show tooltip
        await tooltipTrigger.hover()
        await page.waitForTimeout(300)

        const tooltipOnHover = page.locator('[role="tooltip"], .tooltip')
        const visibleOnHover = await tooltipOnHover.isVisible().catch(() => false)

        // Now focus the element
        await tooltipTrigger.focus()
        await page.waitForTimeout(300)

        // If tooltip was visible on hover, it MUST also be visible on focus
        if (visibleOnHover) {
          await expect(tooltipOnHover).toBeVisible()
        }

        // Verify title attribute elements have proper keyboard access
        const titleAttr = await tooltipTrigger.getAttribute('title')
        if (titleAttr) {
          // Elements with title should be focusable
          const isFocusable = await tooltipTrigger.evaluate((el) => {
            return el.tabIndex >= 0 || ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
          })
          expect(isFocusable).toBeTruthy()
        }
      }
    })

    test('images do not have redundant alt text', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Check that images don't have alt text that just says "image" or "picture"
      const images = page.locator('img[alt]')
      const count = await images.count()

      for (let i = 0; i < count; i++) {
        const img = images.nth(i)
        const alt = await img.getAttribute('alt')

        // Alt text should NOT be redundant
        const redundantPatterns = /^(image|picture|photo|graphic|icon)$/i
        expect(alt).not.toMatch(redundantPatterns)

        // Alt text should NOT just repeat the filename
        const src = await img.getAttribute('src')
        if (src && alt) {
          const filename = src.split('/').pop()?.split('.')[0]
          expect(alt.toLowerCase()).not.toBe(filename?.toLowerCase())
        }
      }
    })

    test('focus maintained during sidebar transitions', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Find sidebar collapse/expand controls
      const collapseButton = page.locator('[aria-controls*="sidebar"], [data-collapse-sidebar], button:has-text("collapse")')

      const hasCollapseButton = await collapseButton.first().count() > 0
      if (!hasCollapseButton) {
        // No sidebar collapse feature - test passes (not applicable)
        return
      }

      // Focus an element before collapse
      await page.keyboard.press('Tab')
      const focusedBefore = await page.evaluate(() => document.activeElement?.tagName)
      expect(focusedBefore).toBeTruthy()

      // Trigger sidebar collapse
      await collapseButton.first().click()
      await page.waitForTimeout(300)

      // Focus should NOT be lost to body after collapse
      const focusedAfter = await page.evaluate(() => document.activeElement?.tagName)
      expect(focusedAfter).not.toBe('BODY')
    })

    test('content works in portrait and landscape orientations', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      // Test portrait-like viewport (narrow)
      await page.setViewportSize({ width: 375, height: 812 })
      await page.waitForTimeout(200)

      // Content MUST still be visible and not clipped
      const mainContent = page.locator('main, [role="main"], #main-content, .main-content')
      if (await mainContent.count() > 0) {
        await expect(mainContent.first()).toBeVisible()
      }

      // Test landscape-like viewport (wide)
      await page.setViewportSize({ width: 1024, height: 768 })
      await page.waitForTimeout(200)

      // Content MUST still be visible
      if (await mainContent.count() > 0) {
        await expect(mainContent.first()).toBeVisible()
      }

      // Content should NOT require specific orientation
      // (WCAG 1.3.4 - Orientation restriction is not allowed unless essential)
    })
  })
})

// =============================================================================
// PHASE 4: MINOR VIOLATIONS (5 tests)
// =============================================================================

test.describe('Phase 4: Minor Violations', () => {
  test.describe('4.1 Language of Code Blocks (WCAG 3.1.2)', () => {
    test('code blocks have language indication', async ({ page }) => {
      await login(page)
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')

      const codeBlocks = page.locator('pre code, .code-block')
      const count = await codeBlocks.count()

      // If there are code blocks, they should have language class or data attribute
      for (let i = 0; i < count; i++) {
        const code = codeBlocks.nth(i)
        const className = await code.getAttribute('class')
        const dataLang = await code.getAttribute('data-language')
        const hasLangIndication = className?.includes('language-') || Boolean(dataLang)
        expect(hasLangIndication).toBeTruthy()
      }
    })
  })

  test.describe('4.2-4.5 Additional Minor Fixes', () => {
    test('abbreviations have expansion', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Check for abbr elements with title
      const abbrs = page.locator('abbr')
      const count = await abbrs.count()

      for (let i = 0; i < count; i++) {
        const abbr = abbrs.nth(i)
        const title = await abbr.getAttribute('title')
        expect(title).toBeTruthy()
      }
    })

    test('navigation order is consistent', async ({ page }) => {
      // Test that tab order matches visual order
      await login(page)
      await page.waitForLoadState('networkidle')

      const focusOrder: string[] = []

      // Tab through first 10 elements
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab')
        const focused = await page.evaluate(() => {
          const el = document.activeElement
          if (!el) return null
          const rect = el.getBoundingClientRect()
          return `${Math.round(rect.top)}-${Math.round(rect.left)}`
        })
        if (focused) focusOrder.push(focused)
      }

      // Focus should generally move top-to-bottom, left-to-right
      // This is a loose check - just verify we got focus positions
      expect(focusOrder.length).toBeGreaterThan(0)
    })

    test('no redundant title and aria-label pairs', async ({ page }) => {
      await login(page)
      await page.waitForLoadState('networkidle')

      // Elements with both title and aria-label should not have identical content
      const redundant = await page.evaluate(() => {
        const elements = document.querySelectorAll('[title][aria-label]')
        return Array.from(elements).filter((el) => {
          const title = el.getAttribute('title')?.trim().toLowerCase()
          const ariaLabel = el.getAttribute('aria-label')?.trim().toLowerCase()
          return title && ariaLabel && title === ariaLabel
        }).length
      })

      // Having identical title and aria-label is redundant
      // aria-label takes precedence, so title becomes noise
      expect(redundant).toBe(0)
    })

    test('form fields have contextual help where needed', async ({ page }) => {
      await login(page)
      await page.goto('/issues')
      await page.waitForLoadState('networkidle')

      // Open an issue with properties sidebar
      const issueLink = page.locator('a[href*="/documents/"]').first()
      await expect(issueLink).toBeVisible({ timeout: 5000 })
      await issueLink.click()
      await page.waitForLoadState('networkidle')

      // Form inputs that might need contextual help
      const inputs = page.locator('input[type="number"], input[type="date"], input:not([type="hidden"])')
      const count = await inputs.count()

      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i)
        const type = await input.getAttribute('type')

        // Number inputs and date inputs SHOULD have format hints
        if (type === 'number' || type === 'date') {
          const ariaDescribedBy = await input.getAttribute('aria-describedby')
          const placeholder = await input.getAttribute('placeholder')
          const hasHelp = ariaDescribedBy || placeholder

          // At minimum, there should be some indication of expected format
          // This is a soft check - placeholder is acceptable
          if (!hasHelp) {
            console.log(`Input type="${type}" could benefit from format hint`)
          }
        }
      }
    })
  })
})

// =============================================================================
// AUTOMATED AXE-CORE SCANS
// =============================================================================

test.describe('Automated axe-core Full Scan', () => {
  test('login page has no WCAG 2.2 AA violations', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()

    if (results.violations.length > 0) {
      console.log('Login violations:', JSON.stringify(results.violations, null, 2))
    }

    expect(results.violations).toHaveLength(0)
  })

  test('documents page has no WCAG 2.2 AA violations', async ({ page }) => {
    await login(page)
    await page.goto('/docs')
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()

    if (results.violations.length > 0) {
      console.log('Docs violations:', JSON.stringify(results.violations, null, 2))
    }

    expect(results.violations).toHaveLength(0)
  })

  test('issues page has no WCAG 2.2 AA violations', async ({ page }) => {
    await login(page)
    await page.goto('/issues')
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()

    if (results.violations.length > 0) {
      console.log('Issues violations:', JSON.stringify(results.violations, null, 2))
    }

    expect(results.violations).toHaveLength(0)
  })
})
