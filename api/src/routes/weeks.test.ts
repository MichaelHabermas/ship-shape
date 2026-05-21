import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Sprints API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `sprints-test-${testRunId}@ship.local`
  const testWorkspaceName = `Sprints Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let testProgramId: string

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
       VALUES ($1, 'test-hash', 'Sprints Test User')
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

    // Create a program (required for sprint)
    const programResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility)
       VALUES ($1, 'program', 'Test Program', 'workspace')
       RETURNING id`,
      [testWorkspaceId]
    )
    testProgramId = programResult.rows[0].id

    // Create a project
    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, parent_id)
       VALUES ($1, 'project', 'Test Project', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testProgramId]
    )
  })

  afterAll(async () => {
    // Clean up in correct order (foreign key constraints)
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('GET /api/weeks', () => {
    let testSprintId: string

    beforeAll(async () => {
      // Create a test sprint with sprint_number: 1 (matches default current sprint)
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'sprint', 'Test Sprint for List', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 1 })]
      )
      testSprintId = sprintResult.rows[0].id
      // Create program association via document_associations
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [testSprintId, testProgramId]
      )
    })

    it('should return list of sprints', async () => {
      const res = await request(app)
        .get('/api/weeks')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.weeks).toBeInstanceOf(Array)
      expect(res.body.weeks.length).toBeGreaterThan(0)

      // Find our test sprint
      const testSprint = res.body.weeks.find((s: { id: string }) => s.id === testSprintId)
      expect(testSprint).toBeDefined()
      expect(testSprint.name).toBe('Test Sprint for List')
    })

    it('should filter sprints by program_id', async () => {
      const res = await request(app)
        .get(`/api/weeks?program_id=${testProgramId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.weeks).toBeInstanceOf(Array)
      const allMatchProgram = res.body.weeks.every((s: { program_id: string }) => s.program_id === testProgramId)
      expect(allMatchProgram).toBe(true)
    })

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .get('/api/weeks')

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/weeks/:id', () => {
    let testSprintId: string

    beforeAll(async () => {
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'sprint', 'Test Sprint for Get', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testSprintId = sprintResult.rows[0].id
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [testSprintId, testProgramId]
      )
    })

    it('should return sprint by id', async () => {
      const res = await request(app)
        .get(`/api/weeks/${testSprintId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(testSprintId)
      expect(res.body.name).toBe('Test Sprint for Get')
    })

    it('should return 404 for non-existent sprint', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/weeks/${fakeId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/weeks', () => {
    it('should create a new sprint', async () => {
      const res = await request(app)
        .post('/api/weeks')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'New Test Sprint',
          program_id: testProgramId,
          sprint_number: 100,
        })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.name).toBe('New Test Sprint')
      expect(res.body.program_id).toBe(testProgramId)
    })

    it('should create sprint with dates', async () => {
      const res = await request(app)
        .post('/api/weeks')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Sprint with Dates',
          program_id: testProgramId,
          sprint_number: 2,
        })

      // Dates are computed on frontend from sprint_number + workspace.sprint_start_date
      expect(res.status).toBe(201)
      expect(res.body.sprint_number).toBe(2)
      expect(res.body.workspace_sprint_start_date).toBeDefined()
    })

    it('should create sprint with plan', async () => {
      const res = await request(app)
        .post('/api/weeks')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Sprint with Plan',
          program_id: testProgramId,
          sprint_number: 3,
          plan: 'If we implement feature X, then metric Y will improve by Z%',
        })

      expect(res.status).toBe(201)
      expect(res.body.plan).toBe('If we implement feature X, then metric Y will improve by Z%')
    })

    it('should require sprint_number', async () => {
      const res = await request(app)
        .post('/api/weeks')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Sprint Without Number',
          program_id: testProgramId,
        })

      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /api/weeks/:id', () => {
    let testSprintId: string

    beforeAll(async () => {
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'sprint', 'Sprint to Update', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testSprintId = sprintResult.rows[0].id
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [testSprintId, testProgramId]
      )
    })

    it('should update sprint title', async () => {
      const res = await request(app)
        .patch(`/api/weeks/${testSprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Updated Sprint Title',
        })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Updated Sprint Title')
    })

    it('should update sprint_number via PATCH', async () => {
      // Sprint status is computed from dates, sprint_number can be updated
      const res = await request(app)
        .patch(`/api/weeks/${testSprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          sprint_number: 99,
        })

      expect(res.status).toBe(200)
      expect(res.body.sprint_number).toBe(99)
    })

    it('should return 404 for non-existent sprint', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .patch(`/api/weeks/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Should Fail',
        })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/weeks/:id', () => {
    it('should delete a sprint', async () => {
      // Create sprint to delete
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'sprint', 'Sprint to Delete', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const sprintId = sprintResult.rows[0].id
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [sprintId, testProgramId]
      )

      const res = await request(app)
        .delete(`/api/weeks/${sprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(204)

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/weeks/${sprintId}`)
        .set('Cookie', sessionCookie)

      expect(getRes.status).toBe(404)
    })
  })

  describe('PATCH /api/weeks/:id/plan', () => {
    let testSprintId: string

    beforeAll(async () => {
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'sprint', 'Sprint for Plan', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testSprintId = sprintResult.rows[0].id
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [testSprintId, testProgramId]
      )
    })

    it('should update sprint plan', async () => {
      const res = await request(app)
        .patch(`/api/weeks/${testSprintId}/plan`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          plan: 'Updated plan text',
        })

      expect(res.status).toBe(200)
      expect(res.body.plan).toBe('Updated plan text')
    })
  })

  describe('GET /api/weeks/:id/issues', () => {
    let testSprintId: string
    let testIssueId: string

    beforeAll(async () => {
      // Create sprint
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'sprint', 'Sprint for Issues', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testSprintId = sprintResult.rows[0].id
      // Create program association for sprint
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [testSprintId, testProgramId]
      )

      // Create issue assigned to sprint
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'issue', 'Issue in Sprint', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testIssueId = issueResult.rows[0].id
      // Create sprint association for issue
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint')`,
        [testIssueId, testSprintId]
      )
    })

    it('should return issues assigned to sprint', async () => {
      const res = await request(app)
        .get(`/api/weeks/${testSprintId}/issues`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBe(1)
      expect(res.body[0].id).toBe(testIssueId)
      expect(res.body[0].title).toBe('Issue in Sprint')
    })
  })

  describe('Sprint Lifecycle', () => {
    let testSprintId: string

    beforeAll(async () => {
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'sprint', 'Lifecycle Sprint', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 10 })]
      )
      testSprintId = sprintResult.rows[0].id
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [testSprintId, testProgramId]
      )
    })

    it('should update sprint_number', async () => {
      const res = await request(app)
        .patch(`/api/weeks/${testSprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          sprint_number: 11,
        })

      expect(res.status).toBe(200)
      expect(res.body.sprint_number).toBe(11)
    })

    it('should update sprint title', async () => {
      const res = await request(app)
        .patch(`/api/weeks/${testSprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Updated Lifecycle Sprint',
        })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Updated Lifecycle Sprint')
    })
  })

  describe('GET /api/weeks/my-week', () => {
    it('should return my-week data', async () => {
      const res = await request(app)
        .get('/api/weeks/my-week')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      // my-week returns aggregated data
      expect(res.body).toBeDefined()
    })
  })

  describe('GET /api/weeks/my-action-items', () => {
    it('should return my action items', async () => {
      const res = await request(app)
        .get('/api/weeks/my-action-items')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.action_items).toBeInstanceOf(Array)
    })
  })

  describe('POST /api/weeks/:id/start', () => {
    it('should start a planning sprint and capture scope snapshot', async () => {
      // Create a sprint in planning status
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'sprint', 'Sprint to Start', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 50, status: 'planning' })]
      )
      const sprintId = sprintResult.rows[0].id
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [sprintId, testProgramId]
      )

      // Create an issue assigned to the sprint
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'issue', 'Issue for Snapshot', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const issueId = issueResult.rows[0].id

      // Link issue to sprint via document_associations (required for sprint snapshot)
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint')`,
        [issueId, sprintId]
      )

      const res = await request(app)
        .post(`/api/weeks/${sprintId}/start`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('active')
      expect(res.body.snapshot_issue_count).toBe(1)
    })

    it('should reject starting an already active sprint', async () => {
      // Create a sprint that's already active
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'sprint', 'Already Active Sprint', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 51, status: 'active' })]
      )
      const sprintId = sprintResult.rows[0].id
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [sprintId, testProgramId]
      )

      const res = await request(app)
        .post(`/api/weeks/${sprintId}/start`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('already active')
    })

    it('should return 404 for non-existent sprint', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .post(`/api/weeks/${fakeId}/start`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/weeks/:id/carryover', () => {
    let sourceSprintId: string
    let targetSprintId: string
    let issueId1: string
    let issueId2: string

    beforeAll(async () => {
      // Create source sprint (completed)
      const sourceResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'sprint', 'Source Sprint for Carryover', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 100, status: 'completed' })]
      )
      sourceSprintId = sourceResult.rows[0].id
      // Create program association for source sprint
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [sourceSprintId, testProgramId]
      )

      // Create target sprint (planning)
      const targetResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'sprint', 'Target Sprint for Carryover', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 101, status: 'planning' })]
      )
      targetSprintId = targetResult.rows[0].id
      // Create program association for target sprint
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [targetSprintId, testProgramId]
      )

      // Create test issues
      const issue1Result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Issue 1 for Carryover', 'workspace', $2, '{}')
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      issueId1 = issue1Result.rows[0].id
      // Create program association for issue 1
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [issueId1, testProgramId]
      )

      const issue2Result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Issue 2 for Carryover', 'workspace', $2, '{}')
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      issueId2 = issue2Result.rows[0].id
      // Create program association for issue 2
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [issueId2, testProgramId]
      )

      // Associate issues with source sprint
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint'), ($3, $2, 'sprint')`,
        [issueId1, sourceSprintId, issueId2]
      )
    })

    it('should move issues from source sprint to target sprint', async () => {
      const res = await request(app)
        .post(`/api/weeks/${sourceSprintId}/carryover`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          issue_ids: [issueId1],
          target_sprint_id: targetSprintId
        })

      expect(res.status).toBe(200)
      expect(res.body.moved_count).toBe(1)
      expect(res.body.source_sprint.id).toBe(sourceSprintId)
      expect(res.body.target_sprint.id).toBe(targetSprintId)

      // Verify issue is now in target sprint
      const assocResult = await pool.query(
        `SELECT related_id FROM document_associations
         WHERE document_id = $1 AND relationship_type = 'sprint'`,
        [issueId1]
      )
      expect(assocResult.rows[0].related_id).toBe(targetSprintId)

      // Verify carryover_from_sprint_id is set
      const issueResult = await pool.query(
        `SELECT properties FROM documents WHERE id = $1`,
        [issueId1]
      )
      expect(issueResult.rows[0].properties.carryover_from_sprint_id).toBe(sourceSprintId)
    })

    it('should reject carryover to completed sprint', async () => {
      // Create a completed sprint
      const completedResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'sprint', 'Completed Sprint', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 102, status: 'completed' })]
      )
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [completedResult.rows[0].id, testProgramId]
      )

      const res = await request(app)
        .post(`/api/weeks/${sourceSprintId}/carryover`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          issue_ids: [issueId2],
          target_sprint_id: completedResult.rows[0].id
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('planning or active')
    })

    it('should reject issues not in source sprint', async () => {
      // Create an issue NOT in the source sprint
      const unrelatedResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'issue', 'Unrelated Issue', 'workspace', $2, '{}')
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [unrelatedResult.rows[0].id, testProgramId]
      )

      const res = await request(app)
        .post(`/api/weeks/${sourceSprintId}/carryover`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          issue_ids: [unrelatedResult.rows[0].id],
          target_sprint_id: targetSprintId
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('not found in source week')
    })

    it('should return 404 for non-existent source sprint', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .post(`/api/weeks/${fakeId}/carryover`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          issue_ids: [issueId2],
          target_sprint_id: targetSprintId
        })

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/weeks/:id/approve-review and approve-plan comments', () => {
    let adminCookie: string
    let adminCsrfToken: string
    let adminUserId: string
    let approvalSprintId: string

    beforeAll(async () => {
      // Create admin user for approval tests
      const adminEmail = `admin-${testRunId}@ship.local`
      const adminResult = await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, 'test-hash', 'Admin User')
         RETURNING id`,
        [adminEmail]
      )
      adminUserId = adminResult.rows[0].id

      // Create admin workspace membership
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'admin')`,
        [testWorkspaceId, adminUserId]
      )

      // Create admin session
      const adminSessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [adminSessionId, adminUserId, testWorkspaceId]
      )
      adminCookie = `session_id=${adminSessionId}`

      // Get CSRF token for admin
      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', adminCookie)
      adminCsrfToken = csrfRes.body.token
      const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
      if (connectSidCookie) {
        adminCookie = `${adminCookie}; ${connectSidCookie}`
      }

      // Create sprint for approval tests
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'sprint', 'Sprint for Approval', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testUserId, JSON.stringify({ sprint_number: 50 })]
      )
      approvalSprintId = sprintResult.rows[0].id

      // Create program association for sprint
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [approvalSprintId, testProgramId]
      )
    })

    it('should reject review approval without rating', async () => {
      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Rating is required')
    })

    it('should approve review with rating', async () => {
      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ rating: 3 })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.approval.state).toBe('approved')
      expect(res.body.review_rating).toBeDefined()
      expect(res.body.review_rating.value).toBe(3)
      expect(res.body.review_rating.rated_by).toBe(adminUserId)
      expect(res.body.review_rating.rated_at).toBeDefined()
    })

    it('should approve plan with optional comment', async () => {
      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-plan`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ comment: 'Onboarding week, expected slower output' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.approval.state).toBe('approved')
      expect(res.body.approval.comment).toBe('Onboarding week, expected slower output')
    })

    it('should approve review with rating and optional comment', async () => {
      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ rating: 4, comment: 'Strong retrospective with clear learnings' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.approval.comment).toBe('Strong retrospective with clear learnings')
      expect(res.body.review_rating.value).toBe(4)
    })

    it('should accept all valid ratings (1-5)', async () => {
      for (const rating of [1, 2, 3, 4, 5]) {
        const res = await request(app)
          .post(`/api/weeks/${approvalSprintId}/approve-review`)
          .set('Cookie', adminCookie)
          .set('x-csrf-token', adminCsrfToken)
          .send({ rating })

        expect(res.status).toBe(200)
        expect(res.body.review_rating.value).toBe(rating)
      }
    })

    it('should reject rating of 0', async () => {
      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ rating: 0 })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Rating must be an integer between 1 and 5')
    })

    it('should reject rating of 6', async () => {
      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ rating: 6 })

      expect(res.status).toBe(400)
    })

    it('should reject non-integer rating', async () => {
      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ rating: 3.5 })

      expect(res.status).toBe(400)
    })

    it('should persist rating in sprint properties', async () => {
      // Set a rating
      await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ rating: 4 })

      // Verify via direct DB query
      const dbResult = await pool.query(
        `SELECT properties->'review_rating' as review_rating FROM documents WHERE id = $1`,
        [approvalSprintId]
      )
      expect(dbResult.rows[0].review_rating.value).toBe(4)
    })

    it('should allow editing approval comment and log review_approval history', async () => {
      await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ rating: 3, comment: 'Initial note' })

      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', adminCookie)
        .set('x-csrf-token', adminCsrfToken)
        .send({ rating: 3, comment: 'Updated note after follow-up' })

      expect(res.status).toBe(200)
      expect(res.body.approval.comment).toBe('Updated note after follow-up')

      const historyResult = await pool.query(
        `SELECT field, old_value, new_value
         FROM document_history
         WHERE document_id = $1
           AND field = 'review_approval'
         ORDER BY id DESC
         LIMIT 1`,
        [approvalSprintId]
      )

      expect(historyResult.rows.length).toBeGreaterThan(0)
      expect(historyResult.rows[0].old_value).toContain('Initial note')
      expect(historyResult.rows[0].new_value).toContain('Updated note after follow-up')
    })

    it('should reject non-admin non-accountable user', async () => {
      const res = await request(app)
        .post(`/api/weeks/${approvalSprintId}/approve-review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ rating: 3 })

      expect(res.status).toBe(403)
    })
  })

  describe('GET /api/team/reviews', () => {
    let adminCookie2: string

    beforeAll(async () => {
      // Reuse admin from previous test or create one
      const adminEmail2 = `admin2-${testRunId}@ship.local`
      const adminResult = await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, 'test-hash', 'Admin User 2')
         RETURNING id`,
        [adminEmail2]
      )
      const adminUserId2 = adminResult.rows[0].id

      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'admin')`,
        [testWorkspaceId, adminUserId2]
      )

      const adminSessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [adminSessionId, adminUserId2, testWorkspaceId]
      )
      adminCookie2 = `session_id=${adminSessionId}`

      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', adminCookie2)
      const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
      if (connectSidCookie) {
        adminCookie2 = `${adminCookie2}; ${connectSidCookie}`
      }
    })

    it('should return reviews data for admin', async () => {
      const res = await request(app)
        .get('/api/team/reviews')
        .set('Cookie', adminCookie2)

      expect(res.status).toBe(200)
      expect(res.body.people).toBeInstanceOf(Array)
      expect(res.body.weeks).toBeInstanceOf(Array)
      expect(res.body.reviews).toBeDefined()
      expect(res.body.currentSprintNumber).toBeGreaterThan(0)
    })

    it('should support sprint_count parameter', async () => {
      const res = await request(app)
        .get('/api/team/reviews?sprint_count=3')
        .set('Cookie', adminCookie2)

      expect(res.status).toBe(200)
      expect(res.body.weeks.length).toBeLessThanOrEqual(3)
    })

    it('should reject non-admin user', async () => {
      const res = await request(app)
        .get('/api/team/reviews')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(403)
    })

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .get('/api/team/reviews')

      expect(res.status).toBe(401)
    })
  })
})
