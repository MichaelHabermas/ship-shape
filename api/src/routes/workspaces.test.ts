// Integration tests for workspace, admin, and public invite API routes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import {
  AdminCreateWorkspaceResponseSchema,
  AdminJsonResponseSchema,
  AdminWorkspacesResponseSchema,
} from '../openapi/schemas/admin.js'
import { InviteAcceptResponseSchema, InviteDetailsResponseSchema } from '../openapi/schemas/invites.js'
import { SuccessResponseSchema } from '../openapi/schemas/common.js'
import {
  WorkspaceAuditLogsListResponseSchema,
  WorkspaceCurrentResponseSchema,
  WorkspaceInviteCreateResponseSchema,
  WorkspaceInvitesListResponseSchema,
  WorkspaceListResponseSchema,
  WorkspaceMembersListResponseSchema,
  WorkspaceSwitchResponseSchema,
} from '../openapi/schemas/workspaces.js'
import { expectApiErrorResponse } from '../test/expect-api-error.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { IdRow, PropertiesRow, requireFirstRow } from '../test/pg-result.js'
import { getCsrfTokenFromApp } from '../test/session-csrf.js'

type TokenRow = { token: string }

type PersonDocumentRow = PropertiesRow & {
  title: string
  archived_at: Date | null
}

