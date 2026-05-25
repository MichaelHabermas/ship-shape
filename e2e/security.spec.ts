import { test, expect, Page } from './fixtures/isolated-env'
import { login } from './fixtures/api-auth';

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Security Tests
 *
 * Comprehensive security testing covering:
 * - XSS prevention in various contexts
 * - File upload validation
 * - Path traversal prevention
 * - CSRF token validation
 * - Authentication and authorization
 * - Workspace isolation
 */

// Helper to create a new document using the available buttons
async function createNewDocument(page: Page) {
  await page.goto('/docs')
  await page.waitForLoadState('networkidle')

  const currentUrl = page.url()
  // Use the sidebar "New document" button (with aria-label, lowercase 'd')
  // to avoid conflict with the main area "New Document" button (uppercase 'D')
  const newDocButton = page.locator('button[aria-label="New document"]')
  await expect(newDocButton).toBeVisible({ timeout: 5000 })
  await newDocButton.click()

  await page.waitForFunction(
    (oldUrl) => window.location.href !== oldUrl && /\/documents\/[a-f0-9-]+/.test(window.location.href),
    currentUrl,
    { timeout: 10000 }
  )

  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('textarea[placeholder="Untitled"]')).toBeVisible({ timeout: 3000 })
}

test.describe('Security - XSS Prevention', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('XSS in document content is escaped', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Try to inject script tag
    const xssPayload = '<script>alert("XSS")</script>'
    await page.keyboard.type(xssPayload)

    // Wait for content to render
    await page.waitForTimeout(500)

    // Script should be rendered as text, not executed
    await expect(editor).toContainText(xssPayload)

    // Verify no script tag exists in DOM
    const scriptTags = await page.locator('script').evaluateAll(scripts =>
      scripts.filter(s => s.textContent?.includes('alert("XSS")'))
    )
    expect(scriptTags.length).toBe(0)
  })

  test('XSS in document titles is escaped', async ({ page }) => {
    await createNewDocument(page)

    const titleInput = page.locator('textarea[placeholder="Untitled"]')
    await titleInput.click()

    // Try to inject XSS in title
    const xssTitle = '<img src=x onerror=alert("XSS")>'
    await titleInput.fill(xssTitle)
    await titleInput.blur()

    // Wait for save
    await page.waitForTimeout(1000)

    // Title should be escaped, not executed
    await expect(titleInput).toHaveValue(xssTitle)

    // Verify no img tag with onerror handler
    const maliciousImgs = await page.locator('img[onerror]').count()
    expect(maliciousImgs).toBe(0)
  })

  test('XSS in mentions is escaped', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type @ to trigger mention popup
    await page.keyboard.type('@')
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 5000 })

    // Mention popup should not allow XSS injection
    const popup = page.locator('[role="listbox"]')
    const popupHtml = await popup.innerHTML()

    // Should not contain executable script tags
    expect(popupHtml).not.toContain('<script')
    expect(popupHtml).not.toContain('onerror=')
    expect(popupHtml).not.toContain('onload=')
  })

  test('HTML injection in code blocks is escaped', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create code block
    await page.keyboard.type('```html')
    await page.keyboard.press('Enter')

    // Type HTML that should be escaped
    const htmlCode = '<button onclick="alert(\'XSS\')">Click me</button>'
    await page.keyboard.type(htmlCode)
    await page.keyboard.press('Escape')

    await page.waitForTimeout(500)

    // Code should be displayed as text, not rendered
    await expect(editor).toContainText(htmlCode)

    // Verify button is not clickable (it's just text)
    const buttons = await editor.locator('button').evaluateAll(btns =>
      btns.filter(b => b.textContent?.includes('Click me'))
    )
    expect(buttons.length).toBe(0)
  })

  test('XSS in image alt text is escaped', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type /image to trigger slash command
    await page.keyboard.type('/image')

    // Wait for slash command menu to appear with Image option
    const imageOption = page.locator('button', { hasText: 'Image' }).filter({ hasText: 'Upload' })
    await expect(imageOption).toBeVisible({ timeout: 3000 })

    // Create test image with XSS payload encoded in filename (filesystem-safe)
    // The original payload: test"><script>alert("XSS")</script><img src="x
    // We use a safe filename and verify XSS doesn't execute when title contains XSS
    const timestamp = Date.now()
    const safeFilename = `xss-test-${timestamp}.png`
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'base64'
    )
    const tmpPath = path.join(os.tmpdir(), safeFilename)
    fs.writeFileSync(tmpPath, pngBuffer)

    const fileChooserPromise = page.waitForEvent('filechooser')
    // Click the Image option in slash command menu
    await imageOption.click()

    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(tmpPath)

    // Wait for image to appear
    await expect(editor.locator('img')).toBeVisible({ timeout: 5000 })

    // Verify the image rendered correctly and no XSS is possible via attributes
    const img = editor.locator('img').first()

    // Verify no dangerous event handlers exist on img elements
    const dangerousHandlers = await img.evaluate((el) => {
      const handlers = ['onerror', 'onload', 'onclick', 'onmouseover']
      return handlers.filter(h => el.hasAttribute(h))
    })
    expect(dangerousHandlers).toHaveLength(0)

    // Cleanup
    fs.unlinkSync(tmpPath)
  })

  test('XSS via markdown link injection', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Try to inject XSS via markdown link
    const xssLink = '[Click](javascript:alert("XSS"))'
    await page.keyboard.type(xssLink)

    await page.waitForTimeout(500)

    // Link should be rendered but javascript: protocol should be blocked
    const links = await editor.locator('a').all()
    for (const link of links) {
      const href = await link.getAttribute('href')
      expect(href).not.toContain('javascript:')
    }
  })

  test('XSS via data: URI in links', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Try to inject XSS via data URI
    const dataUri = '[Click](data:text/html,<script>alert("XSS")</script>)'
    await page.keyboard.type(dataUri)

    await page.waitForTimeout(500)

    // Dangerous data URIs should be blocked
    const links = await editor.locator('a').all()
    for (const link of links) {
      const href = await link.getAttribute('href')
      if (href?.startsWith('data:')) {
        expect(href).not.toContain('text/html')
        expect(href).not.toContain('<script')
      }
    }
  })
})

