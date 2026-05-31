import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { SprintReviewResponseSchema } from '../openapi/schemas/weeks.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { getCsrfTokenFromApp } from '../test/session-csrf.js'
import { IdRow, requireFirstRow } from '../test/pg-result.js'

describe('Sprint Reviews API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `sprint-reviews-${testRunId}@ship.local`
  const otherEmail = `sprint-reviews-other-${testRunId}@ship.local`
  const testWorkspaceName = `Sprint Reviews Test ${testRunId}`

  let sessionCookie: string
  let otherSessionCookie: string
  let csrfToken: string
  let otherCsrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let otherUserId: string
  let testSprintId: string
  let testProgramId: string

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Test User')
       RETURNING id`,
      [testEmail]
    )
    testUserId = requireFirstRow(userResult.rows).id

    const otherUserResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Other User')
       RETURNING id`,
      [otherEmail]
    )
    otherUserId = requireFirstRow(otherUserResult.rows).id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, otherUserId]
    )

    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    const otherSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [otherSessionId, otherUserId, testWorkspaceId]
    )
    otherSessionCookie = `session_id=${otherSessionId}`

    const csrf = await getCsrfTokenFromApp(app, sessionCookie)
    csrfToken = csrf.token
    sessionCookie = csrf.sessionCookie

    const otherCsrf = await getCsrfTokenFromApp(app, otherSessionCookie)
    otherCsrfToken = otherCsrf.token
    otherSessionCookie = otherCsrf.sessionCookie

    const programResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility)
       VALUES ($1, 'program', 'Test Program', $2, 'workspace')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProgramId = requireFirstRow(programResult.rows).id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  beforeEach(async () => {
    await pool.query(
      `DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1 AND document_type IN ('sprint', 'weekly_review', 'issue'))`,
      [testWorkspaceId]
    )
    await pool.query(
      `DELETE FROM documents WHERE workspace_id = $1 AND document_type IN ('sprint', 'weekly_review', 'issue')`,
      [testWorkspaceId]
    )
    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility, properties)
       VALUES ($1, 'sprint', 'Test Sprint', $2, 'workspace', $3)
       RETURNING id`,
      [testWorkspaceId, testUserId, JSON.stringify({ plan: 'Test plan for sprint' })]
    )
    testSprintId = requireFirstRow(sprintResult.rows).id
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [testSprintId, testProgramId]
    )
  })

  describe('GET /api/weeks/:id/review', () => {
    it('returns pre-filled draft with is_draft: true for new sprint', async () => {
      const response = await request(app)
        .get(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)

      const body = expectOpenApiResponse({
        method: 'get',
        path: '/weeks/{id}/review',
        status: 200,
        response,
        openApiSchemaName: 'SprintReviewResponse',
        schema: SprintReviewResponseSchema,
      })
      expect(body.is_draft).toBe(true)
      expect(body.content).toBeDefined()
      expect(body.content?.type).toBe('doc')
    })

    it('returns existing review with is_draft: false after POST', async () => {
      await request(app)
        .post(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
          plan_validated: true
        })

      const response = await request(app)
        .get(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)

      const body = expectOpenApiResponse({
        method: 'get',
        path: '/weeks/{id}/review',
        status: 200,
        response,
        openApiSchemaName: 'SprintReviewResponse',
        schema: SprintReviewResponseSchema,
      })
      expect(body.is_draft).toBe(false)
      expect(body.plan_validated).toBe(true)
    })

    it('pre-fill content includes issues information', async () => {
      const doneIssueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility, properties)
         VALUES ($1, 'issue', 'Done Issue', $2, 'workspace', $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'done' })]
      )
      const inProgressIssueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility, properties)
         VALUES ($1, 'issue', 'In Progress Issue', $2, 'workspace', $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'in_progress' })]
      )

      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint'), ($3, $2, 'sprint')`,
        [requireFirstRow(doneIssueResult.rows).id, testSprintId, requireFirstRow(inProgressIssueResult.rows).id]
      )

      const response = await request(app)
        .get(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)

      const body = expectOpenApiResponse({
        method: 'get',
        path: '/weeks/{id}/review',
        status: 200,
        response,
        openApiSchemaName: 'SprintReviewResponse',
        schema: SprintReviewResponseSchema,
      })
      expect(body.is_draft).toBe(true)
      expect(body.content).toBeDefined()
      const contentStr = JSON.stringify(body.content)
      expect(contentStr).toContain('Done Issue')
    })

    it('returns 404 for non-existent sprint', async () => {
      const fakeSprintId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .get(`/api/weeks/${fakeSprintId}/review`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/weeks/:id/review', () => {
    it('creates weekly_review document with owner_id', async () => {
      const response = await request(app)
        .post(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Review content' }] }] },
          plan_validated: true
        })

      const body = expectOpenApiResponse({
        method: 'post',
        path: '/weeks/{id}/review',
        status: 201,
        response,
        openApiSchemaName: 'SprintReviewResponse',
        schema: SprintReviewResponseSchema,
      })
      expect(body.owner_id).toBe(testUserId)
      expect(body.sprint_id).toBe(testSprintId)
      expect(body.plan_validated).toBe(true)
    })

    it('returns 403 without auth (CSRF check first)', async () => {
      const response = await request(app)
        .post(`/api/weeks/${testSprintId}/review`)
        .send({ content: { type: 'doc', content: [] } })

      expect(response.status).toBe(403)
    })

    it('returns 409 if review already exists', async () => {
      await request(app)
        .post(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ content: { type: 'doc', content: [] } })

      const response = await request(app)
        .post(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ content: { type: 'doc', content: [] } })

      expect(response.status).toBe(409)
    })
  })

  describe('PATCH /api/weeks/:id/review', () => {
    beforeEach(async () => {
      await request(app)
        .post(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: { type: 'doc', content: [] },
          plan_validated: null
        })
    })

    it('updates plan_validated and content', async () => {
      const newContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }] }
      const response = await request(app)
        .patch(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: newContent,
          plan_validated: false
        })

      const body = expectOpenApiResponse({
        method: 'patch',
        path: '/weeks/{id}/review',
        status: 200,
        response,
        openApiSchemaName: 'SprintReviewResponse',
        schema: SprintReviewResponseSchema,
      })
      expect(body.plan_validated).toBe(false)
      expect(body.content).toEqual(newContent)
    })

    it('returns 403 for non-owner', async () => {
      const response = await request(app)
        .patch(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', otherSessionCookie)
        .set('x-csrf-token', otherCsrfToken)
        .send({ plan_validated: true })

      expect(response.status).toBe(403)
    })

    it('returns 404 when no review exists', async () => {
      await pool.query(
        `DELETE FROM documents WHERE document_type = 'weekly_review' AND properties->>'sprint_id' = $1`,
        [testSprintId]
      )

      const response = await request(app)
        .patch(`/api/weeks/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ plan_validated: true })

      expect(response.status).toBe(404)
    })
  })
})