describe('Workspaces API', () => {
  const app = createApp()
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

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Test User')
       RETURNING id`,
      [testUserEmail]
    )
    testUserId = requireFirstRow(userResult.rows).id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    const superAdminResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name, is_super_admin)
       VALUES ($1, 'test-hash', 'Super Admin', true)
       RETURNING id`,
      [superAdminEmail]
    )
    superAdminUserId = requireFirstRow(superAdminResult.rows).id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, superAdminUserId]
    )

    const superSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [superSessionId, superAdminUserId, testWorkspaceId]
    )
    superAdminSessionCookie = `session_id=${superSessionId}`

    const csrf = await getCsrfTokenFromApp(app, sessionCookie)
    csrfToken = csrf.token
    sessionCookie = csrf.sessionCookie

    const superCsrf = await getCsrfTokenFromApp(app, superAdminSessionCookie)
    superAdminCsrfToken = superCsrf.token
    superAdminSessionCookie = superCsrf.sessionCookie
  })

  afterAll(async () => {
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

      const error = expectApiErrorResponse({
        method: 'get',
        path: '/workspaces',
        status: 401,
        response,
      })
      expect(error.error).toHaveProperty('message')
    })
  })

  describe('GET /api/workspaces/current', () => {
    it('should return current workspace', async () => {
      const response = await request(app)
        .get('/api/workspaces/current')
        .set('Cookie', sessionCookie)

      const current = expectOpenApiResponse({
        method: 'get',
        path: '/workspaces/current',
        status: 200,
        response,
        openApiSchemaName: 'WorkspaceCurrentResponse',
        schema: WorkspaceCurrentResponseSchema,
      })
      expect(current.data.workspace).toHaveProperty('id')
      expect(current.data.workspace).toHaveProperty('name')
    })
  })

  describe('POST /api/workspaces/:id/switch', () => {
    it('should switch to a workspace user is member of', async () => {
      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/switch`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      const switched = expectOpenApiResponse({
        method: 'post',
        path: '/workspaces/{id}/switch',
        status: 200,
        response,
        openApiSchemaName: 'WorkspaceSwitchResponse',
        schema: WorkspaceSwitchResponseSchema,
      })
      expect(switched.data.workspaceId).toBe(testWorkspaceId)
    })

    it('should return 403 when switching to workspace user is not member of', async () => {
      const otherWorkspaceResult = await pool.query<IdRow>(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace') RETURNING id`
      )
      const otherWorkspaceId = requireFirstRow(otherWorkspaceResult.rows).id

      const response = await request(app)
        .post(`/api/workspaces/${otherWorkspaceId}/switch`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expectApiErrorResponse({
        method: 'post',
        path: '/workspaces/{id}/switch',
        status: 403,
        response,
      })

      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId])
    })
  })

  describe('Workspace Members API', () => {
    it('GET /api/workspaces/:id/members should return members', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/members`)
        .set('Cookie', superAdminSessionCookie)

      const members = expectOpenApiResponse({
        method: 'get',
        path: '/workspaces/{id}/members',
        status: 200,
        response,
        openApiSchemaName: 'WorkspaceMembersListResponse',
        schema: WorkspaceMembersListResponseSchema,
      })
      expect(members.data.members.length).toBeGreaterThan(0)
    })

    it('should require admin role to manage members', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/members`)
        .set('Cookie', sessionCookie)

      expectApiErrorResponse({
        method: 'get',
        path: '/workspaces/{id}/members',
        status: 403,
        response,
      })
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

      const created = expectOpenApiResponse({
        method: 'post',
        path: '/workspaces/{id}/invites',
        status: 201,
        response,
        openApiSchemaName: 'WorkspaceInviteCreateResponse',
        schema: WorkspaceInviteCreateResponseSchema,
      })
      expect(created.data.invite.email).toBe('new-user@test.com')
      expect(created.data.invite.token).toBeTruthy()
      inviteId = created.data.invite.id
    })

    it('GET /api/workspaces/:id/invites should return invites', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/invites`)
        .set('Cookie', superAdminSessionCookie)

      const invites = expectOpenApiResponse({
        method: 'get',
        path: '/workspaces/{id}/invites',
        status: 200,
        response,
        openApiSchemaName: 'WorkspaceInvitesListResponse',
        schema: WorkspaceInvitesListResponseSchema,
      })
      expect(invites.data.invites.length).toBeGreaterThan(0)
    })

    it('DELETE /api/workspaces/:id/invites/:inviteId should revoke invite', async () => {
      if (!inviteId) {
        const createResponse = await request(app)
          .post(`/api/workspaces/${testWorkspaceId}/invites`)
          .set('Cookie', superAdminSessionCookie)
          .set('x-csrf-token', superAdminCsrfToken)
          .send({ email: 'revoke-test@test.com', role: 'member' })
        const created = expectOpenApiResponse({
          method: 'post',
          path: '/workspaces/{id}/invites',
          status: 201,
          response: createResponse,
          openApiSchemaName: 'WorkspaceInviteCreateResponse',
          schema: WorkspaceInviteCreateResponseSchema,
        })
        inviteId = created.data.invite.id
      }

      const response = await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/invites/${inviteId}`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)

      expectOpenApiResponse({
        method: 'delete',
        path: '/workspaces/{id}/invites/{inviteId}',
        status: 200,
        response,
        openApiSchemaName: 'SuccessResponse',
        schema: SuccessResponseSchema,
      })
    })

    it('POST /api/workspaces/:id/invites should create pending person document', async () => {
      const testEmail = 'pending-person-test@test.com'

      const response = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/invites`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ email: testEmail, role: 'member' })

      const created = expectOpenApiResponse({
        method: 'post',
        path: '/workspaces/{id}/invites',
        status: 201,
        response,
        openApiSchemaName: 'WorkspaceInviteCreateResponse',
        schema: WorkspaceInviteCreateResponseSchema,
      })
      const newInviteId = created.data.invite.id

      const personResult = await pool.query<PersonDocumentRow>(
        `SELECT title, properties, archived_at FROM documents
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'invite_id' = $2`,
        [testWorkspaceId, newInviteId]
      )

      expect(personResult.rows.length).toBe(1)
      const person = requireFirstRow(personResult.rows)
      expect(person.title).toBe('pending-person-test')
      expect(person.properties).toMatchObject({
        pending: true,
        email: testEmail,
        invite_id: newInviteId,
      })
    })

    it('DELETE /api/workspaces/:id/invites/:inviteId should archive person document', async () => {
      const testEmail = 'archive-person-test@test.com'

      const createResponse = await request(app)
        .post(`/api/workspaces/${testWorkspaceId}/invites`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ email: testEmail, role: 'member' })

      const created = expectOpenApiResponse({
        method: 'post',
        path: '/workspaces/{id}/invites',
        status: 201,
        response: createResponse,
        openApiSchemaName: 'WorkspaceInviteCreateResponse',
        schema: WorkspaceInviteCreateResponseSchema,
      })
      const archiveInviteId = created.data.invite.id

      const beforeResult = await pool.query<PersonDocumentRow>(
        `SELECT title, properties, archived_at FROM documents
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'invite_id' = $2`,
        [testWorkspaceId, archiveInviteId]
      )
      expect(beforeResult.rows.length).toBe(1)
      expect(requireFirstRow(beforeResult.rows).archived_at).toBeNull()

      await request(app)
        .delete(`/api/workspaces/${testWorkspaceId}/invites/${archiveInviteId}`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)

      const afterResult = await pool.query<PersonDocumentRow>(
        `SELECT title, properties, archived_at FROM documents
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'invite_id' = $2`,
        [testWorkspaceId, archiveInviteId]
      )
      expect(afterResult.rows.length).toBe(1)
      expect(requireFirstRow(afterResult.rows).archived_at).not.toBeNull()
    })

    afterAll(async () => {
      await pool.query('DELETE FROM workspace_invites WHERE workspace_id = $1', [testWorkspaceId])
      await pool.query(
        `DELETE FROM documents WHERE workspace_id = $1 AND document_type = 'person' AND properties->>'invite_id' IS NOT NULL`,
        [testWorkspaceId]
      )
    })
  })

  describe('Workspace Audit Logs API', () => {
    it('GET /api/workspaces/:id/audit-logs should return audit logs', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/audit-logs`)
        .set('Cookie', superAdminSessionCookie)

      const audit = expectOpenApiResponse({
        method: 'get',
        path: '/workspaces/{id}/audit-logs',
        status: 200,
        response,
        openApiSchemaName: 'WorkspaceAuditLogsListResponse',
        schema: WorkspaceAuditLogsListResponseSchema,
      })
      expect(Array.isArray(audit.data.logs)).toBe(true)
    })

    it('should require admin role to view audit logs', async () => {
      const response = await request(app)
        .get(`/api/workspaces/${testWorkspaceId}/audit-logs`)
        .set('Cookie', sessionCookie)

      expectApiErrorResponse({
        method: 'get',
        path: '/workspaces/{id}/audit-logs',
        status: 403,
        response,
      })
    })
  })
})

