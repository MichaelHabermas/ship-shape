import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { WorkspaceListResponseSchema } from '../openapi/schemas/workspaces.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'

describe('Workspaces API', () => {
  const app = createApp()
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testUserEmail = `ws-user-${testRunId}@ship.local`
  const superAdminEmail = `ws-admin-${testRunId}@ship.local`
  const testWorkspaceName = `Workspaces Test ${testRunId}`

  let sessionCookie: string
  let superAdminSessionCookie: string
  let csrfToken: string
  let superAdminCsrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let superAdminUserId: string

  // Setup: Create test users and sessions
  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create regular test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Test User')
       RETURNING id`,
      [testUserEmail]
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership for regular user
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create session for regular user (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    // Create super admin user
    const superAdminResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, is_super_admin)
       VALUES ($1, 'test-hash', 'Super Admin', true)
       RETURNING id`,
      [superAdminEmail]
    )
    superAdminUserId = superAdminResult.rows[0].id

    // Create workspace membership for super admin
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, superAdminUserId]
    )

    // Create session for super admin (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
    const superSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [superSessionId, superAdminUserId, testWorkspaceId]
    )
    superAdminSessionCookie = `session_id=${superSessionId}`

    // Get CSRF token for regular user
    const csrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie)
    csrfToken = csrfRes.body.token
    const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (connectSidCookie) {
      sessionCookie = `${sessionCookie}; ${connectSidCookie}`
    }

    // Get CSRF token for super admin
    const superCsrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', superAdminSessionCookie)
    superAdminCsrfToken = superCsrfRes.body.token
    const superConnectSidCookie = superCsrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (superConnectSidCookie) {
      superAdminSessionCookie = `${superAdminSessionCookie}; ${superConnectSidCookie}`
    }
  })

  // Cleanup after all tests
  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, superAdminUserId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, superAdminUserId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, superAdminUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('GET /api/workspaces', () => {
    it('should return user workspaces when authenticated', async () => {
      const response = await request(app)
        .get('/api/workspaces')
        .set('Cookie', sessionCookie)

      const listed = expectOpenApiResponse({
        method: 'get',
        path: '/workspaces',
        status: 200,
        response,
        openApiSchemaName: 'WorkspaceListResponse',
        schema: WorkspaceListResponseSchema,
      })
      expect(listed.data.workspaces.length).toBeGreaterThan(0)
      expect(listed.data.workspaces[0]).toHaveProperty('id')
      expect(listed.data.workspaces[0]).toHaveProperty('name')
      expect(listed.data.workspaces[0]).toHaveProperty('role')
    })

    it('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/api/workspaces')

      expect(response.status).toBe(401)
      expect(response.body.success).toBe(false)
      expect(response.body.error).toHaveProperty('message')
    })
  })

  describe('GET /api/workspaces/current', () => {
    it('should return current workspace', async () => {
      const response = await request(app)
        .get('/api/workspaces/current')
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.workspace).toHaveProperty('id')
      expect(response.body.data.workspace).toHaveProperty('name')
    })
  })

  describe('POST /api/workspaces/:id/switch', () => {
    it('should switch to a workspace user is member of', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/switch`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data.workspaceId).toBe(testWorkspaceId)
    })

    it('should return 403 when switching to workspace user is not member of', async () => {
      // Create another workspace
      const otherWorkspaceResult = await pool.query(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace') RETURNING id`
      )
      const otherWorkspaceId = otherWorkspaceResult.rows[0].id

      const response = await request(app)
        .post(`/api/workspaces/${otherWorkspaceId}/switch`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(403)

      // Cleanup
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId])
    })
  })

  describe('Workspace Members API', () => {
    it('GET /api/workspaces/:id/members should return members', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/members`)
        .set('Cookie', superAdminSessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.members)).toBe(true)
    })

    it('should require admin role to manage members', async () => {
      // Regular member tries to get members
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/members`)
        .set('Cookie', sessionCookie)

      // Should be 403 for non-admins
      expect(response.status).toBe(403)
    })
  })

  describe('Workspace Invites API', () => {
    let inviteId: string

    it('POST /api/workspaces/:id/invites should create invite', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/invites`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ email: 'new-user@test.com', role: 'member' })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.invite).toHaveProperty('id')
      expect(response.body.data.invite).toHaveProperty('email', 'new-user@test.com')
      expect(response.body.data.invite).toHaveProperty('token')
      inviteId = response.body.data.invite.id
    })

    it('GET /api/workspaces/:id/invites should return invites', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/invites`)
        .set('Cookie', superAdminSessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.invites)).toBe(true)
    })

    it('DELETE /api/workspaces/:id/invites/:inviteId should revoke invite', async () => {
      if (!inviteId) {
        // Create invite first if not created
        const createResponse = await request(app)
          .post(`/api/workspaces/${testWorkspaceId}/invites`)
          .set('Cookie', superAdminSessionCookie)
          .set('x-csrf-token', superAdminCsrfToken)
          .send({ email: 'revoke-test@test.com', role: 'member' })
        inviteId = createResponse.body.data.invite.id
      }

      const response = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/invites/${inviteId}`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })

    it('POST /api/workspaces/:id/invites should create pending person document', async () => {
      const testEmail = 'pending-person-test@test.com'

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/invites`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ email: testEmail, role: 'member' })

      expect(response.status).toBe(201)
      const newInviteId = response.body.data.invite.id

      // Verify pending person document was created
      const personResult = await pool.query(
        `SELECT * FROM documents
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'invite_id' = $2`,
        [testWorkspaceId, newInviteId]
      )

      expect(personResult.rows.length).toBe(1)
      expect(personResult.rows[0].title).toBe('pending-person-test') // email prefix
      expect(personResult.rows[0].properties.pending).toBe(true)
      expect(personResult.rows[0].properties.email).toBe(testEmail)
      expect(personResult.rows[0].properties.invite_id).toBe(newInviteId)
    })

    it('DELETE /api/workspaces/:id/invites/:inviteId should archive person document', async () => {
      const testEmail = 'archive-person-test@test.com'

      // Create invite (which creates pending person doc)
      const createResponse = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/invites`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ email: testEmail, role: 'member' })

      const archiveInviteId = createResponse.body.data.invite.id

      // Verify person doc exists and is not archived
      const beforeResult = await pool.query(
        `SELECT * FROM documents
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'invite_id' = $2`,
        [testWorkspaceId, archiveInviteId]
      )
      expect(beforeResult.rows.length).toBe(1)
      expect(beforeResult.rows[0].archived_at).toBeNull()

      // Revoke invite
      await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/invites/${archiveInviteId}`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)

      // Verify person doc is now archived
      const afterResult = await pool.query(
        `SELECT * FROM documents
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'invite_id' = $2`,
        [testWorkspaceId, archiveInviteId]
      )
      expect(afterResult.rows.length).toBe(1)
      expect(afterResult.rows[0].archived_at).not.toBeNull()
    })

    // Cleanup after invite tests
    afterAll(async () => {
      await pool.query('DELETE FROM workspace_invites WHERE workspace_id = $1', [testWorkspaceId])
      await pool.query(`DELETE FROM documents WHERE workspace_id = $1 AND document_type = 'person' AND properties->>'invite_id' IS NOT NULL`, [testWorkspaceId])
    })
  })

  describe('Workspace Audit Logs API', () => {
    it('GET /api/workspaces/:id/audit-logs should return audit logs', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/audit-logs`)
        .set('Cookie', superAdminSessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.logs)).toBe(true)
    })

    it('should require admin role to view audit logs', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/audit-logs`)
        .set('Cookie', sessionCookie)

      // Non-admin should get 403
      expect(response.status).toBe(403)
    })
  })
})

