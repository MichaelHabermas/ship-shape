import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { z } from 'zod'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import { BaseDocumentSchema } from '../openapi/schemas/documents.js'
import { ErrorResponseSchema } from '../openapi/schemas/common.js'
import { TeamPersonListItemSchema } from '../openapi/schemas/team.js'
import { WeekPlanApprovalResponseSchema } from '../openapi/schemas/weeks.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { expectJsonBody } from '../test/expect-json-body.js'
import { getCsrfTokenFromApp } from '../test/session-csrf.js'
import { IdRow, PropertiesRow, requireFirstRow } from '../test/pg-result.js'

const TeamPeopleListSchema = z.array(TeamPersonListItemSchema)

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
    const wsResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(wsResult.rows).id

    const adminResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Admin User')
       RETURNING id`,
      [`reports-to-admin-${testRunId}@ship.local`]
    )
    adminUserId = requireFirstRow(adminResult.rows).id

    const memberResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Member User')
       RETURNING id`,
      [`reports-to-member-${testRunId}@ship.local`]
    )
    memberUserId = requireFirstRow(memberResult.rows).id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, adminUserId]
    )
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, memberUserId]
    )

    const adminPersonResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'person', 'Admin User', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, adminUserId, JSON.stringify({ user_id: adminUserId, email: `reports-to-admin-${testRunId}@ship.local` })]
    )
    adminPersonDocId = requireFirstRow(adminPersonResult.rows).id

    const memberPersonResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'person', 'Member User', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, memberUserId, JSON.stringify({ user_id: memberUserId, email: `reports-to-member-${testRunId}@ship.local` })]
    )
    memberPersonDocId = requireFirstRow(memberPersonResult.rows).id

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

    const adminCsrfResult = await getCsrfTokenFromApp(app, adminCookie)
    adminCsrf = adminCsrfResult.token
    adminCookie = adminCsrfResult.sessionCookie

    const memberCsrfResult = await getCsrfTokenFromApp(app, memberCookie)
    memberCsrf = memberCsrfResult.token
    memberCookie = memberCsrfResult.sessionCookie

    const programResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, properties)
       VALUES ($1, 'program', 'Test Program', 'workspace', $2) RETURNING id`,
      [testWorkspaceId, JSON.stringify({ accountable_id: adminUserId })]
    )
    testProgramId = requireFirstRow(programResult.rows).id

    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'sprint', 'Test Sprint', 'workspace', $2, $3) RETURNING id`,
      [testWorkspaceId, memberUserId, JSON.stringify({
        sprint_number: 1,
        owner_id: memberPersonDocId,
        assignee_ids: [memberUserId],
      })]
    )
    testSprintId = requireFirstRow(sprintResult.rows).id

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

      expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })

      const doc = await pool.query<PropertiesRow>('SELECT properties FROM documents WHERE id = $1', [memberPersonDocId])
      expect(requireFirstRow(doc.rows).properties.reports_to).toBe(adminUserId)
    })

    it('should reject non-admin setting reports_to on a person document', async () => {
      const res = await request(app)
        .patch(`/api/documents/${adminPersonDocId}`)
        .set('Cookie', memberCookie)
        .set('X-CSRF-Token', memberCsrf)
        .send({ properties: { reports_to: memberUserId } })

      const body = expectJsonBody(res, 403, ErrorResponseSchema)
      expect(body.error).toContain('Only workspace admins')
    })

    it('should allow non-admin to update other person properties', async () => {
      const res = await request(app)
        .patch(`/api/documents/${memberPersonDocId}`)
        .set('Cookie', memberCookie)
        .set('X-CSRF-Token', memberCsrf)
        .send({ properties: { role: 'Engineer' } })

      expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response: res,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
    })
  })

  describe('approval authorization with reports_to', () => {
    let supervisorUserId: string
    let supervisorCookie: string
    let supervisorCsrf: string

    beforeAll(async () => {
      const supervisorResult = await pool.query<IdRow>(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, 'test-hash', 'Supervisor User') RETURNING id`,
        [`reports-to-supervisor-${testRunId}@ship.local`]
      )
      supervisorUserId = requireFirstRow(supervisorResult.rows).id

      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
        [testWorkspaceId, supervisorUserId]
      )

      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
         VALUES ($1, 'person', 'Supervisor User', 'workspace', $2, $3)`,
        [testWorkspaceId, supervisorUserId, JSON.stringify({ user_id: supervisorUserId })]
      )

      await pool.query(
        `UPDATE documents SET properties = properties || jsonb_build_object('reports_to', $1::text)
         WHERE id = $2`,
        [supervisorUserId, memberPersonDocId]
      )

      const sessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [sessionId, supervisorUserId, testWorkspaceId]
      )
      supervisorCookie = `session_id=${sessionId}`

      const csrf = await getCsrfTokenFromApp(app, supervisorCookie)
      supervisorCsrf = csrf.token
      supervisorCookie = csrf.sessionCookie

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

      const body = expectOpenApiResponse({
        method: 'post',
        path: '/weeks/{id}/approve-plan',
        status: 200,
        response: res,
        openApiSchemaName: 'WeekPlanApprovalResponse',
        schema: WeekPlanApprovalResponseSchema,
      })
      expect(body.success).toBe(true)
      expect(body.approval.state).toBe('approved')
    })

    it('should reject random non-supervisor non-admin user from approving', async () => {
      const randomResult = await pool.query<IdRow>(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, 'test-hash', 'Random User') RETURNING id`,
        [`reports-to-random-${testRunId}@ship.local`]
      )
      const randomUserId = requireFirstRow(randomResult.rows).id

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

      const csrf = await getCsrfTokenFromApp(app, randomCookie)
      randomCookie = csrf.sessionCookie

      const res = await request(app)
        .post(`/api/weeks/${testSprintId}/approve-plan`)
        .set('Cookie', randomCookie)
        .set('X-CSRF-Token', csrf.token)

      expectJsonBody(res, 403, ErrorResponseSchema)
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

      const people = expectOpenApiResponse({
        method: 'get',
        path: '/team/people',
        status: 200,
        response: res,
        openApiSchemaName: 'TeamPersonListItem',
        arrayItemSchemaName: 'TeamPersonListItem',
        schema: TeamPeopleListSchema,
      })
      expect(people.length).toBeGreaterThanOrEqual(2)

      const member = people.find((p) => p.id === memberPersonDocId)
      expect(member).toBeDefined()
      expect(member).toHaveProperty('reportsTo')
      expect(member).toHaveProperty('role')
    })

    it('should return correct reportsTo value for a person', async () => {
      await pool.query(
        `UPDATE documents SET properties = properties || jsonb_build_object('reports_to', $1::text)
         WHERE id = $2`,
        [adminUserId, memberPersonDocId]
      )

      const res = await request(app)
        .get('/api/team/people')
        .set('Cookie', adminCookie)

      const people = expectOpenApiResponse({
        method: 'get',
        path: '/team/people',
        status: 200,
        response: res,
        openApiSchemaName: 'TeamPersonListItem',
        arrayItemSchemaName: 'TeamPersonListItem',
        schema: TeamPeopleListSchema,
      })
      const member = people.find((p) => p.id === memberPersonDocId)
      expect(member?.reportsTo).toBe(adminUserId)
    })
  })
})
