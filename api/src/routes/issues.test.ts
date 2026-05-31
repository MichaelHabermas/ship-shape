// Issues API tests cover document-backed issue CRUD, filters, state changes, and iteration evidence.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

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
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Issues Test User')
       RETURNING id`,
      [testEmail]
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    // Get CSRF token
    const csrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie)
    csrfToken = csrfRes.body.token
    const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (connectSidCookie) {
      sessionCookie = `${sessionCookie}; ${connectSidCookie}`
    }

    // Create a program (required for project)
    const programResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility)
       VALUES ($1, 'program', 'Test Program', 'workspace')
       RETURNING id`,
      [testWorkspaceId]
    )
    testProgramId = programResult.rows[0].id

    // Create a project (required for issue)
    const projectResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, parent_id)
       VALUES ($1, 'project', 'Test Project', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testProgramId]
    )
    testProjectId = projectResult.rows[0].id

    // Create a sprint
    const sprintResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, parent_id)
       VALUES ($1, 'sprint', 'Test Sprint', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testProgramId]
    )
    testSprintId = sprintResult.rows[0].id
  })

  afterAll(async () => {
    // Clean up in correct order (foreign key constraints)
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
      // Create a test issue via direct SQL
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, content)
         VALUES ($1, 'issue', 'Test Issue for List', 'workspace', $2, $3, $4)
         RETURNING id`,
        [
          testWorkspaceId,
          testUserId,
          JSON.stringify({ state: 'backlog', priority: 'medium' }),
          JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'List content should stay out of issue lists' }] }] }),
        ]
      )
      testIssueId = issueResult.rows[0].id

      // Create project association in junction table
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

      expect(res.status).toBe(200)
      const issues = res.body as Array<{ id: string; title: string }>
      expect(issues).toBeInstanceOf(Array)
      expect(issues.length).toBeGreaterThan(0)

      // Find our test issue
      const testIssue = issues.find((i) => i.id === testIssueId)
      expect(testIssue).toBeDefined()
      expect(testIssue.title).toBe('Test Issue for List')
      expect(testIssue).not.toHaveProperty('content')
    })

    it('should filter issues by sprint_id', async () => {
      // Create an issue with sprint association
      const sprintIssueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Sprint Issue', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      const sprintIssueId = sprintIssueResult.rows[0].id

      // Create sprint association in junction table
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint')`,
        [sprintIssueId, testSprintId]
      )

      const res = await request(app)
        .get(`/api/issues?sprint_id=${testSprintId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      const sprintIssues = res.body as Array<{ id: string }>
      expect(sprintIssues).toBeInstanceOf(Array)
      const hasSprintIssue = sprintIssues.some((i) => i.id === sprintIssueId)
      expect(hasSprintIssue).toBe(true)
    })

    it('should filter issues by project_id', async () => {
      // Risk: project filtering must narrow through document_associations, or project views can show unrelated work.
      const unrelatedIssueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Unrelated Project Issue', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      const unrelatedIssueId = unrelatedIssueResult.rows[0].id

      const res = await request(app)
        .get(`/api/issues?project_id=${testProjectId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      const projectIssues = res.body as Array<{ id: string }>
      expect(projectIssues).toBeInstanceOf(Array)
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
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, content)
         VALUES ($1, 'issue', 'Test Issue for Get', 'workspace', $2, $3, $4)
         RETURNING id`,
        [
          testWorkspaceId,
          testUserId,
          JSON.stringify({ state: 'backlog', priority: 'medium' }),
          JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Detail content should still be returned' }] }] }),
        ]
      )
      testIssueId = issueResult.rows[0].id
    })

    it('should return issue by id', async () => {
      const res = await request(app)
        .get(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(testIssueId)
      expect(res.body.title).toBe('Test Issue for Get')
      expect(res.body.state).toBe('backlog')
      expect(res.body.content).toMatchObject({ type: 'doc' })
      expect(res.body.belongs_to).toBeInstanceOf(Array)
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
      // Get next available ticket number for this workspace
      const maxResult = await pool.query(
        `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
         FROM documents WHERE workspace_id = $1 AND document_type = 'issue'`,
        [testWorkspaceId]
      )
      ticketNumber = maxResult.rows[0].next_number

      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, ticket_number)
         VALUES ($1, 'issue', 'Test Issue for Ticket', 'workspace', $2, $3, $4)
         RETURNING id, ticket_number`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' }), ticketNumber]
      )
      testIssueId = issueResult.rows[0].id
    })

    it('should find issue by ticket number', async () => {
      const res = await request(app)
        .get(`/api/issues/by-ticket/${ticketNumber}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(testIssueId)
      expect(res.body.ticket_number).toBe(ticketNumber)
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

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.title).toBe('New Test Issue')
      expect(res.body.ticket_number).toBeDefined()
      expect(res.body.state).toBe('backlog')
      expect(res.body.priority).toBe('medium')
      expect(res.body.belongs_to).toBeInstanceOf(Array)
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

      expect(res.status).toBe(201)
      expect(res.body.state).toBe('in_progress')
      expect(res.body.priority).toBe('high')
    })

    it('should create issue without belongs_to (valid)', async () => {
      // API allows creating issues without associations
      const res = await request(app)
        .post('/api/issues')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Issue Without Associations',
        })

      expect(res.status).toBe(201)
      expect(res.body.belongs_to).toEqual([])
    })
  })

  describe('PATCH /api/issues/:id', () => {
    let testIssueId: string

    beforeAll(async () => {
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Issue to Update', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      testIssueId = issueResult.rows[0].id
    })

    it('should update issue title', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Updated Issue Title',
        })

      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Updated Issue Title')
    })

    it('should update issue state', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'done',
        })

      expect(res.status).toBe(200)
      expect(res.body.state).toBe('done')
    })

    it('should update issue belongs_to', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          belongs_to: [{ id: testProjectId, type: 'project' }],
        })

      expect(res.status).toBe(200)
      const updated = res.body as { belongs_to: Array<{ id: string; type: string }> }
      expect(updated.belongs_to).toBeInstanceOf(Array)
      expect(updated.belongs_to.some((bt) => bt.id === testProjectId && bt.type === 'project')).toBe(true)
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
      // Create issue to delete
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Issue to Delete', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      const issueId = issueResult.rows[0].id

      const res = await request(app)
        .delete(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(204)

      const rowResult = await pool.query(
        `SELECT deleted_at FROM documents WHERE id = $1 AND workspace_id = $2`,
        [issueId, testWorkspaceId]
      )
      expect(rowResult.rows[0].deleted_at).toBeTruthy()

      const getRes = await request(app)
        .get(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)

      expect(getRes.status).toBe(404)
    })

    it('should return 404 when deleting an already-deleted issue', async () => {
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties, deleted_at)
         VALUES ($1, 'issue', 'Already Deleted Issue', 'workspace', $2, $3, NOW())
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      const issueId = issueResult.rows[0].id

      const res = await request(app)
        .delete(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(404)
    })

    it('should block deleting system-generated accountability issues', async () => {
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'System Generated Issue', 'workspace', $2, $3)
         RETURNING id`,
        [
          testWorkspaceId,
          testUserId,
          JSON.stringify({ state: 'backlog', priority: 'medium', is_system_generated: true }),
        ]
      )
      const issueId = issueResult.rows[0].id

      const res = await request(app)
        .delete(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(403)
      expect(res.body.error).toBe('Cannot delete system-generated accountability issues')
    })
  })

  describe('GET /api/issues/:id/children', () => {
    let parentIssueId: string
    let childIssueId: string

    beforeAll(async () => {
      // Create parent issue
      const parentResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Parent Issue', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      parentIssueId = parentResult.rows[0].id

      // Create child issue
      const childResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Child Issue', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      childIssueId = childResult.rows[0].id

      // Create parent association in junction table (child points to parent)
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

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBe(1)
      expect(res.body[0].id).toBe(childIssueId)
      expect(res.body[0].title).toBe('Child Issue')
    })
  })

  describe('POST /api/issues/bulk', () => {
    let issueIds: string[] = []

    async function createBulkIssue(title: string, properties: Record<string, unknown> = {}) {
      const result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', $2, 'workspace', $3, $4)
         RETURNING id`,
        [
          testWorkspaceId,
          title,
          testUserId,
          JSON.stringify({ state: 'backlog', priority: 'medium', ...properties }),
        ]
      )
      return result.rows[0].id as string
    }

    beforeAll(async () => {
      issueIds = []
      // Create multiple issues for bulk operations
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

      expect(res.status).toBe(200)
      expect(res.body.updated).toBeInstanceOf(Array)
      expect(res.body.updated.length).toBe(3)

      // Verify updates
      for (const id of issueIds) {
        const getRes = await request(app)
          .get(`/api/issues/${id}`)
          .set('Cookie', sessionCookie)

        expect(getRes.body.state).toBe('in_review')
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

      expect(res.status).toBe(200)
      expect(res.body.updated).toBeInstanceOf(Array)
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

      expect(res.status).toBe(200)
      expect(res.body.failed).toEqual([])
      expect(res.body.updated).toHaveLength(2)
      for (const issue of res.body.updated) {
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

      expect(res.status).toBe(200)
      const bulkSprintResult = res.body as {
        updated: Array<{ id: string; belongs_to: Array<{ id: string; type: string }> }>
        failed: unknown[]
      }
      expect(bulkSprintResult.updated.map((issue) => issue.id)).toEqual([estimatedIssueId])
      expect(bulkSprintResult.updated[0].belongs_to).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: testSprintId, type: 'sprint' }),
      ]))
      expect(bulkSprintResult.failed).toEqual([
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

      expect(res.status).toBe(200)
      expect(res.body.failed).toEqual([])
      expect(res.body.updated).toHaveLength(1)
      expect(res.body.updated[0].belongs_to).not.toEqual(expect.arrayContaining([
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

      expect(res.status).toBe(200)
      expect(res.body.failed).toEqual([])
      expect(res.body.updated[0].state).toBe('in_progress')
      expect(res.body.updated[0].belongs_to).toEqual(expect.arrayContaining([
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

      expect(res.status).toBe(200)
      const bulkDeleteResult = res.body as {
        updated: Array<{ id: string }>
        failed: Array<{ id: string; error: string }>
      }
      expect(bulkDeleteResult.updated.map((issue) => issue.id)).toEqual([ordinaryIssueId])
      expect(bulkDeleteResult.failed).toEqual([
        { id: systemIssueId, error: 'Cannot delete system-generated accountability issues' },
      ])
    })
  })

  describe('State Transitions', () => {
    let testIssueId: string

    beforeAll(async () => {
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'State Test Issue', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'backlog', priority: 'medium' })]
      )
      testIssueId = issueResult.rows[0].id
    })

    it('should transition from backlog to in_progress', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'in_progress',
        })

      expect(res.status).toBe(200)
      expect(res.body.state).toBe('in_progress')
    })

    it('should transition from in_progress to in_review', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'in_review',
        })

      expect(res.status).toBe(200)
      expect(res.body.state).toBe('in_review')
    })

    it('should transition to blocked', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'blocked',
        })

      expect(res.status).toBe(200)
      expect(res.body.state).toBe('blocked')
    })

    it('should transition from in_review to done', async () => {
      const res = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'done',
        })

      expect(res.status).toBe(200)
      expect(res.body.state).toBe('done')
    })
  })

  describe('Issue Iterations', () => {
    let testIssueId: string

    beforeAll(async () => {
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Blocked Evidence Issue', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ state: 'blocked', priority: 'urgent' })]
      )
      testIssueId = issueResult.rows[0].id
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

      expect(res.status).toBe(201)
      expect(res.body.status).toBe('in_progress')
      expect(res.body.blockers_encountered).toBe('Waiting on procurement approval.')
      expect(res.body.author).toEqual(expect.objectContaining({
        id: testUserId,
        name: 'Issues Test User',
      }))
    })

    it('should list issue iterations with blocker evidence newest first', async () => {
      const res = await request(app)
        .get(`/api/issues/${testIssueId}/iterations`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([
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

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid input')
    })

    it('should reject invalid issue iteration payloads', async () => {
      const res = await request(app)
        .post(`/api/issues/${testIssueId}/iterations`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ status: 'blocked' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid input')
    })
  })
})
