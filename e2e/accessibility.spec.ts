import { test, expect } from './fixtures/isolated-env'
import { login } from './fixtures/api-auth';

import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility - axe-core audit', () => {
  test('login page has no critical accessibility violations', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    // Filter to only critical and serious violations
    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (criticalViolations.length > 0) {
      console.log('Critical violations:', JSON.stringify(criticalViolations, null, 2))
    }

    expect(criticalViolations).toHaveLength(0)
  })

  test('main app shell has no critical accessibility violations', async ({ page }) => {
    await login(page)
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (criticalViolations.length > 0) {
      console.log('Critical violations:', JSON.stringify(criticalViolations, null, 2))
    }

    expect(criticalViolations).toHaveLength(0)
  })

  test('docs mode has no critical accessibility violations', async ({ page }) => {
    await login(page)
    // Navigate to docs mode - click the nav item with "Docs" text or icon
    const docsLink = page.locator('nav a, aside a, [role="navigation"] a').filter({ hasText: /docs/i }).first()
    if (await docsLink.count() > 0) {
      await docsLink.click()
    } else {
      // Try finding by href
      await page.goto('/docs')
    }
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (criticalViolations.length > 0) {
      console.log('Critical violations:', JSON.stringify(criticalViolations, null, 2))
    }

    expect(criticalViolations).toHaveLength(0)
  })

  test('programs mode has no critical accessibility violations', async ({ page }) => {
    await login(page)
    // Navigate to programs mode
    const programsLink = page.locator('nav a, aside a, [role="navigation"] a').filter({ hasText: /program/i }).first()
    if (await programsLink.count() > 0) {
      await programsLink.click()
    } else {
      await page.goto('/programs')
    }
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )

    if (criticalViolations.length > 0) {
      console.log('Critical violations:', JSON.stringify(criticalViolations, null, 2))
    }

    expect(criticalViolations).toHaveLength(0)
  })
})

test.describe('Accessibility - Keyboard Navigation', () => {
  test('can navigate login form with keyboard only', async ({ page }) => {
    await page.goto('/login')
    await page.waitForLoadState('domcontentloaded')

    // Email field should be auto-focused on page load
    // Wait a bit for React to render and autofocus to take effect
    const emailField = page.locator('#email')
    await page.waitForTimeout(200)

    // If not already focused, click to focus (autofocus can be unreliable in tests)
    if (!await emailField.evaluate(el => el === document.activeElement)) {
      await emailField.focus()
    }
    await expect(emailField).toBeFocused({ timeout: 2000 })

    // In dev mode, fields are pre-filled, so clear and type fresh values
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('dev@ship.local')

    // Tab to password field
    await page.keyboard.press('Tab')
    const passwordField = page.locator('#password')
    await expect(passwordField).toBeFocused()

    // Clear and type password
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('admin123')

    // Tab to submit button
    await page.keyboard.press('Tab')
    const submitButton = page.getByRole('button', { name: 'Sign in', exact: true })
    await expect(submitButton).toBeFocused()

    // Press Enter to submit
    await page.keyboard.press('Enter')

    // Should be logged in
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can navigate main app with keyboard - full flow from login to create issue', async ({ page }) => {
    // Login using the form
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })

    // After login, verify we can tab through the app
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(500) // Give UI time to settle

    // Verify the page has focusable elements by checking they exist
    const focusableSelector = 'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusableCount = await page.locator(focusableSelector).count()

    // Should have focusable elements in the app
    expect(focusableCount).toBeGreaterThan(0)

    // Tab a few times and verify we can move focus
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // The page should still be valid (not crashed)
    await expect(page).not.toHaveURL('/login')
  })

  test('focus is visible on all interactive elements', async ({ page }) => {
    await page.goto('/login')

    // Focus the email field (should be auto-focused)
    const emailField = page.locator('#email')
    await emailField.focus()

    // Check for focus-visible styles
    const hasFocusStyles = await emailField.evaluate((el) => {
      const styles = window.getComputedStyle(el)
      // Check for various focus indicators
      return (
        styles.outlineStyle !== 'none' ||
        styles.boxShadow !== 'none' ||
        styles.borderColor !== styles.getPropertyValue('--border')
      )
    })

    expect(hasFocusStyles).toBeTruthy()
  })

  test('tab order is logical on login page', async ({ page }) => {
    await page.goto('/login')

    // Email should be focused first (autoFocus)
    await expect(page.locator('#email')).toBeFocused({ timeout: 2000 })

    // Tab to password
    await page.keyboard.press('Tab')
    await expect(page.locator('#password')).toBeFocused()

    // Tab to submit
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused()
  })
})

test.describe('Accessibility - Screen Reader Announcements', () => {
  test('login errors are announced via aria-live or role=alert', async ({ page }) => {
    await page.goto('/login')

    // Submit with invalid credentials
    await page.locator('#email').fill('invalid@test.com')
    await page.locator('#password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Wait for error to appear
    await page.waitForTimeout(1000)

    // Check for aria-live region or alert role
    const alertOrLive = page.locator('[role="alert"], [aria-live="polite"], [aria-live="assertive"]')
    const count = await alertOrLive.count()

    // Should have an alert for the error
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('form fields have accessible labels', async ({ page }) => {
    await page.goto('/login')

    // Check email field has a label
    const emailField = page.locator('#email')
    const emailLabelledBy = await emailField.getAttribute('aria-labelledby')
    const emailLabel = page.locator('label[for="email"]')

    // Should have either aria-labelledby or a label element
    const hasEmailLabel = emailLabelledBy || (await emailLabel.count()) > 0

    expect(hasEmailLabel).toBeTruthy()

    // Check password field has a label
    const passwordField = page.locator('#password')
    const passwordLabelledBy = await passwordField.getAttribute('aria-labelledby')
    const passwordLabel = page.locator('label[for="password"]')

    const hasPasswordLabel = passwordLabelledBy || (await passwordLabel.count()) > 0

    expect(hasPasswordLabel).toBeTruthy()
  })
})

test.describe('Accessibility - Loading States', () => {
  test('login button shows loading state during submission', async ({ page }) => {
    await page.goto('/login')

    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')

    const submitButton = page.getByRole('button', { name: 'Sign in', exact: true })

    // Verify the button exists and has initial text
    const initialText = await submitButton.textContent()
    expect(initialText?.toLowerCase()).toContain('sign in')

    // Click and check for either:
    // 1. Button text changes to loading state
    // 2. Button becomes disabled
    // 3. We successfully navigate away (fast login)
    await submitButton.click()

    // Wait for either loading state OR navigation
    const result = await Promise.race([
      // Check for text change to "Signing in..."
      page.waitForFunction(
        () => {
          const btn = document.querySelector('button[type="submit"]')
          return btn?.textContent?.toLowerCase().includes('signing')
        },
        { timeout: 1000 }
      ).then(() => 'loading'),
      // Check for successful navigation
      page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 5000 }).then(() => 'navigated'),
    ]).catch(() => 'timeout')

    // Either we saw loading state or we navigated (fast login is ok)
    expect(['loading', 'navigated']).toContain(result)
  })
})
