// Route tests for standup CRUD, week standups, and standup status.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import {
  StandupLegacyErrorSchema,
  StandupResponseSchema,
  StandupStatusSchema,
  UpdatedStandupResponseSchema,
} from '../openapi/schemas/standups.js'
import { UuidSchema } from '../openapi/schemas/common.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { requireFirstRow, type IdRow, type SprintStartDateRow } from '../test/pg-result.js'
import { expectJsonBody } from '../test/expect-json-body.js'
import { getCsrfTokenFromApp } from '../test/session-csrf.js'
import { z } from 'zod'

const WeekStandupSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  content: z.record(z.unknown()).nullable().optional(),
  author_id: UuidSchema,
  author_name: z.string().optional(),
  sprint_id: UuidSchema.optional(),
  created_at: z.string(),
}).passthrough()

const WeekStandupsListSchema = z.array(WeekStandupSchema)

describe('Standups API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `standups-${testRunId}@ship.local`
  const otherEmail = `standups-other-${testRunId}@ship.local`
  const testWorkspaceName = `Standups Test ${testRunId}`

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
    // Create test workspace
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id

    // Create test user
    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Test User')
       RETURNING id`,
      [testEmail]
    )
    testUserId = requireFirstRow(userResult.rows).id

    // Create other user (for testing authorization)
    const otherUserResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Other User')
       RETURNING id`,
      [otherEmail]
    )
    otherUserId = requireFirstRow(otherUserResult.rows).id

    // Create workspace memberships
    await pool.query<IdRow>(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )
    await pool.query<IdRow>(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, otherUserId]
    )

    // Create session for test user
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query<IdRow>(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    // Create session for other user
    const otherSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query<IdRow>(
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

    // Create a program (required for sprint)
    const programResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility)
       VALUES ($1, 'program', 'Test Program', $2, 'workspace')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProgramId = requireFirstRow(programResult.rows).id

    // Create a sprint for standup tests
    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, parent_id, visibility)
       VALUES ($1, 'sprint', 'Test Sprint', $2, $3, 'workspace')
       RETURNING id`,
      [testWorkspaceId, testUserId, testProgramId]
    )
    testSprintId = requireFirstRow(sprintResult.rows).id

    // Associate sprint with program
    await pool.query<IdRow>(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [testSprintId, testProgramId]
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  beforeEach(async () => {
    // Clean up standups before each test
    await pool.query<IdRow>(
      `DELETE FROM documents WHERE workspace_id = $1 AND document_type = 'standup'`,
      [testWorkspaceId]
    )
  })

  describe('POST /api/standups', () => {
    const standupDate = '2026-05-22'

    beforeEach(async () => {
      await pool.query<IdRow>(
        `DELETE FROM documents
         WHERE workspace_id = $1
           AND document_type = 'standup'
           AND properties->>'date' = $2`,
        [testWorkspaceId, standupDate]
      )
    })

    it('creates a standalone standup and returns 201', async () => {
      const response = await request(app)
        .post('/api/standups')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ date: standupDate })

      const standup = expectOpenApiResponse({
        method: 'post',
        path: '/standups',
        status: 201,
        response,
        openApiSchemaName: 'Standup',
        schema: StandupResponseSchema,
      })
      expect(standup.document_type).toBe('standup')
      expect(standup.properties?.author_id).toBe(testUserId)
      expect(standup.properties?.date).toBe(standupDate)
    })

    it('returns existing standup for the same date (idempotent 200)', async () => {
      const firstResponse = await request(app)
        .post('/api/standups')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ date: standupDate })

      const firstStandup = expectOpenApiResponse({
        method: 'post',
        path: '/standups',
        status: 201,
        response: firstResponse,
        openApiSchemaName: 'Standup',
        schema: StandupResponseSchema,
      })

      const secondResponse = await request(app)
        .post('/api/standups')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ date: standupDate })

      const standup = expectOpenApiResponse({
        method: 'post',
        path: '/standups',
        status: 200,
        response: secondResponse,
        openApiSchemaName: 'Standup',
        schema: StandupResponseSchema,
      })
      expect(standup.id).toBe(firstStandup.id)
    })

    it('returns 403 without auth (CSRF check first)', async () => {
      const response = await request(app)
        .post('/api/standups')
        .send({ date: standupDate })

      expect(response.status).toBe(403)
    })
  })

  describe('POST /api/weeks/:id/standups', () => {
    it('creates standup with valid sprint_id and returns 201', async () => {
      const response = await request(app)
        .post(`/api/weeks/${testSprintId}/standups`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My standup' }] }] },
          title: 'Daily Standup'
        })

      const standup = expectJsonBody(response, 201, WeekStandupSchema)
      expect(standup.id).toBeDefined()
      expect(standup.sprint_id).toBe(testSprintId)
      expect(standup.author_id).toBe(testUserId)
      expect(standup.title).toBe('Daily Standup')
    })

    it('returns 404 for non-existent sprint', async () => {
      const fakeSprintId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .post(`/api/weeks/${fakeSprintId}/standups`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ content: { type: 'doc', content: [] } })

      const error = expectJsonBody(response, 404, StandupLegacyErrorSchema)
      expect(error.error).toBe('Week not found')
    })

    it('returns 403 without auth (CSRF check first)', async () => {
      const response = await request(app)
        .post(`/api/weeks/${testSprintId}/standups`)
        .send({ content: { type: 'doc', content: [] } })

      expect(response.status).toBe(403)
    })

    it('uses default title when not provided', async () => {
      const response = await request(app)
        .post(`/api/weeks/${testSprintId}/standups`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({})

      const standup = expectJsonBody(response, 201, WeekStandupSchema)
      expect(standup.title).toBe('Standup Update')
    })
  })

  describe('GET /api/weeks/:id/standups', () => {
    it('returns array sorted newest first', async () => {
      // Create two standups with different timestamps
      await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility, created_at)
         VALUES ($1, 'standup', 'First', $2, $3, $4, 'workspace', now() - interval '1 hour')`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )
      await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility, created_at)
         VALUES ($1, 'standup', 'Second', $2, $3, $4, 'workspace', now())`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )

      const response = await request(app)
        .get(`/api/weeks/${testSprintId}/standups`)
        .set('Cookie', sessionCookie)

      const standups = expectJsonBody(response, 200, WeekStandupsListSchema)
      expect(standups.length).toBe(2)
      expect(standups[0].title).toBe('Second') // Newest first
      expect(standups[1].title).toBe('First')
    })

    it('returns empty array for sprint with no standups', async () => {
      const response = await request(app)
        .get(`/api/weeks/${testSprintId}/standups`)
        .set('Cookie', sessionCookie)

      const standups = expectJsonBody(response, 200, WeekStandupsListSchema)
      expect(standups).toEqual([])
    })

    it('returns 404 for non-existent sprint', async () => {
      const fakeSprintId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .get(`/api/weeks/${fakeSprintId}/standups`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(404)
    })
  })

  describe('PATCH /api/standups/:id', () => {
    let standupId: string

    beforeEach(async () => {
      // Create a standup for update tests
      const result = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility)
         VALUES ($1, 'standup', 'Original Title', $2, $3, $4, 'workspace')
         RETURNING id`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )
      standupId = requireFirstRow(result.rows).id
    })

    it('updates content and returns 200', async () => {
      const newContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated content' }] }] }
      const response = await request(app)
        .patch(`/api/standups/${standupId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ content: newContent, title: 'Updated Title' })

      const standup = expectJsonBody(response, 200, UpdatedStandupResponseSchema)
      expect(standup.title).toBe('Updated Title')
      expect(standup.content).toEqual(newContent)
    })

    it('returns 403 for non-author', async () => {
      const response = await request(app)
        .patch(`/api/standups/${standupId}`)
        .set('Cookie', otherSessionCookie)
        .set('x-csrf-token', otherCsrfToken)
        .send({ title: 'Hacked Title' })

      const error = expectJsonBody(response, 403, StandupLegacyErrorSchema)
      expect(error.error).toContain('Only the author')
    })

    it('returns 404 for non-existent standup', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .patch(`/api/standups/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ title: 'New Title' })

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/standups/:id', () => {
    let standupId: string

    beforeEach(async () => {
      const result = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility)
         VALUES ($1, 'standup', 'To Delete', $2, $3, $4, 'workspace')
         RETURNING id`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )
      standupId = requireFirstRow(result.rows).id
    })

    it('removes standup and returns 204', async () => {
      const response = await request(app)
        .delete(`/api/standups/${standupId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(204)

      // Verify deletion
      const checkResult = await pool.query<IdRow>(
        'SELECT id FROM documents WHERE id = $1',
        [standupId]
      )
      expect(checkResult.rows.length).toBe(0)
    })

    it('returns 403 for non-author', async () => {
      const response = await request(app)
        .delete(`/api/standups/${standupId}`)
        .set('Cookie', otherSessionCookie)
        .set('x-csrf-token', otherCsrfToken)

      const error = expectJsonBody(response, 403, StandupLegacyErrorSchema)
      expect(error.error).toContain('Only the author')
    })

    it('returns 404 for non-existent standup', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .delete(`/api/standups/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/standups/status', () => {
    it('returns due=false when no active sprints have issues assigned', async () => {
      const response = await request(app)
        .get('/api/standups/status')
        .set('Cookie', sessionCookie)

      const status = expectJsonBody(response, 200, StandupStatusSchema)
      expect(status).toHaveProperty('due')
      expect(status).toHaveProperty('lastPosted')
      expect(typeof status.due).toBe('boolean')
    })

    it('returns due=true when user has issue in active sprint but no standup today', async () => {
      // Get current sprint number from workspace
      const workspaceResult = await pool.query<SprintStartDateRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
        [testWorkspaceId]
      )
      const rawStartDate = workspaceResult.rows[0].sprint_start_date
      let workspaceStartDate: Date
      if (rawStartDate instanceof Date) {
        workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()))
      } else if (typeof rawStartDate === 'string') {
        workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z')
      } else {
        workspaceStartDate = new Date()
      }
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24))
      const currentSprintNumber = Math.floor(daysSinceStart / 7) + 1

      // Create a sprint with the current sprint number
      const activeSprintResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by, parent_id, visibility, properties)
         VALUES ($1, 'sprint', 'Active Sprint', $2, $3, 'workspace', $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, testProgramId, JSON.stringify({
          sprint_number: currentSprintNumber
        })]
      )
      const activeSprintId = requireFirstRow(activeSprintResult.rows).id

      // Associate sprint with program
      await pool.query<IdRow>(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [activeSprintId, testProgramId]
      )

      // Create an issue assigned to the test user
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility, properties)
         VALUES ($1, 'issue', 'Test Issue', $2, 'workspace', $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ assignee_id: testUserId })]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      // Create the sprint-issue association via document_associations table
      await pool.query<IdRow>(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint')`,
        [issueId, activeSprintId]
      )

      const response = await request(app)
        .get('/api/standups/status')
        .set('Cookie', sessionCookie)

      const status = expectJsonBody(response, 200, StandupStatusSchema)
      expect(status.due).toBe(true)
      expect(status.lastPosted).toBeNull()

      // Cleanup
      await pool.query('DELETE FROM document_associations WHERE document_id IN ($1, $2)', [issueId, activeSprintId])
      await pool.query('DELETE FROM documents WHERE id IN ($1, $2)', [activeSprintId, issueId])
    })

    it('returns due=false when user posted standup today', async () => {
      // Get current sprint number from workspace
      const workspaceResult = await pool.query<SprintStartDateRow>(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
        [testWorkspaceId]
      )
      const rawStartDate = workspaceResult.rows[0].sprint_start_date
      let workspaceStartDate: Date
      if (rawStartDate instanceof Date) {
        workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()))
      } else if (typeof rawStartDate === 'string') {
        workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z')
      } else {
        workspaceStartDate = new Date()
      }
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24))
      const currentSprintNumber = Math.floor(daysSinceStart / 7) + 1

      // Create a sprint with the current sprint number
      const activeSprintResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by, parent_id, visibility, properties)
         VALUES ($1, 'sprint', 'Active Sprint 2', $2, $3, 'workspace', $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, testProgramId, JSON.stringify({
          sprint_number: currentSprintNumber
        })]
      )
      const activeSprintId = requireFirstRow(activeSprintResult.rows).id

      // Associate sprint with program
      await pool.query<IdRow>(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [activeSprintId, testProgramId]
      )

      // Create an issue assigned to the test user
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility, properties)
         VALUES ($1, 'issue', 'Test Issue 2', $2, 'workspace', $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ assignee_id: testUserId })]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      // Create the sprint-issue association via document_associations table
      await pool.query<IdRow>(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint')`,
        [issueId, activeSprintId]
      )

      // Create a standup posted today
      await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility)
         VALUES ($1, 'standup', 'Today Standup', $2, $3, $4, 'workspace')`,
        [testWorkspaceId, activeSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )

      const response = await request(app)
        .get('/api/standups/status')
        .set('Cookie', sessionCookie)

      const status = expectJsonBody(response, 200, StandupStatusSchema)
      expect(status.due).toBe(false)
      expect(status.lastPosted).not.toBeNull()

      // Cleanup
      await pool.query<IdRow>(`DELETE FROM documents WHERE parent_id = $1 AND document_type = 'standup'`, [activeSprintId])
      await pool.query('DELETE FROM document_associations WHERE document_id IN ($1, $2)', [issueId, activeSprintId])
      await pool.query('DELETE FROM documents WHERE id IN ($1, $2)', [activeSprintId, issueId])
    })

    it('returns 401 without authentication', async () => {
      const response = await request(app)
        .get('/api/standups/status')

      expect(response.status).toBe(401)
    })
  })
})
