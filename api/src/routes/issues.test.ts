// Issues API tests cover document-backed issue CRUD, filters, state changes, and iteration evidence.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { z } from 'zod'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import {
  IssueListResponseSchema,
  IssueResponseSchema,
  BulkUpdateIssuesResponseSchema,
  IssueIterationSchema,
} from '../openapi/schemas/issues.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { getCsrfTokenFromApp } from '../test/session-csrf.js'
import { expectJsonBody } from '../test/expect-json-body.js'
import { requireFirstRow, IdRow } from '../test/pg-result.js'

const IssueListSchema = z.array(IssueListResponseSchema)
const IssueChildrenListSchema = z.array(IssueResponseSchema)
const IssueIterationListSchema = z.array(IssueIterationSchema)
const ApiErrorBodySchema = z.object({ error: z.string() })

type NextTicketRow = { next_number: number }
type DeletedAtRow = { deleted_at: Date | null }

async function nextIssueTicketNumber(workspaceId: string): Promise<number> {
  const maxResult = await pool.query<NextTicketRow>(
    `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
     FROM documents WHERE workspace_id = $1 AND document_type = 'issue'`,
    [workspaceId]
  )
  return requireFirstRow(maxResult.rows).next_number
}

describe('Issues API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `issues-test-${testRunId}@ship.local`
  const testWorkspaceName = `Issues Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let testProgramId: string
  let testProjectId: string
  let testSprintId: string

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Issues Test User')
       RETURNING id`,
      [testEmail]
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

    const csrf = await getCsrfTokenFromApp(app, sessionCookie)
    csrfToken = csrf.token
    sessionCookie = csrf.sessionCookie

    const programResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility)
       VALUES ($1, 'program', 'Test Program', 'workspace')
       RETURNING id`,
      [testWorkspaceId]
    )
    testProgramId = requireFirstRow(programResult.rows).id

    const projectResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, parent_id)
       VALUES ($1, 'project', 'Test Project', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testProgramId]
    )
    testProjectId = requireFirstRow(projectResult.rows).id

    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, parent_id)
       VALUES ($1, 'sprint', 'Test Sprint', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testProgramId]
    )
    testSprintId = requireFirstRow(sprintResult.rows).id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('GET /api/issues', () => {
    let testIssueId: string

    beforeAll(async () => {
      const listTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, content, ticket_number)
         VALUES ($1, 'issue', 'Test Issue for List', 'workspace', $2, $3, $4, $5)
         RETURNING id`,
        [
          testWorkspaceId,
          testUserId,
          JSON.stringify({ state: 'backlog', priority: 'medium' }),
          JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'List content should stay out of issue lists' }] }] }),
          listTicketNumber,
        ]
      )
      testIssueId = requireFirstRow(issueResult.rows).id

      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'project')`,
        [testIssueId, testProjectId]
      )
    })

    it('should return list of issues', async () => {
      const res = await request(app)
        .get('/api/issues')
        .set('Cookie', sessionCookie)

      const issues = expectOpenApiResponse({
        method: 'get',
        path: '/issues',
        status: 200,
        response: res,
        openApiSchemaName: 'IssueListItem',
        arrayItemSchemaName: 'IssueListItem',
        schema: IssueListSchema,
      })
      expect(issues.length).toBeGreaterThan(0)

      const testIssue = issues.find((i) => i.id === testIssueId)
      expect(testIssue).toBeDefined()
      expect(testIssue?.title).toBe('Test Issue for List')
      expect(testIssue).not.toHaveProperty('content')
    })

    it('should filter issues by sprint_id', async () => {
      const sprintTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const sprintIssueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Sprint Issue', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), sprintTicketNumber]
      )
      const sprintIssueId = requireFirstRow(sprintIssueResult.rows).id

      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint')`,
        [sprintIssueId, testSprintId]
      )

      const res = await request(app)
        .get(`/api/issues?sprint_id=${testSprintId}`)
        .set('Cookie', sessionCookie)

      const sprintIssues = expectOpenApiResponse({
        method: 'get',
        path: '/issues',
        status: 200,
        response: res,
        openApiSchemaName: 'IssueListItem',
        arrayItemSchemaName: 'IssueListItem',
        schema: IssueListSchema,
      })
      expect(sprintIssues.some((i) => i.id === sprintIssueId)).toBe(true)
    })

    it('should filter issues by project_id', async () => {
      const unrelatedTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const unrelatedIssueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Unrelated Project Issue', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), unrelatedTicketNumber]
      )
      const unrelatedIssueId = requireFirstRow(unrelatedIssueResult.rows).id

      const res = await request(app)
        .get(`/api/issues?project_id=${testProjectId}`)
        .set('Cookie', sessionCookie)

      const projectIssues = expectOpenApiResponse({
        method: 'get',
        path: '/issues',
        status: 200,
        response: res,
        openApiSchemaName: 'IssueListItem',
        arrayItemSchemaName: 'IssueListItem',
        schema: IssueListSchema,
      })
      const issueIds = projectIssues.map((i) => i.id)
      expect(issueIds).toContain(testIssueId)
      expect(issueIds).not.toContain(unrelatedIssueId)
    })

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .get('/api/issues')

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/issues/:id', () => {
    let testIssueId: string

    beforeAll(async () => {
      const getTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, content, ticket_number)
         VALUES ($1, 'issue', 'Test Issue for Get', 'workspace', $2, $3, $4, $5)
         RETURNING id`,
        [
          testWorkspaceId,
          testUserId,
          JSON.stringify({ state: 'backlog', priority: 'medium' }),
          JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Detail content should still be returned' }] }] }),
          getTicketNumber,
        ]
      )
      testIssueId = requireFirstRow(issueResult.rows).id
    })

    it('should return issue by id', async () => {
      const res = await request(app)
        .get(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)

      const issue = expectOpenApiResponse({
        method: 'get',
        path: '/issues/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.id).toBe(testIssueId)
      expect(issue.title).toBe('Test Issue for Get')
      expect(issue.state).toBe('backlog')
      expect(issue.content).toMatchObject({ type: 'doc' })
      expect(issue.belongs_to).toBeInstanceOf(Array)
    })

    it('should return 404 for non-existent issue', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/issues/${fakeId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/issues/by-ticket/:number', () => {
    let testIssueId: string
    let ticketNumber: number

    beforeAll(async () => {
      const maxResult = await pool.query<NextTicketRow>(
        `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
         FROM documents WHERE workspace_id = $1 AND document_type = 'issue'`,
        [testWorkspaceId]
      )
      ticketNumber = requireFirstRow(maxResult.rows).next_number

      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Test Issue for Ticket', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), ticketNumber]
      )
      testIssueId = requireFirstRow(issueResult.rows).id
    })

    it('should find issue by ticket number', async () => {
      const res = await request(app)
        .get(`/api/issues/by-ticket/${ticketNumber}`)
        .set('Cookie', sessionCookie)

      const issue = expectOpenApiResponse({
        method: 'get',
        path: '/issues/by-ticket/{number}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.id).toBe(testIssueId)
      expect(issue.ticket_number).toBe(ticketNumber)
    })

    it('should return 404 for non-existent ticket number', async () => {
      const res = await request(app)
        .get('/api/issues/by-ticket/999999999')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/issues', () => {
    it('should create a new issue', async () => {
      const res = await request(app)
        .post('/api/issues')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'New Test Issue',
          belongs_to: [{ id: testProjectId, type: 'project' }],
        })

      const issue = expectOpenApiResponse({
        method: 'post',
        path: '/issues',
        status: 201,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.id).toBeDefined()
      expect(issue.title).toBe('New Test Issue')
      expect(issue.ticket_number).toBeDefined()
      expect(issue.state).toBe('backlog')
      expect(issue.priority).toBe('medium')
      expect(issue.belongs_to).toBeInstanceOf(Array)
    })

    it('should create issue with optional fields', async () => {
      const res = await request(app)
        .post('/api/issues')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Issue with State',
          state: 'in_progress',
          priority: 'high',
          belongs_to: [
            { id: testProjectId, type: 'project' },
          ],
        })

      const issue = expectOpenApiResponse({
        method: 'post',
        path: '/issues',
        status: 201,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.state).toBe('in_progress')
      expect(issue.priority).toBe('high')
    })

    it('should create issue without belongs_to (valid)', async () => {
      const res = await request(app)
        .post('/api/issues')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Issue Without Associations',
        })

      const issue = expectOpenApiResponse({
        method: 'post',
        path: '/issues',
        status: 201,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.belongs_to).toEqual([])
    })
  })

  describe('PATCH /api/issues/:id', () => {
    let testIssueId: string

    beforeAll(async () => {
      const patchTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Issue to Update', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), patchTicketNumber]
      )
      testIssueId = requireFirstRow(issueResult.rows).id
    })

    it('should update issue title', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Updated Issue Title',
        })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.title).toBe('Updated Issue Title')
    })

    it('should update issue state', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'done',
        })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.state).toBe('done')
    })

    it('should update issue belongs_to', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          belongs_to: [{ id: testProjectId, type: 'project' }],
        })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.belongs_to).toBeInstanceOf(Array)
      expect(issue.belongs_to.some((bt) => bt.id === testProjectId && bt.type === 'project')).toBe(true)
    })

    it('should return 404 for non-existent issue', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .patch(`/api/issues/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Should Fail',
        })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/issues/:id', () => {
    it('should soft-delete an issue', async () => {
      const deleteTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Issue to Delete', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), deleteTicketNumber]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      const res = await request(app)
        .delete(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(204)

      const rowResult = await pool.query<DeletedAtRow>(
        `SELECT deleted_at FROM documents WHERE id = $1 AND workspace_id = $2`,
        [issueId, testWorkspaceId]
      )
      expect(requireFirstRow(rowResult.rows).deleted_at).toBeTruthy()

      const getRes = await request(app)
        .get(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)

      expect(getRes.status).toBe(404)
    })

    it('should return 404 when deleting an already-deleted issue', async () => {
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, deleted_at)
         VALUES ($1, 'issue', 'Already Deleted Issue', 'workspace', $2, $3, NOW())
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      const res = await request(app)
        .delete(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(404)
    })

    it('should block deleting system-generated accountability issues', async () => {
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'System Generated Issue', 'workspace', $2, $3)
         RETURNING id`,
        [
          testWorkspaceId,
          testUserId,
          JSON.stringify({ state: 'backlog', priority: 'medium', is_system_generated: true }),
        ]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      const res = await request(app)
        .delete(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      const body = expectJsonBody(res, 403, ApiErrorBodySchema)
      expect(body.error).toBe('Cannot delete system-generated accountability issues')
    })
  })

  describe('GET /api/issues/:id/children', () => {
    let parentIssueId: string
    let childIssueId: string

    beforeAll(async () => {
      const parentTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const parentResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Parent Issue', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), parentTicketNumber]
      )
      parentIssueId = requireFirstRow(parentResult.rows).id

      const childTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const childResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Child Issue', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), childTicketNumber]
      )
      childIssueId = requireFirstRow(childResult.rows).id

      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'parent')`,
        [childIssueId, parentIssueId]
      )
    })

    it('should return child issues', async () => {
      const res = await request(app)
        .get(`/api/issues/${parentIssueId}/children`)
        .set('Cookie', sessionCookie)

      const children = expectOpenApiResponse({
        method: 'get',
        path: '/issues/{id}/children',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        arrayItemSchemaName: 'Issue',
        schema: IssueChildrenListSchema,
      })
      expect(children).toHaveLength(1)
      expect(children[0].id).toBe(childIssueId)
      expect(children[0].title).toBe('Child Issue')
    })
  })

  describe('POST /api/issues/bulk', () => {
    let issueIds: string[] = []

    async function createBulkIssue(title: string, properties: Record<string, unknown> = {}) {
      const ticketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const result = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', $2, 'workspace', $3, $4, $5)
         RETURNING id`,
        [
          testWorkspaceId,
          title,
          testUserId,
          JSON.stringify({ state: 'backlog', priority: 'medium', ...properties }),
          ticketNumber,
        ]
      )
      return requireFirstRow(result.rows).id
    }

    beforeAll(async () => {
      issueIds = []
      for (let i = 0; i < 3; i++) {
        issueIds.push(await createBulkIssue(`Bulk Issue ${i}`))
      }
    })

    it('should update multiple issues at once', async () => {
      const res = await request(app)
        .post('/api/issues/bulk')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          ids: issueIds,
          action: 'update',
          updates: {
            state: 'in_review',
          },
        })

      const bulkResult = expectOpenApiResponse({
        method: 'post',
        path: '/issues/bulk',
        status: 200,
        response: res,
        openApiSchemaName: 'BulkUpdateIssuesResponse',
        schema: BulkUpdateIssuesResponseSchema,
      })
      expect(bulkResult.updated).toHaveLength(3)

      for (const id of issueIds) {
        const getRes = await request(app)
          .get(`/api/issues/${id}`)
          .set('Cookie', sessionCookie)

        const issue = expectOpenApiResponse({
          method: 'get',
          path: '/issues/{id}',
          status: 200,
          response: getRes,
          openApiSchemaName: 'Issue',
          schema: IssueResponseSchema,
        })
        expect(issue.state).toBe('in_review')
      }
    })

    it('should bulk archive issues', async () => {
      const res = await request(app)
        .post('/api/issues/bulk')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          ids: issueIds,
          action: 'archive',
        })

      const bulkResult = expectOpenApiResponse({
        method: 'post',
        path: '/issues/bulk',
        status: 200,
        response: res,
        openApiSchemaName: 'BulkUpdateIssuesResponse',
        schema: BulkUpdateIssuesResponseSchema,
      })
      expect(bulkResult.updated.length).toBeGreaterThan(0)
    })

    it('should return refreshed belongs_to when bulk updating project and sprint associations', async () => {
      const firstIssueId = await createBulkIssue('Bulk Association Issue A', { estimate: 2 })
      const secondIssueId = await createBulkIssue('Bulk Association Issue B', { estimate: 3 })

      const res = await request(app)
        .post('/api/issues/bulk')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          ids: [firstIssueId, secondIssueId],
          action: 'update',
          updates: {
            project_id: testProjectId,
            sprint_id: testSprintId,
          },
        })

      const bulkResult = expectOpenApiResponse({
        method: 'post',
        path: '/issues/bulk',
        status: 200,
        response: res,
        openApiSchemaName: 'BulkUpdateIssuesResponse',
        schema: BulkUpdateIssuesResponseSchema,
      })
      expect(bulkResult.failed).toEqual([])
      expect(bulkResult.updated).toHaveLength(2)
      for (const issue of bulkResult.updated) {
        expect(issue.belongs_to).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: testProjectId, type: 'project' }),
          expect.objectContaining({ id: testSprintId, type: 'sprint' }),
        ]))
      }
    })

    it('should apply bulk sprint assignment per issue and reject unestimated issues', async () => {
      const estimatedIssueId = await createBulkIssue('Estimated Bulk Sprint Issue', { estimate: 1 })
      const unestimatedIssueId = await createBulkIssue('Unestimated Bulk Sprint Issue')

      const res = await request(app)
        .post('/api/issues/bulk')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          ids: [estimatedIssueId, unestimatedIssueId],
          action: 'update',
          updates: {
            sprint_id: testSprintId,
          },
        })

      const bulkResult = expectOpenApiResponse({
        method: 'post',
        path: '/issues/bulk',
        status: 200,
        response: res,
        openApiSchemaName: 'BulkUpdateIssuesResponse',
        schema: BulkUpdateIssuesResponseSchema,
      })
      expect(bulkResult.updated.map((issue) => issue.id)).toEqual([estimatedIssueId])
      expect(bulkResult.updated[0].belongs_to).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: testSprintId, type: 'sprint' }),
      ]))
      expect(bulkResult.failed).toEqual([
        { id: unestimatedIssueId, error: 'estimate_required_for_sprint_assignment' },
      ])

      const failedAssociation = await pool.query(
        `SELECT 1 FROM document_associations
         WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'sprint'`,
        [unestimatedIssueId, testSprintId]
      )
      expect(failedAssociation.rows).toHaveLength(0)
    })

    it('should allow bulk sprint unassignment without an estimate', async () => {
      const issueId = await createBulkIssue('Bulk Sprint Unassignment Issue')
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint')`,
        [issueId, testSprintId]
      )

      const res = await request(app)
        .post('/api/issues/bulk')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          ids: [issueId],
          action: 'update',
          updates: {
            sprint_id: null,
          },
        })

      const bulkResult = expectOpenApiResponse({
        method: 'post',
        path: '/issues/bulk',
        status: 200,
        response: res,
        openApiSchemaName: 'BulkUpdateIssuesResponse',
        schema: BulkUpdateIssuesResponseSchema,
      })
      expect(bulkResult.failed).toEqual([])
      expect(bulkResult.updated).toHaveLength(1)
      expect(bulkResult.updated[0].belongs_to).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: testSprintId, type: 'sprint' }),
      ]))
    })

    it('should allow non-sprint bulk updates without an estimate', async () => {
      const issueId = await createBulkIssue('Bulk Non Sprint Issue')

      const res = await request(app)
        .post('/api/issues/bulk')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          ids: [issueId],
          action: 'update',
          updates: {
            state: 'in_progress',
            project_id: testProjectId,
          },
        })

      const bulkResult = expectOpenApiResponse({
        method: 'post',
        path: '/issues/bulk',
        status: 200,
        response: res,
        openApiSchemaName: 'BulkUpdateIssuesResponse',
        schema: BulkUpdateIssuesResponseSchema,
      })
      expect(bulkResult.failed).toEqual([])
      expect(bulkResult.updated[0].state).toBe('in_progress')
      expect(bulkResult.updated[0].belongs_to).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: testProjectId, type: 'project' }),
      ]))
    })

    it('should block system-generated issues in bulk delete without blocking valid peers', async () => {
      const ordinaryIssueId = await createBulkIssue('Ordinary Bulk Delete Issue')
      const systemIssueId = await createBulkIssue('System Bulk Delete Issue', { is_system_generated: true })

      const res = await request(app)
        .post('/api/issues/bulk')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          ids: [ordinaryIssueId, systemIssueId],
          action: 'delete',
        })

      const bulkResult = expectOpenApiResponse({
        method: 'post',
        path: '/issues/bulk',
        status: 200,
        response: res,
        openApiSchemaName: 'BulkUpdateIssuesResponse',
        schema: BulkUpdateIssuesResponseSchema,
      })
      expect(bulkResult.updated.map((issue) => issue.id)).toEqual([ordinaryIssueId])
      expect(bulkResult.failed).toEqual([
        { id: systemIssueId, error: 'Cannot delete system-generated accountability issues' },
      ])
    })
  })

  describe('State Transitions', () => {
    let testIssueId: string

    beforeAll(async () => {
      const stateTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'State Test Issue', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), stateTicketNumber]
      )
      testIssueId = requireFirstRow(issueResult.rows).id
    })

    it('should transition from backlog to in_progress', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'in_progress',
        })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.state).toBe('in_progress')
    })

    it('should transition from in_progress to in_review', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'in_review',
        })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.state).toBe('in_review')
    })

    it('should transition to blocked', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'blocked',
        })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.state).toBe('blocked')
    })

    it('should transition from in_review to done', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'done',
        })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.state).toBe('done')
    })
  })

  describe('Issue Iterations', () => {
    let testIssueId: string

    beforeAll(async () => {
      const iterationTicketNumber = await nextIssueTicketNumber(testWorkspaceId)
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Blocked Evidence Issue', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'blocked', priority: 'urgent' }), iterationTicketNumber]
      )
      testIssueId = requireFirstRow(issueResult.rows).id
    })

    it('should record blocker evidence on an issue iteration', async () => {
      const res = await request(app)
        .post(`/api/issues/${testIssueId}/iterations`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          status: 'in_progress',
          what_attempted: 'Marked blocked from issue status UI',
          blockers_encountered: 'Waiting on procurement approval.',
        })

      const iteration = expectOpenApiResponse({
        method: 'post',
        path: '/issues/{id}/iterations',
        status: 201,
        response: res,
        openApiSchemaName: 'IssueIteration',
        schema: IssueIterationSchema,
      })
      expect(iteration.status).toBe('in_progress')
      expect(iteration.blockers_encountered).toBe('Waiting on procurement approval.')
      expect(iteration.author).toEqual(expect.objectContaining({
        id: testUserId,
        name: 'Issues Test User',
      }))
    })

    it('should list issue iterations with blocker evidence newest first', async () => {
      const res = await request(app)
        .get(`/api/issues/${testIssueId}/iterations`)
        .set('Cookie', sessionCookie)

      const iterations = expectOpenApiResponse({
        method: 'get',
        path: '/issues/{id}/iterations',
        status: 200,
        response: res,
        openApiSchemaName: 'IssueIteration',
        arrayItemSchemaName: 'IssueIteration',
        schema: IssueIterationListSchema,
      })
      expect(iterations).toEqual([
        expect.objectContaining({
          issue_id: testIssueId,
          status: 'in_progress',
          blockers_encountered: 'Waiting on procurement approval.',
        }),
      ])
    })

    it('should reject invalid issue iteration status filters', async () => {
      const res = await request(app)
        .get(`/api/issues/${testIssueId}/iterations?status=blocked`)
        .set('Cookie', sessionCookie)

      const body = expectJsonBody(res, 400, ApiErrorBodySchema)
      expect(body.error).toBe('Invalid input')
    })

    it('should reject invalid issue iteration payloads', async () => {
      const res = await request(app)
        .post(`/api/issues/${testIssueId}/iterations`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'blocked' })

      const body = expectJsonBody(res, 400, ApiErrorBodySchema)
      expect(body.error).toBe('Invalid input')
    })
  })
})
