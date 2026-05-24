import type { TestInfo } from '@playwright/test'
import { test, expect, Page } from './fixtures/isolated-env'

const CATEGORY_6_ARTIFACT_PREFIX = 'category-6-runtime-evidence'

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
  const body = page.locator('body')
  await expect(body).toBeVisible()

  const bodyText = (await body.textContent())?.trim() ?? ''
  expect(bodyText, 'Category 6 runtime evidence must capture a nonblank UI').not.toHaveLength(0)
  expect(bodyText).not.toContain('Something went wrong')

  await page.screenshot({
    path: testInfo.outputPath(`${CATEGORY_6_ARTIFACT_PREFIX}-${name}-viewport.png`),
    animations: 'disabled',
  })
  await page.screenshot({
    path: testInfo.outputPath(`${CATEGORY_6_ARTIFACT_PREFIX}-${name}-fullpage.png`),
    fullPage: true,
    animations: 'disabled',
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
    await page.goto('/docs')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()

    let searchRequestFailed = false

    await page.route('**/api/search/content**', (route) => {
      searchRequestFailed = true
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      })
    })

    await page.getByRole('textbox', { name: 'Search documents' }).fill('runtime proof')

    await expect.poll(() => searchRequestFailed).toBe(true)
    await expect(page.getByRole('alert')).toContainText('Search unavailable')

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const errorText = await body.textContent()
    expect(errorText).not.toContain('Something went wrong')
    expect(errorText?.trim().length).toBeGreaterThan(0)

    await captureCategory6Evidence(page, testInfo, 'api-500-documents-list')
    await expectNoPageErrors(pageErrors)
  })

  test('error boundary contains route render failures', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page)

    await page.goto('/__cat6/error-boundary')

    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByText('Something went wrong')).toBeVisible()
    await expect(page.getByText('An unexpected error occurred while rendering this section.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Docs' })).toBeVisible()

    await page.screenshot({
      path: testInfo.outputPath(`${CATEGORY_6_ARTIFACT_PREFIX}-error-boundary-route-viewport.png`),
      animations: 'disabled',
    })
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
    await page.route('**/api/documents**', (route) => {
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

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Try to type (will trigger autosave which needs CSRF)
    await page.keyboard.type('Testing CSRF handling')
    await expect(editor).toContainText('Testing CSRF handling')

    // Editor should remain functional despite CSRF errors
    await page.keyboard.press('Enter')
    await page.keyboard.type('Still working')
    await expect(editor).toContainText('Still working')

    const documentId = page.url().match(/\/documents\/([a-f0-9-]+)/)?.[1]
    expect(documentId).toBeTruthy()
    const csrfResponse = await page.evaluate(async (id) => {
      const response = await fetch(`/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'CSRF failure probe' }),
      })
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: await response.json(),
      }
    }, documentId)

    expect(csrfResponse.status).toBe(403)
    expect(csrfResponse.contentType).toContain('application/json')
    expect(csrfResponse.body).toEqual({ error: 'Invalid or missing CSRF token' })

    await captureCategory6Evidence(page, testInfo, 'csrf-json-editor-usable')
    await expectNoPageErrors(pageErrors)
  })

  test('handles concurrent API errors', async ({ page }, testInfo) => {
    const pageErrors = collectPageErrors(page)
    await page.goto('/docs')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()

    let failedApiRequests = 0
    await page.route('**/api/search/content**', (route) => {
      failedApiRequests++
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server unavailable' }),
      })
    })

    await page.getByRole('textbox', { name: 'Search documents' }).fill('concurrent failure')
    await expect.poll(() => failedApiRequests).toBeGreaterThan(0)
    await expect(page.getByRole('alert')).toContainText('Search unavailable')

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const bodyText = await body.textContent()
    expect(bodyText).toBeTruthy()
    expect(bodyText!.length).toBeGreaterThan(0)
    expect(bodyText).not.toContain('Sign in')

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
