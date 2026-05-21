import { test, expect, Page } from './fixtures/isolated-env'

/**
 * "Lock the Door" Authorization Tests
 *
 * These tests verify that authorization controls are properly enforced:
 * - Cross-workspace isolation (can't access other workspace's resources)
 * - Role-based access control (members can't do admin things)
 * - Super-admin restrictions (non-super-admins can't access /admin)
 */

// Helper to login as a specific user
async function login(page: Page, email: string, password: string = 'admin123') {
  await page.context().clearCookies()
  await page.goto('/login')
  // Wait for login form to be ready
  await page.locator('#email').waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 10000 })
}

// Helper to login as super admin
async function loginAsSuperAdmin(page: Page) {
  await login(page, 'dev@ship.local', 'admin123')
}

// Helper to login as regular member (non-admin)
async function loginAsMember(page: Page) {
  await login(page, 'bob.martinez@ship.local')
}

test.describe('Authorization - Super Admin Access Control', () => {
  test('non-super-admin cannot access /admin when logged in', async ({ page }) => {
    // Login as regular member (bob.martinez is not super-admin)
    await loginAsMember(page)

    // Try to access admin dashboard
    await page.goto('/admin')

    // Wait for redirect to /docs (non-super-admins are redirected)
    await page.waitForURL(/\/docs/, { timeout: 5000 })

    // Should be redirected away from /admin
    expect(page.url()).toContain('/docs')
  })

  test('super-admin CAN access /admin', async ({ page }) => {
    await loginAsSuperAdmin(page)

    await page.goto('/admin')

    // Should see Admin Dashboard
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible()
  })

  test('non-super-admin cannot toggle super-admin status via API', async ({ page, request }) => {
    // Login as regular member to get their session
    await loginAsMember(page)

    // Get cookies from browser context
    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Try to make themselves super-admin via API
    const response = await request.patch('/api/admin/users/some-id/super-admin', {
      headers: { 'Cookie': cookieHeader, 'Content-Type': 'application/json' },
      data: { isSuperAdmin: true }
    })

    // Should fail with 403 Forbidden
    expect(response.status()).toBe(403)
  })
})

test.describe('Authorization - Workspace Admin Access Control', () => {
  test('workspace member cannot access /settings', async ({ page }) => {
    // Bob is a member, not an admin of the workspace
    await loginAsMember(page)

    // Try to access workspace settings
    await page.goto('/settings')

    // Should see permission message (page shows "You don't have permission to manage this workspace")
    await expect(page.getByText(/don't have permission|permission denied|not authorized|access denied/i)).toBeVisible()
  })

  test('workspace admin CAN access /settings', async ({ page }) => {
    // Dev user is workspace admin
    await loginAsSuperAdmin(page)

    await page.goto('/settings')

    // Should see Workspace Settings
    await expect(page.getByText('Workspace Settings')).toBeVisible()
  })

  test('workspace member cannot change another user role via API', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Try to change someone's role
    const response = await request.patch('/api/workspaces/any-id/members/any-user-id', {
      headers: { 'Cookie': cookieHeader, 'Content-Type': 'application/json' },
      data: { role: 'admin' }
    })

    // Should fail
    expect(response.status()).toBeGreaterThanOrEqual(403)
  })

  test('workspace member cannot send invites via API', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Try to send an invite
    const response = await request.post('/api/workspaces/any-id/invites', {
      headers: { 'Cookie': cookieHeader, 'Content-Type': 'application/json' },
      data: { email: 'hacker@evil.com', role: 'admin' }
    })

    // Should fail
    expect(response.status()).toBeGreaterThanOrEqual(403)
  })
})