describe('Admin API', () => {
  const app = createApp()
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
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id

    const superAdminResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name, is_super_admin)
       VALUES ($1, 'test-hash', 'Admin Test', true)
       RETURNING id`,
      [superAdminEmail]
    )
    superAdminUserId = requireFirstRow(superAdminResult.rows).id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, superAdminUserId]
    )

    const superSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [superSessionId, superAdminUserId, testWorkspaceId]
    )
    superAdminSessionCookie = `session_id=${superSessionId}`

    const regularResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Regular Test')
       RETURNING id`,
      [regularEmail]
    )
    regularUserId = requireFirstRow(regularResult.rows).id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, regularUserId]
    )

    const regularSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [regularSessionId, regularUserId, testWorkspaceId]
    )
    regularSessionCookie = `session_id=${regularSessionId}`

    const superCsrf = await getCsrfTokenFromApp(app, superAdminSessionCookie)
    superAdminCsrfToken = superCsrf.token
    superAdminSessionCookie = superCsrf.sessionCookie

    const regularCsrf = await getCsrfTokenFromApp(app, regularSessionCookie)
    regularCsrfToken = regularCsrf.token
    regularSessionCookie = regularCsrf.sessionCookie
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

      const listed = expectOpenApiResponse({
        method: 'get',
        path: '/admin/workspaces',
        status: 200,
        response,
        openApiSchemaName: 'AdminWorkspacesResponse',
        schema: AdminWorkspacesResponseSchema,
      })
      expect(listed.data.workspaces.length).toBeGreaterThan(0)
    })

    it('should return 403 for non-super-admin', async () => {
      const response = await request(app)
        .get('/api/admin/workspaces')
        .set('Cookie', regularSessionCookie)

      expectApiErrorResponse({
        method: 'get',
        path: '/admin/workspaces',
        status: 403,
        response,
      })
    })
  })

  describe('POST /api/admin/workspaces', () => {
    it('should create workspace for super admin', async () => {
      const response = await request(app)
        .post('/api/admin/workspaces')
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ name: 'Admin Created Workspace' })

      const created = expectOpenApiResponse({
        method: 'post',
        path: '/admin/workspaces',
        status: 201,
        response,
        openApiSchemaName: 'AdminCreateWorkspaceResponse',
        schema: AdminCreateWorkspaceResponseSchema,
      })
      expect(created.data.workspace.name).toBe('Admin Created Workspace')
    })

    it('should return 403 for non-super-admin', async () => {
      const response = await request(app)
        .post('/api/admin/workspaces')
        .set('Cookie', regularSessionCookie)
        .set('x-csrf-token', regularCsrfToken)
        .send({ name: 'Should Fail' })

      expectApiErrorResponse({
        method: 'post',
        path: '/admin/workspaces',
        status: 403,
        response,
      })
    })
  })

  describe('GET /api/admin/users', () => {
    it('should return all users for super admin', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Cookie', superAdminSessionCookie)

      const users = expectOpenApiResponse({
        method: 'get',
        path: '/admin/users',
        status: 200,
        response,
        openApiSchemaName: 'AdminJsonResponse',
        schema: AdminJsonResponseSchema,
      })
      expect(users.data).toHaveProperty('users')
    })

    it('should return 403 for non-super-admin', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Cookie', regularSessionCookie)

      expectApiErrorResponse({
        method: 'get',
        path: '/admin/users',
        status: 403,
        response,
      })
    })
  })

  describe('GET /api/admin/audit-logs', () => {
    it('should return global audit logs for super admin', async () => {
      const response = await request(app)
        .get('/api/admin/audit-logs')
        .set('Cookie', superAdminSessionCookie)

      const logs = expectOpenApiResponse({
        method: 'get',
        path: '/admin/audit-logs',
        status: 200,
        response,
        openApiSchemaName: 'AdminJsonResponse',
        schema: AdminJsonResponseSchema,
      })
      expect(logs.data).toHaveProperty('logs')
    })

    it('should return 403 for non-super-admin', async () => {
      const response = await request(app)
        .get('/api/admin/audit-logs')
        .set('Cookie', regularSessionCookie)

      expectApiErrorResponse({
        method: 'get',
        path: '/admin/audit-logs',
        status: 403,
        response,
      })
    })
  })
})