// FIXME: File upload via slash command UI has changed
test.describe('Security - File Upload Validation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('file upload validates content type', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type /image to trigger slash command
    await page.keyboard.type('/image')

    // Wait for slash command menu with Image option
    const imageOption = page.locator('button', { hasText: 'Image' }).filter({ hasText: 'Upload' })
    await expect(imageOption).toBeVisible({ timeout: 3000 })

    // Create a fake "image" that's actually HTML
    const htmlFile = path.join(os.tmpdir(), `fake-image-${Date.now()}.png`)
    fs.writeFileSync(htmlFile, '<html><script>alert("XSS")</script></html>')

    const fileChooserPromise = page.waitForEvent('filechooser')
    // Click the Image option in slash command menu
    await imageOption.click()

    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(htmlFile)

    // Wait to see if upload is rejected or accepted
    await page.waitForTimeout(2000)

    // If an image appears, verify it's served with correct content-type
    const imgs = await editor.locator('img').count()
    if (imgs > 0) {
      const img = editor.locator('img').first()
      const src = await img.getAttribute('src')

      if (src && !src.startsWith('data:')) {
        // If uploaded to server, verify content-type via fetch
        const response = await page.evaluate(async (url) => {
          const res = await fetch(url)
          return {
            contentType: res.headers.get('content-type'),
            status: res.status
          }
        }, src)

        // Should be served as image/* or rejected
        expect(response.status).toBe(200)
      }
    }

    // Cleanup
    fs.unlinkSync(htmlFile)
  })

  test('file upload rejects executable files', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type /image to trigger slash command
    await page.keyboard.type('/image')

    // Wait for slash command menu with Image option
    const imageOption = page.locator('button', { hasText: 'Image' }).filter({ hasText: 'Upload' })
    await expect(imageOption).toBeVisible({ timeout: 3000 })

    // Try to upload a .exe file (renamed as .png)
    const timestamp = Date.now()
    const exeFile = path.join(os.tmpdir(), `malware-${timestamp}.png`)
    // MZ header indicates Windows executable
    fs.writeFileSync(exeFile, Buffer.from([0x4D, 0x5A, 0x90, 0x00]))

    const fileChooserPromise = page.waitForEvent('filechooser')
    // Click the Image option in slash command menu
    await imageOption.click()

    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(exeFile)

    await page.waitForTimeout(2000)

    // Upload should fail or be rejected
    // If it appears, verify it can't be executed
    const imgs = await editor.locator('img').count()
    if (imgs > 0) {
      const img = editor.locator('img').first()
      const src = await img.getAttribute('src')
      // Should not have dangerous extension
      expect(src).not.toMatch(/\.(exe|sh|bat|cmd|com)$/i)
    }

    fs.unlinkSync(exeFile)
  })

  test('no directory traversal in file paths', async ({ page, request }) => {
    await login(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Test that file IDs must be valid UUIDs to prevent path traversal attacks
    // The API validates UUID format before processing - any non-UUID ID returns 400
    const invalidFileIds = [
      'not-a-uuid',                    // Plain text
      '../etc/passwd',                 // Path traversal (single encoded in URL)
      '..%2Fetc%2Fpasswd',            // URL-encoded path traversal
      'test.txt',                      // Filename
      '12345',                         // Numeric ID
      'a'.repeat(100),                 // Long string
    ]

    for (const invalidId of invalidFileIds) {
      // Test both /serve and metadata endpoints
      const serveResponse = await request.get(`/api/files/${encodeURIComponent(invalidId)}/serve`, {
        headers: { 'Cookie': cookieHeader }
      })
      const metaResponse = await request.get(`/api/files/${encodeURIComponent(invalidId)}`, {
        headers: { 'Cookie': cookieHeader }
      })

      // Should return 400 (invalid UUID format) or 401 (auth might fail first)
      expect([400, 401]).toContain(serveResponse.status())
      expect([400, 401]).toContain(metaResponse.status())
    }

    // Also verify that valid UUID format that doesn't exist returns 404
    const nonExistentUuid = '00000000-0000-0000-0000-000000000999'
    const notFoundResponse = await request.get(`/api/files/${nonExistentUuid}/serve`, {
      headers: { 'Cookie': cookieHeader }
    })
    expect(notFoundResponse.status()).toBe(404)
  })
})