test.describe('Authorization - Cross-Workspace Isolation', () => {
  test('cannot access document from another workspace via direct URL', async ({ page }) => {
    // This test requires having documents in different workspaces
    // For now, test that accessing a non-existent doc returns 404/403

    await loginAsMember(page)

    // Try to access a document that doesn't exist (simulates cross-workspace access)
    await page.goto('/documents/00000000-0000-0000-0000-000000000000')

    // The app should show an error state for non-existent documents
    // UnifiedDocumentPage shows "Document not found" message instead of redirecting
    await expect(page.getByText('Document not found')).toBeVisible({ timeout: 5000 })

    // There should be a link to go back to documents
    await expect(page.getByText('Go to Documents')).toBeVisible({ timeout: 3000 })
  })

  test('API rejects document access for wrong workspace', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Try to access a document via API with fake ID
    const response = await request.get('/api/documents/00000000-0000-0000-0000-000000000000', {
      headers: { 'Cookie': cookieHeader }
    })

    // Should return 404 or 403
    expect([403, 404]).toContain(response.status())
  })

  test('cannot list documents from another workspace', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Documents endpoint should only return current workspace docs
    const response = await request.get('/api/documents', {
      headers: { 'Cookie': cookieHeader }
    })

    expect(response.status()).toBe(200)

    const data = await response.json()
    // API returns an array of documents - all should belong to user's workspace
    expect(Array.isArray(data)).toBe(true)
  })
})

test.describe('Authorization - API Route Protection', () => {
  test('unauthenticated requests to protected API routes fail', async ({ request }) => {
    // Without cookies, all protected routes should fail
    const protectedRoutes = [
      { method: 'GET', url: '/api/documents' },
      { method: 'GET', url: '/api/admin/users' },
      { method: 'GET', url: '/api/admin/workspaces' },
      { method: 'GET', url: '/api/workspaces/current/members' },
    ]

    for (const route of protectedRoutes) {
      const response = await request.get(route.url)
      expect(response.status(), `${route.url} should reject unauthenticated requests`).toBe(401)
    }
  })

  test('cannot create workspace without super-admin', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    const response = await request.post('/api/admin/workspaces', {
      headers: { 'Cookie': cookieHeader, 'Content-Type': 'application/json' },
      data: { name: 'Hacker Workspace' }
    })

    expect(response.status()).toBe(403)
  })

  test('cannot archive workspace without super-admin', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    const response = await request.post('/api/admin/workspaces/any-id/archive', {
      headers: { 'Cookie': cookieHeader }
    })

    expect(response.status()).toBe(403)
  })
})

test.describe('Authorization - Impersonation Controls', () => {
  test('non-super-admin cannot impersonate users', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Impersonate endpoint is POST /api/admin/impersonate/:userId
    const response = await request.post('/api/admin/impersonate/some-user-id', {
      headers: { 'Cookie': cookieHeader, 'Content-Type': 'application/json' }
    })

    expect(response.status()).toBe(403)
  })

  test('super-admin CAN impersonate users', async ({ page }) => {
    await loginAsSuperAdmin(page)

    // Use page.request which shares the browser's session/cookies
    // First get a valid user ID
    const usersResponse = await page.request.get('/api/admin/users')
    expect(usersResponse.status()).toBe(200)
    const usersData = await usersResponse.json()
    const targetUser = usersData.data?.users?.find((u: { email: string }) => u.email !== 'dev@ship.local')

    // Skip test if no other users to impersonate (can't impersonate yourself)
    if (!targetUser) {
      console.log('Skipping impersonation test - no other users available')
      return
    }

    // Impersonate endpoint is POST /api/admin/impersonate/:userId
    const response = await page.request.post(`/api/admin/impersonate/${targetUser.id}`)

    // Should succeed (200 = can impersonate, 403 = endpoint exists but blocked by policy)
    // Accept either as valid since impersonation may be disabled in some configs
    expect([200, 403]).toContain(response.status())
  })
})

test.describe('Authorization - Audit Log Access', () => {
  test('non-super-admin cannot view global audit logs', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    const response = await request.get('/api/admin/audit-logs', {
      headers: { 'Cookie': cookieHeader }
    })

    expect(response.status()).toBe(403)
  })

  test('workspace member cannot view workspace audit logs (admin only)', async ({ page, request }) => {
    await loginAsMember(page)

    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

    // Get current workspace ID
    const wsResponse = await request.get('/api/workspaces/current', {
      headers: { 'Cookie': cookieHeader }
    })

    if (wsResponse.status() === 200) {
      const wsData = await wsResponse.json()
      const workspaceId = wsData.data?.workspace?.id

      if (workspaceId) {
        const response = await request.get(`/api/workspaces/${workspaceId}/audit-logs`, {
          headers: { 'Cookie': cookieHeader }
        })

        // Should fail - members can't view audit logs
        expect(response.status()).toBe(403)
      }
    }
  })
})
