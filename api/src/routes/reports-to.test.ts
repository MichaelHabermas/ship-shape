import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Reports-To Features', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testWorkspaceName = `ReportsTo Test ${testRunId}`

  let testWorkspaceId: string
  let adminUserId: string
  let adminCookie: string
  let adminCsrf: string
  let memberUserId: string
  let memberCookie: string
  let memberCsrf: string
  let adminPersonDocId: string
  let memberPersonDocId: string
  let testProgramId: string
  let testSprintId: string

  beforeAll(async () => {
    // Create workspace
    const wsResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = wsResult.rows[0].id

    // Create admin user
    const adminResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Admin User')
       RETURNING id`,
      [`reports-to-admin-${testRunId}@ship.local`]
    )
    adminUserId = adminResult.rows[0].id

    // Create member user
    const memberResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Member User')
       RETURNING id`,
      [`reports-to-member-${testRunId}@ship.local`]
    )
    memberUserId = memberResult.rows[0].id

    // Create workspace memberships
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, adminUserId]
    )
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, memberUserId]
    )

    // Create person documents
    const adminPersonResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'person', 'Admin User', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, adminUserId, JSON.stringify({ user_id: adminUserId, email: `reports-to-admin-${testRunId}@ship.local` })]
    )
    adminPersonDocId = adminPersonResult.rows[0].id

    const memberPersonResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'person', 'Member User', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, memberUserId, JSON.stringify({ user_id: memberUserId, email: `reports-to-member-${testRunId}@ship.local` })]
    )
    memberPersonDocId = memberPersonResult.rows[0].id

    // Create sessions
    const adminSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [adminSessionId, adminUserId, testWorkspaceId]
    )
    adminCookie = `session_id=${adminSessionId}`

    const memberSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [memberSessionId, memberUserId, testWorkspaceId]
    )
    memberCookie = `session_id=${memberSessionId}`

    // Get CSRF tokens
    const adminCsrfRes = await request(app).get('/api/csrf-token').set('Cookie', adminCookie)
    adminCsrf = adminCsrfRes.body.token
    const adminConnectSid = adminCsrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (adminConnectSid) adminCookie = `${adminCookie}; ${adminConnectSid}`

    const memberCsrfRes = await request(app).get('/api/csrf-token').set('Cookie', memberCookie)
    memberCsrf = memberCsrfRes.body.token
    const memberConnectSid = memberCsrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (memberConnectSid) memberCookie = `${memberCookie}; ${memberConnectSid}`

    // Create program with admin as accountable
    const programResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'program', 'Test Program', 'workspace', $2) RETURNING id`,
      [testWorkspaceId, JSON.stringify({ accountable_id: adminUserId })]
    )
    testProgramId = programResult.rows[0].id

    // Create sprint owned by member, associated with program
    const sprintResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'sprint', 'Test Sprint', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, memberUserId, JSON.stringify({
        sprint_number: 1,
        owner_id: memberPersonDocId,
        assignee_ids: [memberUserId],
      })]
    )
    testSprintId = sprintResult.rows[0].id

    // Associate sprint with program
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program')`,
      [testSprintId, testProgramId]
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM sessions WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [adminUserId, memberUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('reports_to admin-only restriction', () => {
    it('should allow admin to set reports_to on a person document', async () => {
      const res = await request(app)
        .patch(`/api/documents/${memberPersonDocId}`)
        .set('Cookie', adminCookie)
        .set('X-CSRF-Token', adminCsrf)
        .send({ properties: { reports_to: adminUserId } })

      expect(res.status).toBe(200)

      // Verify it was saved
      const doc = await pool.query('SELECT properties FROM documents WHERE id = $1', [memberPersonDocId])
      expect(doc.rows[0].properties.reports_to).toBe(adminUserId)
    })

    it('should reject non-admin setting reports_to on a person document', async () => {
      const res = await request(app)
        .patch(`/api/documents/${adminPersonDocId}`)
        .set('Cookie', memberCookie)
        .set('X-CSRF-Token', memberCsrf)
        .send({ properties: { reports_to: memberUserId } })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Only workspace admins')
    })

    it('should allow non-admin to update other person properties', async () => {
      // Member should be able to update non-reports_to properties
      const res = await request(app)
        .patch(`/api/documents/${memberPersonDocId}`)
        .set('Cookie', memberCookie)
        .set('X-CSRF-Token', memberCsrf)
        .send({ properties: { role: 'Engineer' } })

      expect(res.status).toBe(200)
    })
  })

  describe('approval authorization with reports_to', () => {
    let supervisorUserId: string
    let supervisorCookie: string
    let supervisorCsrf: string

    beforeAll(async () => {
      // Create a supervisor user
      const supervisorResult = await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, 'test-hash', 'Supervisor User') RETURNING id`,
        [`reports-to-supervisor-${testRunId}@ship.local`]
      )
      supervisorUserId = supervisorResult.rows[0].id

      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
        [testWorkspaceId, supervisorUserId]
      )

      // Create supervisor's person document
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'person', 'Supervisor User', 'workspace', $2, $3)`,
        [testWorkspaceId, supervisorUserId, JSON.stringify({ user_id: supervisorUserId })]
      )

      // Set member's reports_to to supervisor
      await pool.query(
        `UPDATE documents SET properties = properties || jsonb_build_object('reports_to', $1::text)
         WHERE id = $2`,
        [supervisorUserId, memberPersonDocId]
      )

      // Create session for supervisor
      const sessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [sessionId, supervisorUserId, testWorkspaceId]
      )
      supervisorCookie = `session_id=${sessionId}`

      const csrfRes = await request(app).get('/api/csrf-token').set('Cookie', supervisorCookie)
      supervisorCsrf = csrfRes.body.token
      const connectSid = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
      if (connectSid) supervisorCookie = `${supervisorCookie}; ${connectSid}`

      // Create a weekly plan for the sprint (so there's something to approve)
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, parent_id, properties)
         VALUES ($1, 'weekly_plan', 'Test Plan', 'workspace', $2, $3, $4)`,
        [testWorkspaceId, memberUserId, testSprintId, JSON.stringify({
          person_id: memberPersonDocId,
          week_number: 1,
        })]
      )
    })

    afterAll(async () => {
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [supervisorUserId])
      await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [supervisorUserId])
      await pool.query('DELETE FROM documents WHERE workspace_id = $1 AND properties->>\'user_id\' = $2', [testWorkspaceId, supervisorUserId])
      await pool.query('DELETE FROM users WHERE id = $1', [supervisorUserId])
    })

    it('should allow supervisor to approve plan via reports_to', async () => {
      const res = await request(app)
        .post(`/api/weeks/${testSprintId}/approve-plan`)
        .set('Cookie', supervisorCookie)
        .set('X-CSRF-Token', supervisorCsrf)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.approval.state).toBe('approved')
    })

    it('should reject random non-supervisor non-admin user from approving', async () => {
      // Create a random user who is neither supervisor nor accountable nor admin
      const randomResult = await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, 'test-hash', 'Random User') RETURNING id`,
        [`reports-to-random-${testRunId}@ship.local`]
      )
      const randomUserId = randomResult.rows[0].id

      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
        [testWorkspaceId, randomUserId]
      )

      const sessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [sessionId, randomUserId, testWorkspaceId]
      )
      let randomCookie = `session_id=${sessionId}`

      const csrfRes = await request(app).get('/api/csrf-token').set('Cookie', randomCookie)
      const randomCsrf = typeof csrfRes.body?.token === 'string' ? csrfRes.body.token : ''
      const connectSid = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
      if (connectSid) randomCookie = `${randomCookie}; ${connectSid}`

      const res = await request(app)
        .post(`/api/weeks/${testSprintId}/approve-plan`)
        .set('Cookie', randomCookie)
        .set('X-CSRF-Token', String(randomCsrf))

      expect(res.status).toBe(403)

      // Cleanup
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [randomUserId])
      await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [randomUserId])
      await pool.query('DELETE FROM users WHERE id = $1', [randomUserId])
    })
  })

  describe('GET /api/team/people includes reportsTo', () => {
    it('should include reportsTo and role fields in response', async () => {
      const res = await request(app)
        .get('/api/team/people')
        .set('Cookie', adminCookie)

      expect(res.status).toBe(200)
      const people = res.body as Array<{ id: string; reportsTo?: string; role?: string }>
      expect(people).toBeInstanceOf(Array)
      expect(people.length).toBeGreaterThanOrEqual(2)

      // Find the member person doc
      const member = people.find((p) => p.id === memberPersonDocId)
      expect(member).toBeDefined()
      expect(member).toHaveProperty('reportsTo')
      expect(member).toHaveProperty('role')
    })

    it('should return correct reportsTo value for a person', async () => {
      // Set a known reports_to value
      await pool.query(
        `UPDATE documents SET properties = properties || jsonb_build_object('reports_to', $1::text)
         WHERE id = $2`,
        [adminUserId, memberPersonDocId]
      )

      const res = await request(app)
        .get('/api/team/people')
        .set('Cookie', adminCookie)

      const people = res.body as Array<{ id: string; reportsTo?: string }>
      const member = people.find((p) => p.id === memberPersonDocId)
      expect(member?.reportsTo).toBe(adminUserId)
    })
  })
})