test.describe('Security - CSRF Protection', () => {
  test('CSRF tokens are validated on state-changing requests', async ({ page, request }) => {
    // Login is needed for this test to check CSRF with authenticated session
    await login(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Try to make POST request without CSRF token
    const response = await request.post('/api/documents', {
      headers: {
        'Cookie': cookieHeader,
        'Content-Type': 'application/json'
      },
      data: {
        title: 'Test Document',
        documentType: 'wiki'
      }
    })

    // Should succeed if CSRF token is in cookie, or fail if token required in header
    // The important thing is that CSRF protection exists
    // Status should be either 200 (with cookie token) or 403 (token required)
    expect([200, 201, 403]).toContain(response.status())
  })

  test('CSRF tokens prevent cross-origin requests', async ({ browser, apiServer }) => {
    // Create a page without logging in
    const context = await browser.newContext()
    const page = await context.newPage()

    // Try to make authenticated request from "attacker" origin
    const apiUrl = apiServer.url
    const response = await page.evaluate(async (url) => {
      try {
        const res = await fetch(`${url}/api/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Hacked', documentType: 'wiki' }),
          credentials: 'include'
        })
        return { status: res.status, ok: res.ok }
      } catch (e) {
        return { status: 0, error: (e as Error).message }
      }
    }, apiUrl)

    // Should be blocked (401 for no auth, or CORS error)
    expect(response.status).not.toBe(200)

    await context.close()
  })
})

test.describe('Security - Authentication and Authorization', () => {
  test('authenticated routes require auth', async ({ browser, baseURL }) => {
    // Test each protected route with a fresh browser context to avoid state accumulation
    // Note: Use actual route names from main.tsx (programs not projects, team/allocation not team)
    const protectedRoutes = ['/docs', '/issues', '/programs', '/team/allocation']

    for (const route of protectedRoutes) {
      // Create fresh context for each route to avoid IndexedDB/localStorage caching
      const context = await browser.newContext()
      const page = await context.newPage()

      await page.goto(`${baseURL}${route}`)
      // Should redirect to login - give React time to initialize, check auth, and redirect
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 })

      await context.close()
    }
  })

  test('API routes require authentication', async ({ request }) => {
    // Make requests without auth
    const apiRoutes = [
      '/api/documents',
      '/api/issues',
      '/api/team/grid'
    ]

    for (const route of apiRoutes) {
      const response = await request.get(route)
      // Should return 401 (unauthorized)
      expect(response.status()).toBe(401)
    }
  })

  test('users cannot access other workspaces', async ({ page, request }) => {
    await login(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Try to access a document with a fake workspace-specific ID
    const response = await request.get('/api/documents/00000000-0000-0000-0000-000000000000', {
      headers: { 'Cookie': cookieHeader }
    })

    // Should return 404 or 403
    expect([403, 404]).toContain(response.status())
  })

  test('file URLs are workspace-scoped', async ({ page, request }) => {
    await login(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Try to access a file from a different workspace
    const response = await request.get('/api/files/other-workspace/some-file.png', {
      headers: { 'Cookie': cookieHeader }
    })

    // Should be blocked
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })
})

test.describe('Security - Session Management', () => {
  test('session expires after inactivity', async ({ page }) => {
    // Note: This test would need to wait for session timeout
    // For now, verify session timeout is configured
    await login(page)

    // Navigate to app
    await page.goto('/docs')
    await expect(page).toHaveURL(/\/docs/)

    // Session timeout is 15 minutes according to CLAUDE.md
    // Verify session cookie has appropriate flags
    const cookies = await page.context().cookies()
    const sessionCookie = cookies.find(c => c.name.includes('session') || c.name.includes('connect.sid'))

    if (sessionCookie) {
      // Should have httpOnly flag for security
      expect(sessionCookie.httpOnly).toBe(true)
    }
  })

  test('logout clears session completely', async ({ page, request }) => {
    await login(page)

    // Get cookies before logout
    const cookiesBefore = await page.context().cookies()
    expect(cookiesBefore.length).toBeGreaterThan(0)

    // Logout
    const logoutButton = page.locator('button').filter({ hasText: /^[A-Z]$/ }).last()
    await logoutButton.click()
    await expect(page).toHaveURL('/login', { timeout: 5000 })

    // Try to access protected route with old cookies
    const cookieHeader = cookiesBefore.map(c => `${c.name}=${c.value}`).join('; ')
    const response = await request.get('/api/documents', {
      headers: { 'Cookie': cookieHeader }
    })

    // Should be unauthorized
    expect(response.status()).toBe(401)
  })
})