describe('Admin API', () => {
  const app = createApp()
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const superAdminEmail = `admin-${testRunId}@ship.local`
  const regularEmail = `regular-${testRunId}@ship.local`
  const testWorkspaceName = `Admin Test ${testRunId}`

  let superAdminSessionCookie: string
  let regularSessionCookie: string
  let superAdminCsrfToken: string
  let regularCsrfToken: string
  let superAdminUserId: string
  let regularUserId: string
  let testWorkspaceId: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create super admin user
    const superAdminResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, is_super_admin)
       VALUES ($1, 'test-hash', 'Admin Test', true)
       RETURNING id`,
      [superAdminEmail]
    )
    superAdminUserId = superAdminResult.rows[0].id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, superAdminUserId]
    )

    // sessions.id is TEXT not UUID, generated from crypto.randomBytes
    const superSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [superSessionId, superAdminUserId, testWorkspaceId]
    )
    superAdminSessionCookie = `session_id=${superSessionId}`

    // Create regular user
    const regularResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Regular Test')
       RETURNING id`,
      [regularEmail]
    )
    regularUserId = regularResult.rows[0].id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, regularUserId]
    )

    // sessions.id is TEXT not UUID, generated from crypto.randomBytes
    const regularSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [regularSessionId, regularUserId, testWorkspaceId]
    )
    regularSessionCookie = `session_id=${regularSessionId}`

    // Get CSRF token for super admin
    const superCsrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', superAdminSessionCookie)
    superAdminCsrfToken = superCsrfRes.body.token
    const superConnectSidCookie = superCsrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (superConnectSidCookie) {
      superAdminSessionCookie = `${superAdminSessionCookie}; ${superConnectSidCookie}`
    }

    // Get CSRF token for regular user
    const regularCsrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', regularSessionCookie)
    regularCsrfToken = regularCsrfRes.body.token
    const regularConnectSidCookie = regularCsrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (regularConnectSidCookie) {
      regularSessionCookie = `${regularSessionCookie}; ${regularConnectSidCookie}`
    }
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [superAdminUserId, regularUserId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [superAdminUserId, regularUserId])
    await pool.query('DELETE FROM audit_logs WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspaces WHERE name LIKE $1', ['Admin Created%'])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [superAdminUserId, regularUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('GET /api/admin/workspaces', () => {
    it('should return all workspaces for super admin', async () => {
      const response = await request(app)
        .get('/api/admin/workspaces')
        .set('Cookie', superAdminSessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.workspaces)).toBe(true)
    })

    it('should return 403 for non-super-admin', async () => {
      const response = await request(app)
        .get('/api/admin/workspaces')
        .set('Cookie', regularSessionCookie)

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/admin/workspaces', () => {
    it('should create workspace for super admin', async () => {
      const response = await request(app)
        .post('/api/admin/workspaces')
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ name: 'Admin Created Workspace' })

      expect(response.status).toBe(201)
      expect(response.body.success).toBe(true)
      expect(response.body.data.workspace).toHaveProperty('id')
      expect(response.body.data.workspace).toHaveProperty('name', 'Admin Created Workspace')
    })

    it('should return 403 for non-super-admin', async () => {
      const response = await request(app)
        .post('/api/admin/workspaces')
        .set('Cookie', regularSessionCookie)
        .set('x-csrf-token', regularCsrfToken)
        .send({ name: 'Should Fail' })

      expect(response.status).toBe(403)
    })
  })

  describe('GET /api/admin/users', () => {
    it('should return all users for super admin', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Cookie', superAdminSessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.users)).toBe(true)
    })

    it('should return 403 for non-super-admin', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Cookie', regularSessionCookie)

      expect(response.status).toBe(403)
    })
  })

  describe('GET /api/admin/audit-logs', () => {
    it('should return global audit logs for super admin', async () => {
      const response = await request(app)
        .get('/api/admin/audit-logs')
        .set('Cookie', superAdminSessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(Array.isArray(response.body.data.logs)).toBe(true)
    })

    it('should return 403 for non-super-admin', async () => {
      const response = await request(app)
        .get('/api/admin/audit-logs')
        .set('Cookie', regularSessionCookie)

      expect(response.status).toBe(403)
    })
  })
})