describe('Invite Validation API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `invite-admin-${testRunId}@ship.local`
  const testWorkspaceName = `Invite Test ${testRunId}`
  const validTokenSuffix = `valid-${testRunId}`
  const expiredTokenSuffix = `expired-${testRunId}`

  let testWorkspaceId: string
  let testUserId: string
  let validInviteToken: string

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name, is_super_admin)
       VALUES ($1, 'test-hash', 'Invite Admin', true)
       RETURNING id`,
      [testEmail]
    )
    testUserId = requireFirstRow(userResult.rows).id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, testUserId]
    )

    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )

    const inviteResult = await pool.query<TokenRow>(
      `INSERT INTO workspace_invites (workspace_id, email, role, invited_by_user_id, token, expires_at)
       VALUES ($1, $2, 'member', $3, $4, now() + interval '7 days')
       RETURNING token`,
      [testWorkspaceId, `invited-${testRunId}@test.com`, testUserId, validTokenSuffix]
    )
    validInviteToken = requireFirstRow(inviteResult.rows).token
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

      const details = expectOpenApiResponse({
        method: 'get',
        path: '/invites/{token}',
        status: 200,
        response,
        openApiSchemaName: 'InviteDetailsResponse',
        schema: InviteDetailsResponseSchema,
      })
      expect(details.data.workspaceName).toBeTruthy()
      expect(details.data.role).toBe('member')
      expect(details.data).not.toHaveProperty('email')
      expect(details.data).not.toHaveProperty('invitedBy')
    })

    it('should return 404 for invalid token', async () => {
      const response = await request(app).get('/api/invites/invalid-token-12345')

      expectApiErrorResponse({
        method: 'get',
        path: '/invites/{token}',
        status: 404,
        response,
      })
    })

    it('should return 400 for expired token', async () => {
      await pool.query(
        `INSERT INTO workspace_invites (workspace_id, email, role, invited_by_user_id, token, expires_at)
         VALUES ($1, $2, 'member', $3, $4, now() - interval '1 day')`,
        [testWorkspaceId, `expired-${testRunId}@test.com`, testUserId, expiredTokenSuffix]
      )

      const response = await request(app).get(`/api/invites/${expiredTokenSuffix}`)

      expectApiErrorResponse({
        method: 'get',
        path: '/invites/{token}',
        status: 400,
        response,
      })
    })
  })

  describe('POST /api/invites/:token/accept', () => {
    it('creates cryptographically strong session IDs for invite acceptance', async () => {
      const acceptToken = `accept-${testRunId}`
      await pool.query(
        `INSERT INTO workspace_invites (workspace_id, email, role, invited_by_user_id, token, expires_at)
         VALUES ($1, $2, 'member', $3, $4, now() + interval '7 days')`,
        [testWorkspaceId, `accept-${testRunId}@test.com`, testUserId, acceptToken]
      )

      const agent = request.agent(app)
      const { token, sessionCookie } = await getCsrfTokenFromApp(app, '')
      const response = await agent
        .post(`/api/invites/${acceptToken}/accept`)
        .set('Cookie', sessionCookie)
        .set('X-CSRF-Token', token)
        .send({ name: 'Invite Accept', password: 'correct-horse-battery' })

      expectOpenApiResponse({
        method: 'post',
        path: '/invites/{token}/accept',
        status: 201,
        response,
        openApiSchemaName: 'InviteAcceptResponse',
        schema: InviteAcceptResponseSchema,
      })

      const setCookie = response.headers['set-cookie']?.[0] ?? ''
      const sessionId = /session_id=([^;]+)/.exec(setCookie)?.[1]
      expect(sessionId).toMatch(/^[a-f0-9]{64}$/)
    })
  })
})
