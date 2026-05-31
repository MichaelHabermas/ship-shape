import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { PASSWORD_BCRYPT_ROUNDS } from '@ship/shared'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import {
  AuthErrorResponseSchema,
  CurrentUserResponseSchema,
  ExtendSessionResponseSchema,
  LoginResponseSchema,
  SessionResponseSchema,
} from '../openapi/schemas/auth.js'
import { SuccessResponseSchema } from '../openapi/schemas/common.js'
import { expectApiErrorResponse } from '../test/expect-api-error.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { requireFirstRow, type IdRow } from '../test/pg-result.js'
import { getCsrfTokenFromApp } from '../test/session-csrf.js'

function getCookiesArray(setCookie: string | string[] | undefined): string[] {
  if (!setCookie) return []
  return Array.isArray(setCookie) ? setCookie : [setCookie]
}

function sessionIdFromSetCookie(setCookie: string | string[] | undefined): string {
  const cookies = getCookiesArray(setCookie)
  return cookies.find((c: string) => c.startsWith('session_id='))?.split(';')[0] ?? ''
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

  async function loginWithCsrf(email: string, password: string, sessionCookie = '') {
    const csrf = await getCsrfTokenFromApp(app, sessionCookie)
    return request(app)
      .post('/api/auth/login')
      .set('Cookie', csrf.sessionCookie)
      .set('x-csrf-token', csrf.token)
      .send({ email, password })
  }

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id

    passwordHash = await bcrypt.hash(testPassword, PASSWORD_BCRYPT_ROUNDS)

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, 'Auth Test User')
       RETURNING id`,
      [testEmail, passwordHash]
    )
    testUserId = requireFirstRow(userResult.rows).id

    await pool.query<IdRow>(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('POST /api/auth/login', () => {
    it('should reject login without email', async () => {
      const csrf = await getCsrfTokenFromApp(app, '')
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', csrf.sessionCookie)
        .set('x-csrf-token', csrf.token)
        .send({ password: testPassword })

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/auth/login',
        status: 400,
        response: res,
        openApiSchemaName: 'AuthErrorResponse',
        schema: AuthErrorResponseSchema,
      })
      expect(error.error.message).toContain('Email and password are required')
    })

    it('should reject login without password', async () => {
      const csrf = await getCsrfTokenFromApp(app, '')
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', csrf.sessionCookie)
        .set('x-csrf-token', csrf.token)
        .send({ email: testEmail })

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/auth/login',
        status: 400,
        response: res,
        openApiSchemaName: 'AuthErrorResponse',
        schema: AuthErrorResponseSchema,
      })
      expect(error.error.message).toContain('Email and password are required')
    })

    it('should reject login with non-existent email', async () => {
      const csrf = await getCsrfTokenFromApp(app, '')
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', csrf.sessionCookie)
        .set('x-csrf-token', csrf.token)
        .send({ email: 'nonexistent@ship.local', password: testPassword })

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/auth/login',
        status: 401,
        response: res,
        openApiSchemaName: 'AuthErrorResponse',
        schema: AuthErrorResponseSchema,
      })
      expect(error.error.message).toBe('Invalid email or password')
    })

    it('should reject login with wrong password', async () => {
      const csrf = await getCsrfTokenFromApp(app, '')
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', csrf.sessionCookie)
        .set('x-csrf-token', csrf.token)
        .send({ email: testEmail, password: 'WrongPassword123!' })

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/auth/login',
        status: 401,
        response: res,
        openApiSchemaName: 'AuthErrorResponse',
        schema: AuthErrorResponseSchema,
      })
      expect(error.error.message).toBe('Invalid email or password')
    })

    it('should accept valid credentials and set session cookie', async () => {
      const res = await loginWithCsrf(testEmail, testPassword)

      const body = expectOpenApiResponse({
        method: 'post',
        path: '/auth/login',
        status: 200,
        response: res,
        openApiSchemaName: 'LoginResponse',
        schema: LoginResponseSchema,
      })
      expect(body.data.user.email).toBe(testEmail)
      expect(body.data.user.id).toBe(testUserId)
      expect(body.data.currentWorkspace).toBeDefined()
      expect(body.data.workspaces.length).toBeGreaterThan(0)

      const cookies = getCookiesArray(res.headers['set-cookie'])
      expect(cookies.length).toBeGreaterThan(0)
      const sessionCookie = cookies.find((c: string) => c.startsWith('session_id='))
      expect(sessionCookie).toBeDefined()
      expect(sessionCookie).toContain('HttpOnly')
    })

    it('should handle case-insensitive email lookup', async () => {
      const res = await loginWithCsrf(testEmail.toUpperCase(), testPassword)

      expectOpenApiResponse({
        method: 'post',
        path: '/auth/login',
        status: 200,
        response: res,
        openApiSchemaName: 'LoginResponse',
        schema: LoginResponseSchema,
      })
    })

    it('should reject PIV-only user attempting password login', async () => {
      const pivEmail = `piv-user-${testRunId}@ship.local`
      const pivUserResult = await pool.query<IdRow>(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, NULL, 'PIV User')
         RETURNING id`,
        [pivEmail]
      )
      const pivUserId = requireFirstRow(pivUserResult.rows).id

      await pool.query<IdRow>(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'member')`,
        [testWorkspaceId, pivUserId]
      )

      const res = await loginWithCsrf(pivEmail, 'anypassword')

      const error = expectApiErrorResponse({
        method: 'post',
        path: '/auth/login',
        status: 401,
        response: res,
        openApiSchemaName: 'AuthErrorResponse',
        schema: AuthErrorResponseSchema,
      })
      expect(error.error.message).toContain('PIV authentication only')

      await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [pivUserId])
      await pool.query('DELETE FROM users WHERE id = $1', [pivUserId])
    })
  })

  describe('POST /api/auth/logout', () => {
    it('should reject logout without session', async () => {
      const csrf = await getCsrfTokenFromApp(app, '')
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', csrf.sessionCookie)
        .set('x-csrf-token', csrf.token)

      expectApiErrorResponse({
        method: 'post',
        path: '/auth/logout',
        status: 401,
        response: res,
      })
    })

    it('should successfully logout with valid session', async () => {
      const loginRes = await loginWithCsrf(testEmail, testPassword)
      const sessionCookie = sessionIdFromSetCookie(loginRes.headers['set-cookie'])
      const csrf = await getCsrfTokenFromApp(app, sessionCookie)

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', csrf.sessionCookie)
        .set('x-csrf-token', csrf.token)

      expectOpenApiResponse({
        method: 'post',
        path: '/auth/logout',
        status: 200,
        response: logoutRes,
        openApiSchemaName: 'SuccessResponse',
        schema: SuccessResponseSchema,
      })

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', csrf.sessionCookie)

      expectApiErrorResponse({
        method: 'get',
        path: '/auth/me',
        status: 401,
        response: meRes,
      })
    })
  })

  describe('GET /api/auth/me', () => {
    let sessionCookie: string
    beforeAll(async () => {
      const loginRes = await loginWithCsrf(testEmail, testPassword)
      const csrf = await getCsrfTokenFromApp(app, sessionIdFromSetCookie(loginRes.headers['set-cookie']))
      sessionCookie = csrf.sessionCookie
    })

    it('should reject request without session', async () => {
      const res = await request(app).get('/api/auth/me')

      expectApiErrorResponse({
        method: 'get',
        path: '/auth/me',
        status: 401,
        response: res,
      })
    })

    it('should return user info for valid session', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', sessionCookie)

      const body = expectOpenApiResponse({
        method: 'get',
        path: '/auth/me',
        status: 200,
        response: res,
        openApiSchemaName: 'CurrentUserResponse',
        schema: CurrentUserResponseSchema,
      })
      expect(body.data.user.email).toBe(testEmail)
      expect(body.data.user.id).toBe(testUserId)
      expect(body.data.currentWorkspace).toBeDefined()
      expect(body.data.workspaces.length).toBeGreaterThan(0)
    })

    it('should reject expired session', async () => {
      const expiredSessionId = crypto.randomBytes(32).toString('hex')
      await pool.query<IdRow>(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
         VALUES ($1, $2, $3, now() + interval '1 hour', now() - interval '20 minutes')`,
        [expiredSessionId, testUserId, testWorkspaceId]
      )

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `session_id=${expiredSessionId}`)

      expectApiErrorResponse({
        method: 'get',
        path: '/auth/me',
        status: 401,
        response: res,
      })

      await pool.query('DELETE FROM sessions WHERE id = $1', [expiredSessionId])
    })
  })

  describe('POST /api/auth/extend-session', () => {
    it('should extend session expiry', async () => {
      const loginRes = await loginWithCsrf(testEmail, testPassword)
      const csrf = await getCsrfTokenFromApp(app, sessionIdFromSetCookie(loginRes.headers['set-cookie']))

      const res = await request(app)
        .post('/api/auth/extend-session')
        .set('Cookie', csrf.sessionCookie)
        .set('x-csrf-token', csrf.token)

      const body = expectOpenApiResponse({
        method: 'post',
        path: '/auth/extend-session',
        status: 200,
        response: res,
        openApiSchemaName: 'ExtendSessionResponse',
        schema: ExtendSessionResponseSchema,
      })
      const expiresAt = new Date(body.data.expiresAt)
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    })
  })

  describe('GET /api/auth/session', () => {
    it('should return session info', async () => {
      const loginRes = await loginWithCsrf(testEmail, testPassword)
      const csrf = await getCsrfTokenFromApp(app, sessionIdFromSetCookie(loginRes.headers['set-cookie']))

      const res = await request(app)
        .get('/api/auth/session')
        .set('Cookie', csrf.sessionCookie)

      const body = expectOpenApiResponse({
        method: 'get',
        path: '/auth/session',
        status: 200,
        response: res,
        openApiSchemaName: 'SessionResponse',
        schema: SessionResponseSchema,
      })
      expect(body.data.createdAt).toBeDefined()
      expect(body.data.expiresAt).toBeDefined()
      expect(body.data.absoluteExpiresAt).toBeDefined()
      expect(body.data.lastActivity).toBeDefined()
    })
  })

  describe('Session Security', () => {
    it('should generate unique session IDs for each login', async () => {
      const login1 = await loginWithCsrf(testEmail, testPassword)
      const session1 = getCookiesArray(login1.headers['set-cookie'])
        .find((c: string) => c.startsWith('session_id='))
        ?.split(';')[0]
        ?.split('=')[1]

      const login2 = await loginWithCsrf(testEmail, testPassword)
      const session2 = getCookiesArray(login2.headers['set-cookie'])
        .find((c: string) => c.startsWith('session_id='))
        ?.split(';')[0]
        ?.split('=')[1]

      expect(session1).not.toBe(session2)
    })

    it('should invalidate old session on re-login (session fixation prevention)', async () => {
      const login1 = await loginWithCsrf(testEmail, testPassword)
      const session1Cookie = sessionIdFromSetCookie(login1.headers['set-cookie'])
      const csrf = await getCsrfTokenFromApp(app, session1Cookie)

      const login2 = await request(app)
        .post('/api/auth/login')
        .set('Cookie', csrf.sessionCookie)
        .set('x-csrf-token', csrf.token)
        .send({ email: testEmail, password: testPassword })

      expectOpenApiResponse({
        method: 'post',
        path: '/auth/login',
        status: 200,
        response: login2,
        openApiSchemaName: 'LoginResponse',
        schema: LoginResponseSchema,
      })

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', csrf.sessionCookie)

      expectApiErrorResponse({
        method: 'get',
        path: '/auth/me',
        status: 401,
        response: meRes,
      })
    })
  })
})
