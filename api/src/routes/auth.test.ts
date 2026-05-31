import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { PASSWORD_BCRYPT_ROUNDS } from '@ship/shared'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

// Helper to normalize set-cookie header (can be string or string[])
function getCookiesArray(setCookie: string | string[] | undefined): string[] {
  if (!setCookie) return []
  return Array.isArray(setCookie) ? setCookie : [setCookie]
}

describe('Auth API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `auth-test-${testRunId}@ship.local`
  const testPassword = 'TestPassword123!'
  const testWorkspaceName = `Auth Test ${testRunId}`

  let testWorkspaceId: string
  let testUserId: string
  let passwordHash: string

  // Helper to get CSRF token and session cookie for requests
  async function getCsrfTokenAndCookie(): Promise<{ csrfToken: string; cookie: string }> {
    const csrfRes = await request(app).get('/api/csrf-token')
    const csrfToken = typeof csrfRes.body?.token === 'string' ? csrfRes.body.token : ''
    const cookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    return { csrfToken, cookie }
  }

  // Helper to login with CSRF token
  async function loginWithCsrf(email: string, password: string, extraCookie?: string) {
    const { csrfToken, cookie } = await getCsrfTokenAndCookie()
    const fullCookie = extraCookie ? `${cookie}; ${extraCookie}` : cookie
    return request(app)
      .post('/api/auth/login')
      .set('Cookie', fullCookie)
      .set('x-csrf-token', csrfToken)
      .send({ email, password })
  }

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create password hash
    passwordHash = await bcrypt.hash(testPassword, PASSWORD_BCRYPT_ROUNDS)

    // Create test user with password
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, 'Auth Test User')
       RETURNING id`,
      [testEmail, passwordHash]
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )
  })

  afterAll(async () => {
    // Clean up in correct order (foreign key constraints)
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('POST /api/auth/login', () => {
    it('should reject login without email', async () => {
      const { csrfToken, cookie } = await getCsrfTokenAndCookie()
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrfToken)
        .send({ password: testPassword })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error.message).toContain('Email and password are required')
    })

    it('should reject login without password', async () => {
      const { csrfToken, cookie } = await getCsrfTokenAndCookie()
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrfToken)
        .send({ email: testEmail })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.error.message).toContain('Email and password are required')
    })

    it('should reject login with non-existent email', async () => {
      const { csrfToken, cookie } = await getCsrfTokenAndCookie()
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrfToken)
        .send({ email: 'nonexistent@ship.local', password: testPassword })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error.message).toBe('Invalid email or password')
    })

    it('should reject login with wrong password', async () => {
      const { csrfToken, cookie } = await getCsrfTokenAndCookie()
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrfToken)
        .send({ email: testEmail, password: 'WrongPassword123!' })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error.message).toBe('Invalid email or password')
    })

    it('should accept valid credentials and set session cookie', async () => {
      const res = await loginWithCsrf(testEmail, testPassword)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toBeDefined()
      expect(res.body.data.user.email).toBe(testEmail)
      expect(res.body.data.user.id).toBe(testUserId)
      expect(res.body.data.currentWorkspace).toBeDefined()
      expect(res.body.data.workspaces).toBeInstanceOf(Array)

      // Check cookie is set
      const cookies = getCookiesArray(res.headers['set-cookie'])
      expect(cookies.length).toBeGreaterThan(0)
      const sessionCookie = cookies.find((c: string) => c.startsWith('session_id='))
      expect(sessionCookie).toBeDefined()
      expect(sessionCookie).toContain('HttpOnly')
    })

    it('should handle case-insensitive email lookup', async () => {
      const res = await loginWithCsrf(testEmail.toUpperCase(), testPassword)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should reject PIV-only user attempting password login', async () => {
      // Create PIV-only user (no password_hash)
      const pivEmail = `piv-user-${testRunId}@ship.local`
      const pivUserResult = await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, NULL, 'PIV User')
         RETURNING id`,
        [pivEmail]
      )
      const pivUserId = pivUserResult.rows[0].id

      // Add to workspace
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'member')`,
        [testWorkspaceId, pivUserId]
      )

      const res = await loginWithCsrf(pivEmail, 'anypassword')

      expect(res.status).toBe(401)
      expect(res.body.error.message).toContain('PIV authentication only')

      // Cleanup
      await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [pivUserId])
      await pool.query('DELETE FROM users WHERE id = $1', [pivUserId])
    })
  })

  describe('POST /api/auth/logout', () => {
    it('should reject logout without session', async () => {
      const { csrfToken, cookie } = await getCsrfTokenAndCookie()
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(401)
    })

    it('should successfully logout with valid session', async () => {
      // First login to get a session
      const loginRes = await loginWithCsrf(testEmail, testPassword)

      expect(loginRes.status).toBe(200)
      const cookies = getCookiesArray(loginRes.headers['set-cookie'])
      const sessionCookie =
        cookies.find((c: string) => c.startsWith('session_id='))?.split(';')[0] ?? ''

      // Get CSRF token with session
      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', sessionCookie)

      const csrfBody = csrfRes.body as { token?: unknown }
      const csrfToken = typeof csrfBody.token === 'string' ? csrfBody.token : ''
      const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
      const fullCookie = connectSidCookie ? `${sessionCookie}; ${connectSidCookie}` : sessionCookie

      // Now logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', String(fullCookie ?? ''))
        .set('x-csrf-token', csrfToken)

      expect(logoutRes.status).toBe(200)
      expect(logoutRes.body.success).toBe(true)

      // Verify session is invalidated - subsequent requests should fail
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', fullCookie || '')

      expect(meRes.status).toBe(401)
    })
  })

  describe('GET /api/auth/me', () => {
    let sessionCookie: string
    beforeAll(async () => {
      // Login to get a session
      const loginRes = await loginWithCsrf(testEmail, testPassword)

      const cookies = getCookiesArray(loginRes.headers['set-cookie'])
      sessionCookie = cookies.find((c: string) => c.startsWith('session_id='))?.split(';')[0] || ''

      // Get CSRF token with session
      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', sessionCookie)

      const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
      if (connectSidCookie) {
        sessionCookie = `${sessionCookie}; ${connectSidCookie}`
      }
    })

    it('should reject request without session', async () => {
      const res = await request(app)
        .get('/api/auth/me')

      expect(res.status).toBe(401)
    })

    it('should return user info for valid session', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toBeDefined()
      expect(res.body.data.user.email).toBe(testEmail)
      expect(res.body.data.user.id).toBe(testUserId)
      expect(res.body.data.currentWorkspace).toBeDefined()
      expect(res.body.data.workspaces).toBeInstanceOf(Array)
    })

    it('should reject expired session', async () => {
      // Create a session that expired due to inactivity (last_activity > 15 minutes ago)
      // Auth middleware checks last_activity against 15-minute timeout, not expires_at
      const expiredSessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
         VALUES ($1, $2, $3, now() + interval '1 hour', now() - interval '20 minutes')`,
        [expiredSessionId, testUserId, testWorkspaceId]
      )

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `session_id=${expiredSessionId}`)

      expect(res.status).toBe(401)

      // Session should be auto-deleted by middleware, but cleanup anyway
      await pool.query('DELETE FROM sessions WHERE id = $1', [expiredSessionId])
    })
  })

  describe('POST /api/auth/extend-session', () => {
    it('should extend session expiry', async () => {
      // Login to get a session
      const loginRes = await loginWithCsrf(testEmail, testPassword)

      const cookies = getCookiesArray(loginRes.headers['set-cookie'])
      let sessionCookie = cookies.find((c: string) => c.startsWith('session_id='))?.split(';')[0] || ''

      // Get CSRF token with session
      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', sessionCookie)

      const csrfBody = csrfRes.body as { token?: unknown }
      const csrfToken = typeof csrfBody.token === 'string' ? csrfBody.token : ''
      const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
      if (connectSidCookie) {
        sessionCookie = `${sessionCookie}; ${connectSidCookie}`
      }

      // Extend session
      const res = await request(app)
        .post('/api/auth/extend-session')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.expiresAt).toBeDefined()
      expect(res.body.data.lastActivity).toBeDefined()

      // Verify expiry is in the future
      const expiresAt = new Date(String(res.body.data.expiresAt))
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    })
  })

  describe('GET /api/auth/session', () => {
    it('should return session info', async () => {
      // Login to get a session
      const loginRes = await loginWithCsrf(testEmail, testPassword)

      const cookies = getCookiesArray(loginRes.headers['set-cookie'])
      let sessionCookie = cookies.find((c: string) => c.startsWith('session_id='))?.split(';')[0] || ''

      // Get CSRF token with session
      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', sessionCookie)

      const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
      if (connectSidCookie) {
        sessionCookie = `${sessionCookie}; ${connectSidCookie}`
      }

      // Get session info
      const res = await request(app)
        .get('/api/auth/session')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.createdAt).toBeDefined()
      expect(res.body.data.expiresAt).toBeDefined()
      expect(res.body.data.absoluteExpiresAt).toBeDefined()
      expect(res.body.data.lastActivity).toBeDefined()
    })
  })

  describe('Session Security', () => {
    it('should generate unique session IDs for each login', async () => {
      // Login twice and verify different session IDs
      const login1 = await loginWithCsrf(testEmail, testPassword)

      const cookies1 = getCookiesArray(login1.headers['set-cookie'])
      const session1 = cookies1.find((c: string) => c.startsWith('session_id='))?.split(';')[0]?.split('=')[1]

      const login2 = await loginWithCsrf(testEmail, testPassword)

      const cookies2 = getCookiesArray(login2.headers['set-cookie'])
      const session2 = cookies2.find((c: string) => c.startsWith('session_id='))?.split(';')[0]?.split('=')[1]

      expect(session1).not.toBe(session2)
    })

    it('should invalidate old session on re-login (session fixation prevention)', async () => {
      // Login to get first session
      const login1 = await loginWithCsrf(testEmail, testPassword)

      const cookies1 = getCookiesArray(login1.headers['set-cookie'])
      let session1Cookie = cookies1.find((c: string) => c.startsWith('session_id='))?.split(';')[0] || ''

      // Get CSRF for first session
      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', session1Cookie)

      const csrfBody = csrfRes.body as { token?: unknown }
      const csrfToken = typeof csrfBody.token === 'string' ? csrfBody.token : ''
      const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] ?? ''
      if (connectSidCookie) {
        session1Cookie = `${session1Cookie}; ${connectSidCookie}`
      }

      // Re-login with the old session cookie (simulates session fixation attempt)
      const login2 = await request(app)
        .post('/api/auth/login')
        .set('Cookie', session1Cookie)
        .set('x-csrf-token', csrfToken)
        .send({ email: testEmail, password: testPassword })

      expect(login2.status).toBe(200)

      // Old session should be invalid
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', session1Cookie)

      expect(meRes.status).toBe(401)
    })
  })
})
