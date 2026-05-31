import { test, expect } from './fixtures/isolated-env'
import { loginAsSuperAdmin, loginAsMember, getCsrfToken, login } from './fixtures/api-auth';
import { readJsonAs } from './fixtures/typed-json';
import type { BulkIssueUpdateResponse } from './fixtures/e2e-api-types';

import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

/**
 * "Lock the Door" Authorization Tests
 *
 * These tests verify that authorization controls are properly enforced:
 * - Cross-workspace isolation (can't access other workspace's resources)
 * - Role-based access control (members can't do admin things)
 * - Super-admin restrictions (non-super-admins can't access /admin)
 */

async function seedWorkspaceBoundaryCase(dbPool: Pool) {
  const uniqueId = randomUUID()
  const users = await dbPool.query(
    `SELECT id, email, password_hash
     FROM users
     WHERE email = 'dev@ship.local'`
  )

  const devUser = users.rows.find((user: { email: string }) => user.email === 'dev@ship.local')
  expect(devUser).toBeTruthy()

  const ownedWorkspace = await dbPool.query(
    `INSERT INTO workspaces (name, sprint_start_date)
     VALUES ($1, CURRENT_DATE)
     RETURNING id`,
    [`Owned Boundary Workspace ${uniqueId}`]
  )
  const ownedWorkspaceId = ownedWorkspace.rows[0].id as string

  const ownedEmail = `owned-${uniqueId}@ship.local`
  const ownedUser = await dbPool.query(
    `INSERT INTO users (email, password_hash, name, last_workspace_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [ownedEmail, devUser.password_hash, 'Owned Boundary User', ownedWorkspaceId]
  )
  const ownedUserId = ownedUser.rows[0].id as string

  await dbPool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'member')`,
    [ownedWorkspaceId, ownedUserId]
  )

  await dbPool.query(
    `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
     VALUES ($1, 'person', $2, $3, $4)`,
    [
      ownedWorkspaceId,
      'Owned Boundary User',
      JSON.stringify({ user_id: ownedUserId, email: ownedEmail }),
      ownedUserId,
    ]
  )

  const foreignWorkspace = await dbPool.query(
    `INSERT INTO workspaces (name, sprint_start_date)
     VALUES ($1, CURRENT_DATE)
     RETURNING id`,
    [`Foreign Workspace ${uniqueId}`]
  )
  const foreignWorkspaceId = foreignWorkspace.rows[0].id as string

  const foreignUser = await dbPool.query(
    `INSERT INTO users (email, password_hash, name, last_workspace_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [`foreign-${uniqueId}@ship.local`, devUser.password_hash, 'Foreign User', foreignWorkspaceId]
  )
  const foreignUserId = foreignUser.rows[0].id as string

  await dbPool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'admin')`,
    [foreignWorkspaceId, foreignUserId]
  )

  const ownedIssue = await dbPool.query(
    `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, created_by)
     VALUES ($1, 'issue', $2, $3, 9701, $4)
     RETURNING id`,
    [
      ownedWorkspaceId,
      'Owned boundary issue',
      JSON.stringify({ state: 'todo', priority: 'medium', source: 'manual' }),
      ownedUserId,
    ]
  )

  const foreignDoc = await dbPool.query(
    `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
     VALUES ($1, 'wiki', $2, $3, $4)
     RETURNING id`,
    [
      foreignWorkspaceId,
      'Foreign boundary document',
      JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hidden' }] }] }),
      foreignUserId,
    ]
  )

  const foreignIssue = await dbPool.query(
    `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, created_by)
     VALUES ($1, 'issue', $2, $3, 9702, $4)
     RETURNING id`,
    [
      foreignWorkspaceId,
      'Foreign boundary issue',
      JSON.stringify({ state: 'todo', priority: 'high', source: 'manual' }),
      foreignUserId,
    ]
  )

  return {
    ownedEmail,
    ownedWorkspaceId,
    ownedIssueId: ownedIssue.rows[0].id as string,
    foreignWorkspaceId,
    foreignDocId: foreignDoc.rows[0].id as string,
    foreignIssueId: foreignIssue.rows[0].id as string,
  }
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

  test('non-super-admin cannot toggle super-admin status via API', async ({ page }) => {
    // Login as regular member to get their session
    await loginAsMember(page)
    const csrfToken = await getCsrfToken(page)

    // Try to make themselves super-admin via API
    const response = await page.request.patch('/api/admin/users/some-id/super-admin', {
      headers: { 'x-csrf-token': csrfToken },
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

  test('workspace member cannot change another user role via API', async ({ page }) => {
    await loginAsMember(page)
    const csrfToken = await getCsrfToken(page)

    // Try to change someone's role
    const response = await page.request.patch('/api/workspaces/any-id/members/any-user-id', {
      headers: { 'x-csrf-token': csrfToken },
      data: { role: 'admin' }
    })

    // Should fail
    expect(response.status()).toBeGreaterThanOrEqual(403)
  })

  test('workspace member cannot send invites via API', async ({ page }) => {
    await loginAsMember(page)
    const csrfToken = await getCsrfToken(page)

    // Try to send an invite
    const response = await page.request.post('/api/workspaces/any-id/invites', {
      headers: { 'x-csrf-token': csrfToken },
      data: { email: 'hacker@evil.com', role: 'admin' }
    })

    // Should fail
    expect(response.status()).toBeGreaterThanOrEqual(403)
  })
})

test.describe('Authorization - Cross-Workspace Isolation', () => {
  test('cannot access document from another workspace via direct URL', async ({ page, dbPool }) => {
    const boundary = await seedWorkspaceBoundaryCase(dbPool)
    await login(page, boundary.ownedEmail)

    await page.goto(`/documents/${boundary.foreignDocId}`)

    await expect(page.getByText('Document not found')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Go to Documents')).toBeVisible({ timeout: 3000 })
  })

  test('API rejects real foreign document and issue access', async ({ page, dbPool }) => {
    const boundary = await seedWorkspaceBoundaryCase(dbPool)
    await login(page, boundary.ownedEmail)

    const documentResponse = await page.request.get(`/api/documents/${boundary.foreignDocId}`)
    expect([403, 404]).toContain(documentResponse.status())

    const issueResponse = await page.request.get(`/api/issues/${boundary.foreignIssueId}`)
    expect(issueResponse.status()).toBe(404)
  })

  test('bulk issue updates mutate owned IDs only and report foreign IDs as failed', async ({ page, dbPool }) => {
    const boundary = await seedWorkspaceBoundaryCase(dbPool)
    await login(page, boundary.ownedEmail)

    const csrfToken = await getCsrfToken(page)

    const response = await page.request.post('/api/issues/bulk', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        ids: [boundary.ownedIssueId, boundary.foreignIssueId],
        action: 'update',
        updates: { state: 'in_progress' },
      },
    })

    expect(response.status()).toBe(200)
    const data = await readJsonAs<BulkIssueUpdateResponse>(response)
    expect(data.updated.map((issue) => issue.id)).toEqual([boundary.ownedIssueId])
    expect(data.failed).toContainEqual({ id: boundary.foreignIssueId, error: 'Issue not found' })

    const states = await dbPool.query(
      `SELECT id, properties->>'state' AS state
       FROM documents
       WHERE id = ANY($1)`,
      [[boundary.ownedIssueId, boundary.foreignIssueId]]
    )
    const stateById = Object.fromEntries(
      states.rows.map((row: { id: string; state: string }) => [row.id, row.state])
    )
    expect(stateById[boundary.ownedIssueId]).toBe('in_progress')
    expect(stateById[boundary.foreignIssueId]).toBe('todo')
  })

  test('cannot list documents from another workspace', async ({ page, dbPool }) => {
    const boundary = await seedWorkspaceBoundaryCase(dbPool)
    await login(page, boundary.ownedEmail)

    const response = await page.request.get('/api/documents')
    expect(response.status()).toBe(200)

    const data = await readJsonAs<Array<{ id: string }>>(response)
    expect(Array.isArray(data)).toBe(true)
    expect(data.some((doc) => doc.id === boundary.foreignDocId)).toBe(false)
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

  test('cannot create workspace without super-admin', async ({ page }) => {
    await loginAsMember(page)
    const csrfToken = await getCsrfToken(page)

    const response = await page.request.post('/api/admin/workspaces', {
      headers: { 'x-csrf-token': csrfToken },
      data: { name: 'Hacker Workspace' }
    })

    expect(response.status()).toBe(403)
  })

  test('cannot archive workspace without super-admin', async ({ page }) => {
    await loginAsMember(page)
    const csrfToken = await getCsrfToken(page)

    const response = await page.request.post('/api/admin/workspaces/any-id/archive', {
      headers: { 'x-csrf-token': csrfToken }
    })

    expect(response.status()).toBe(403)
  })
})

test.describe('Authorization - Impersonation Controls', () => {
  test('non-super-admin cannot impersonate users', async ({ page }) => {
    await loginAsMember(page)
    const csrfToken = await getCsrfToken(page)

    // Impersonate endpoint is POST /api/admin/impersonate/:userId
    const response = await page.request.post('/api/admin/impersonate/some-user-id', {
      headers: { 'x-csrf-token': csrfToken }
    })

    expect(response.status()).toBe(403)
  })

  test('super-admin CAN impersonate users', async ({ page }) => {
    await loginAsSuperAdmin(page)

    // Use page.request which shares the browser's session/cookies
    // First get a valid user ID
    const usersResponse = await page.request.get('/api/admin/users')
    expect(usersResponse.status()).toBe(200)
    const usersData = await readJsonAs<{ data?: { users?: Array<{ id: string; email: string }> } }>(usersResponse)
    const targetUser = usersData.data?.users?.find((u) => u.email !== 'dev@ship.local')
    expect(targetUser).toBeTruthy()
    if (!targetUser) {
      throw new Error('Expected a non-dev user for impersonation test');
    }
    const csrfToken = await getCsrfToken(page)

    // Impersonate endpoint is POST /api/admin/impersonate/:userId
    const response = await page.request.post(`/api/admin/impersonate/${targetUser.id}`, {
      headers: { 'x-csrf-token': csrfToken }
    })

    expect(response.status()).toBe(200)
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
