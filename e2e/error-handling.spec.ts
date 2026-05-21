import type { TestInfo } from '@playwright/test'
import { test, expect, Page } from './fixtures/isolated-env'

const CATEGORY_6_ARTIFACT_PREFIX = 'category-6-runtime-evidence'

// Get API URL from environment
const API_URL = process.env.VITE_API_URL || 'http://localhost:3147'

// Helper to login
async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 5000 })
}

function collectPageErrors(page: Page) {
  const errors: string[] = []

  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`)
  })

  return errors
}

async function expectNoPageErrors(errors: string[]) {
  expect(errors, errors.join('\n')).toEqual([])
}

async function captureCategory6Evidence(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: testInfo.outputPath(`${CATEGORY_6_ARTIFACT_PREFIX}-${name}.png`),
    fullPage: true,
  })
}

// Helper to create a new document
async function createNewDocument(page: Page) {
  await page.goto('/docs')
  await page.waitForLoadState('networkidle')

  const currentUrl = page.url()

  // Try sidebar button first, fall back to main "New Document" button
  const sidebarButton = page.locator('aside').getByRole('button', { name: /new|create|\+/i }).first()
  const mainButton = page.getByRole('button', { name: 'New Document', exact: true })

  if (await sidebarButton.isVisible({ timeout: 2000 })) {
    await sidebarButton.click()
  } else {
    await expect(mainButton).toBeVisible({ timeout: 5000 })
    await mainButton.click()
  }

  await page.waitForFunction(
    (oldUrl) => window.location.href !== oldUrl && /\/documents\/[a-f0-9-]+/.test(window.location.href),
    currentUrl,
    { timeout: 10000 }
  )

  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
}

test.describe('Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('handles API 500 error gracefully', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page)
    let documentsRequestFailed = false

    // Intercept API request and return 500 error
    await page.route('**/api/documents', (route) => {
      documentsRequestFailed = true
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      })
    })

    await page.goto('/docs')

    await expect.poll(() => documentsRequestFailed).toBe(true)

    // Page should still be responsive
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Should not show React error boundary
    const errorText = await body.textContent()
    expect(errorText).not.toContain('Something went wrong')
    expect(errorText?.trim().length).toBeGreaterThan(0)

    await captureCategory6Evidence(page, testInfo, 'api-500-documents-list')
    await expectNoPageErrors(pageErrors)
  })

  test('handles network disconnect gracefully', async ({ page, context }, testInfo) => {
    const pageErrors = collectPageErrors(page)

    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type some content while online
    await page.keyboard.type('Online content')
    await expect(editor).toContainText('Online content')

    // Go offline
    await context.setOffline(true)

    // Should still be able to type
    await page.keyboard.type(' Offline content')
    await expect(editor).toContainText('Offline content')

    // Editor should remain functional
    await editor.click()
    await page.keyboard.press('Enter')
    await page.keyboard.type('New line offline')
    await expect(editor).toContainText('New line offline')

    // Go back online
    await context.setOffline(false)

    await captureCategory6Evidence(page, testInfo, 'offline-editor-preserves-draft')
    await expectNoPageErrors(pageErrors)
  })

  test('handles mention search failure gracefully', async ({ page }) => {
    await createNewDocument(page)

    // Intercept mention search API and make it fail
    await page.route('**/api/search/mentions**', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Search failed' }),
      })
    })

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type @ to trigger mention popup
    await page.keyboard.type('@')

    // Wait a moment for API call
    await page.waitForTimeout(1000)

    // Editor should not crash
    await expect(editor).toBeVisible()

    // Should still be able to type
    await page.keyboard.type('test')
    await expect(editor).toContainText('@test')
  })

  test('handles websocket reconnection', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type initial content
    await page.keyboard.type('Before disconnect')
    await expect(editor).toContainText('Before disconnect')

    // Wait for Yjs sync
    await page.waitForTimeout(1000)

    // Simulate websocket disconnect by going offline and back online
    await page.context().setOffline(true)
    await page.waitForTimeout(500)
    await page.context().setOffline(false)

    // Wait for reconnection
    await page.waitForTimeout(2000)

    // Should still be able to type after reconnection
    await editor.click()
    await page.keyboard.type(' After reconnect')
    await expect(editor).toContainText('After reconnect')
  })

  test('editor remains usable after error', async ({ page }) => {
    // Intercept documents API and fail it initially
    let requestCount = 0
    await page.route('**/api/documents', (route) => {
      requestCount++
      if (requestCount === 1) {
        // Fail first request
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Server error' }),
        })
      } else {
        // Let subsequent requests through
        route.continue()
      }
    })

    await page.goto('/docs')
    await page.waitForTimeout(1000)

    // Despite initial error, page should be responsive
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Try to navigate to a different mode
    await page.goto('/issues')
    await page.waitForLoadState('domcontentloaded')

    // Should be able to navigate successfully
    await expect(body).toBeVisible()
  })

  test('handles CSRF token expiration', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page)

    await createNewDocument(page)

    // Intercept API requests and return CSRF error
    const csrfResponses: Array<{ status: number; contentType: string; body: string }> = []
    await page.route('**/api/**', (route) => {
      if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
        csrfResponses.push({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid CSRF token' }),
        })
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid CSRF token' }),
        })
      } else {
        route.continue()
      }
    })

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Try to type (will trigger autosave which needs CSRF)
    await page.keyboard.type('Testing CSRF handling')
    await expect(editor).toContainText('Testing CSRF handling')

    // Editor should remain functional despite CSRF errors
    await page.keyboard.press('Enter')
    await page.keyboard.type('Still working')
    await expect(editor).toContainText('Still working')

    expect(csrfResponses).not.toHaveLength(0)
    for (const response of csrfResponses) {
      expect(response.status).toBe(403)
      expect(response.contentType).toBe('application/json')
      expect(JSON.parse(response.body)).toEqual({ error: 'Invalid CSRF token' })
    }

    await captureCategory6Evidence(page, testInfo, 'csrf-json-editor-usable')
    await expectNoPageErrors(pageErrors)
  })

  test('handles concurrent API errors', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page)

    // Intercept multiple API endpoints and make them all fail
    let failedApiRequests = 0
    await page.route('**/api/**', (route) => {
      failedApiRequests++
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server unavailable' }),
      })
    })

    // Try to load the app
    await page.goto('/docs')
    await expect.poll(() => failedApiRequests).toBeGreaterThan(0)

    // App should not crash, should show some UI
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Should not show unhandled error or blank screen
    const bodyText = await body.textContent()
    expect(bodyText).toBeTruthy()
    expect(bodyText!.length).toBeGreaterThan(0)

    await captureCategory6Evidence(page, testInfo, 'concurrent-api-errors-nonblank')
    await expectNoPageErrors(pageErrors)
  })

  test('recovers from temporary network failure', async ({ page, context }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type while online
    await page.keyboard.type('Online text')
    await expect(editor).toContainText('Online text')

    // Temporarily go offline
    await context.setOffline(true)
    await page.waitForTimeout(1000)

    // Go back online
    await context.setOffline(false)
    await page.waitForTimeout(1000)

    // Should be able to continue working
    await editor.click()
    await page.keyboard.type(' Recovered')
    await expect(editor).toContainText('Recovered')

    // Editor should be fully functional
    await page.keyboard.press('Enter')
    await page.keyboard.type('New line after recovery')
    await expect(editor).toContainText('New line after recovery')
  })
})