describe('Invite Validation API', () => {
  const app = createApp()
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `invite-admin-${testRunId}@ship.local`
  const testWorkspaceName = `Invite Test ${testRunId}`
  const validTokenSuffix = `valid-${testRunId}`
  const expiredTokenSuffix = `expired-${testRunId}`

  let testWorkspaceId: string
  let testUserId: string
  let validInviteToken: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user (admin)
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, is_super_admin)
       VALUES ($1, 'test-hash', 'Invite Admin', true)
       RETURNING id`,
      [testEmail]
    )
    testUserId = userResult.rows[0].id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, testUserId]
    )

    // sessions.id is TEXT not UUID, generated from crypto.randomBytes
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    // Create a valid invite with unique token
    const inviteResult = await pool.query(
      `INSERT INTO workspace_invites (workspace_id, email, role, invited_by_user_id, token, expires_at)
       VALUES ($1, $2, 'member', $3, $4, now() + interval '7 days')
       RETURNING token`,
      [testWorkspaceId, `invited-${testRunId}@test.com`, testUserId, validTokenSuffix]
    )
    validInviteToken = inviteResult.rows[0].token
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM workspace_invites WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('GET /api/invites/:token', () => {
    it('should return invite info for valid token', async () => {
      const response = await request(app).get(`/api/invites/${validInviteToken}`)

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveProperty('email', `invited-${testRunId}@test.com`)
      expect(response.body.data).toHaveProperty('workspaceName')
      expect(response.body.data).toHaveProperty('role', 'member')
    })

    it('should return 404 for invalid token', async () => {
      const response = await request(app).get('/api/invites/invalid-token-12345')

      expect(response.status).toBe(404)
    })

    it('should return 400 for expired token', async () => {
      // Create expired invite with unique token
      await pool.query(
        `INSERT INTO workspace_invites (workspace_id, email, role, invited_by_user_id, token, expires_at)
         VALUES ($1, $2, 'member', $3, $4, now() - interval '1 day')`,
        [testWorkspaceId, `expired-${testRunId}@test.com`, testUserId, expiredTokenSuffix]
      )

      const response = await request(app).get(`/api/invites/${expiredTokenSuffix}`)

      expect(response.status).toBe(400)
    })
  })
})
