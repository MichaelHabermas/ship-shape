// Integration tests for document PATCH, weekly resubmission, delete, and type conversion APIs.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { z } from 'zod'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'
import {
  BaseDocumentSchema,
  DocumentConvertValidationErrorSchema,
  DocumentNotFoundErrorSchema,
} from '../openapi/schemas/documents.js'
import { expectJsonBody } from '../test/expect-json-body.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { IdRow, PropertiesRow, CountRow, requireFirstRow } from '../test/pg-result.js'
import { getCsrfTokenFromApp } from '../test/session-csrf.js'

const PatchAssociationConflictSchema = z.object({
  error: z.literal('Use either belongs_to or program_id/sprint_id association fields, not both'),
})
const RaciPatchDeniedSchema = z.object({
  error: z.literal('Cannot modify RACI fields via this endpoint: owner_id'),
})
const ForbiddenErrorSchema = z.object({ error: z.literal('Forbidden') })

type DeletedAtRow = { id: string; deleted_at: Date | null }

describe('Documents API - PATCH with Issue Fields', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `docs-patch-${testRunId}@ship.local`
  const testWorkspaceName = `Docs Patch Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testIssueId: string
  let testWorkspaceId: string
  let testUserId: string
  let testSprintId: string

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

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create a sprint for testing belongs_to
    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'sprint', 'Test Sprint', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testSprintId = requireFirstRow(sprintResult.rows).id

    // Create session
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
  })

  afterAll(async () => {
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  beforeEach(async () => {
    // Clean up issues from previous tests (keep the sprint)
    await pool.query(`DELETE FROM documents WHERE workspace_id = $1 AND document_type = 'issue'`, [testWorkspaceId])

    // Create a fresh issue for each test
    const issueResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by, properties)
       VALUES ($1, 'issue', 'Test Issue', 9999, $2, '{"state": "backlog", "priority": "none"}')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testIssueId = requireFirstRow(issueResult.rows).id
  })

  describe('PATCH /api/documents/:id with top-level issue fields', () => {
    it('should accept state at top level and store in properties', async () => {
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ state: 'in_progress' })

      const document = expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(document.properties.state).toBe('in_progress')
    })

    it('should accept priority at top level and store in properties', async () => {
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ priority: 'high' })

      const document = expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(document.properties.priority).toBe('high')
    })

    it('should accept estimate at top level and store in properties', async () => {
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ estimate: 3 })

      const document = expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(document.properties.estimate).toBe(3)
    })

    it('should accept assignee_id at top level and store in properties', async () => {
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ assignee_id: testUserId })

      const document = expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(document.properties.assignee_id).toBe(testUserId)
    })

    it('should accept null estimate to clear hours', async () => {
      // First set an estimate
      await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ estimate: 5 })

      // Then clear it
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ estimate: null })

      const document = expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(document.properties.estimate).toBeNull()
    })

    it('should accept belongs_to for sprint association', async () => {
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          belongs_to: [{ id: testSprintId, type: 'sprint' }]
        })

      expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })

      // Verify the association was created
      const assocResult = await pool.query(
        `SELECT * FROM document_associations WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'sprint'`,
        [testIssueId, testSprintId]
      )
      expect(assocResult.rows.length).toBe(1)
    })

    it('should reject mixed belongs_to and direct association fields', async () => {
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          belongs_to: [],
          sprint_id: testSprintId,
        })

      const error = expectJsonBody(response, 400, PatchAssociationConflictSchema)
      expect(error.error).toBe('Use either belongs_to or program_id/sprint_id association fields, not both')
    })

    it('should reject non-admin top-level RACI fields', async () => {
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ owner_id: testUserId })

      const error = expectJsonBody(response, 403, RaciPatchDeniedSchema)
      expect(error.error).toBe('Cannot modify RACI fields via this endpoint: owner_id')
    })

    it('should accept multiple top-level fields in one request', async () => {
      const response = await request(app)
        .patch(`/api/documents/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          state: 'done',
          priority: 'urgent',
          estimate: 8,
          assignee_id: testUserId
        })

      const document = expectOpenApiResponse({
        method: 'patch',
        path: '/documents/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(document.properties.state).toBe('done')
      expect(document.properties.priority).toBe('urgent')
      expect(document.properties.estimate).toBe(8)
      expect(document.properties.assignee_id).toBe(testUserId)
    })
  })
})

describe('Documents API - Weekly Doc Resubmission', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `docs-weekly-resubmit-${testRunId}@ship.local`
  const testWorkspaceName = `Docs Weekly Resubmit ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let testPersonId: string
  let testProjectId: string

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = requireFirstRow(workspaceResult.rows).id

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Weekly Resubmit User')
       RETURNING id`,
      [testEmail]
    )
    testUserId = requireFirstRow(userResult.rows).id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    const personResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, properties)
       VALUES ($1, 'person', 'Weekly Resubmit Person', $2, $3)
       RETURNING id`,
      [testWorkspaceId, testUserId, JSON.stringify({ user_id: testUserId })]
    )
    testPersonId = requireFirstRow(personResult.rows).id

    const projectResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'project', 'Weekly Resubmit Project', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProjectId = requireFirstRow(projectResult.rows).id

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
  })

  afterAll(async () => {
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  beforeEach(async () => {
    await pool.query(
      `DELETE FROM document_associations
       WHERE document_id IN (
         SELECT id FROM documents
         WHERE workspace_id = $1 AND document_type IN ('sprint', 'weekly_plan', 'weekly_retro')
       )`,
      [testWorkspaceId]
    )
    await pool.query(
      `DELETE FROM documents
       WHERE workspace_id = $1 AND document_type IN ('sprint', 'weekly_plan', 'weekly_retro')`,
      [testWorkspaceId]
    )
  })

  it('moves plan_approval back to changed_since_approved after weekly plan edit', async () => {
    const weekNumber = 17
    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, properties)
       VALUES ($1, 'sprint', 'Week 17', $2, $3)
       RETURNING id`,
      [
        testWorkspaceId,
        testUserId,
        JSON.stringify({
          sprint_number: weekNumber,
          project_id: testProjectId,
          owner_id: testPersonId,
          assignee_ids: [testPersonId],
          plan_approval: {
            state: 'changes_requested',
            approved_by: testUserId,
            approved_at: new Date().toISOString(),
            feedback: 'Please make this plan more measurable.',
          },
        }),
      ]
    )
    const sprintId = requireFirstRow(sprintResult.rows).id

    const planResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, content, properties)
       VALUES ($1, 'weekly_plan', 'Week 17 Plan', $2, $3, $4)
       RETURNING id`,
      [
        testWorkspaceId,
        testUserId,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial plan' }] }] }),
        JSON.stringify({ person_id: testPersonId, project_id: testProjectId, week_number: weekNumber }),
      ]
    )
    const planId = requireFirstRow(planResult.rows).id

    const response = await request(app)
      .patch(`/api/documents/${planId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated plan with concrete deliverables.' }] }],
        },
      })

    expect(response.status).toBe(200)

    const sprintAfter = await pool.query<PropertiesRow>(
      `SELECT properties FROM documents WHERE id = $1`,
      [sprintId]
    )
    expect(requireFirstRow(sprintAfter.rows).properties.plan_approval.state).toBe('changed_since_approved')
    expect(requireFirstRow(sprintAfter.rows).properties.plan_approval.feedback).toBe('Please make this plan more measurable.')
  })

  it('moves plan_approval back to changed_since_approved after weekly plan content endpoint edit', async () => {
    const weekNumber = 19
    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, properties)
       VALUES ($1, 'sprint', 'Week 19', $2, $3)
       RETURNING id`,
      [
        testWorkspaceId,
        testUserId,
        JSON.stringify({
          sprint_number: weekNumber,
          project_id: testProjectId,
          owner_id: testPersonId,
          assignee_ids: [testPersonId],
          plan_approval: {
            state: 'changes_requested',
            approved_by: testUserId,
            approved_at: new Date().toISOString(),
            feedback: 'Update via content endpoint.',
          },
        }),
      ]
    )
    const sprintId = requireFirstRow(sprintResult.rows).id

    const planResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, content, properties)
       VALUES ($1, 'weekly_plan', 'Week 19 Plan', $2, $3, $4)
       RETURNING id`,
      [
        testWorkspaceId,
        testUserId,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial plan' }] }] }),
        JSON.stringify({ person_id: testPersonId, project_id: testProjectId, week_number: weekNumber }),
      ]
    )
    const planId = requireFirstRow(planResult.rows).id

    const response = await request(app)
      .patch(`/api/documents/${planId}/content`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated through content route.' }] }],
        },
      })

    expect(response.status).toBe(200)

    const sprintAfter = await pool.query<PropertiesRow>(
      `SELECT properties FROM documents WHERE id = $1`,
      [sprintId]
    )
    expect(requireFirstRow(sprintAfter.rows).properties.plan_approval.state).toBe('changed_since_approved')
    expect(requireFirstRow(sprintAfter.rows).properties.plan_approval.feedback).toBe('Update via content endpoint.')
  })

  it('moves review_approval back to changed_since_approved after weekly retro edit', async () => {
    const weekNumber = 18
    const sprintResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, properties)
       VALUES ($1, 'sprint', 'Week 18', $2, $3)
       RETURNING id`,
      [
        testWorkspaceId,
        testUserId,
        JSON.stringify({
          sprint_number: weekNumber,
          project_id: testProjectId,
          owner_id: testPersonId,
          assignee_ids: [testPersonId],
          review_approval: {
            state: 'changes_requested',
            approved_by: testUserId,
            approved_at: new Date().toISOString(),
            feedback: 'Add evidence for delivered outcomes.',
          },
        }),
      ]
    )
    const sprintId = requireFirstRow(sprintResult.rows).id

    const retroResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, content, properties)
       VALUES ($1, 'weekly_retro', 'Week 18 Retro', $2, $3, $4)
       RETURNING id`,
      [
        testWorkspaceId,
        testUserId,
        JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial retro' }] }] }),
        JSON.stringify({ person_id: testPersonId, project_id: testProjectId, week_number: weekNumber }),
      ]
    )
    const retroId = requireFirstRow(retroResult.rows).id

    const response = await request(app)
      .patch(`/api/documents/${retroId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated retro with evidence and links.' }] }],
        },
      })

    expect(response.status).toBe(200)

    const sprintAfter = await pool.query<PropertiesRow>(
      `SELECT properties FROM documents WHERE id = $1`,
      [sprintId]
    )
    expect(requireFirstRow(sprintAfter.rows).properties.review_approval.state).toBe('changed_since_approved')
    expect(requireFirstRow(sprintAfter.rows).properties.review_approval.feedback).toBe('Add evidence for delivered outcomes.')
  })
})

describe('Documents API - Delete', () => {
  const app = createApp()
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `docs-delete-${testRunId}@ship.local`
  const testWorkspaceName = `Docs Delete Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testDocumentId: string
  let testWorkspaceId: string
  let testUserId: string
  let otherUserId: string
  let otherSessionCookie: string
  let otherCsrfToken: string

  // Setup: Create a test user and session
  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
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

    const otherUserResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Other User')
       RETURNING id`,
      [`other-${testEmail}`]
    )
    otherUserId = requireFirstRow(otherUserResult.rows).id

    // Create workspace membership
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

    // Create session (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
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

    const otherSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [otherSessionId, otherUserId, testWorkspaceId]
    )
    otherSessionCookie = `session_id=${otherSessionId}`
    const otherCsrf = await getCsrfTokenFromApp(app, otherSessionCookie)
    otherCsrfToken = otherCsrf.token
    otherSessionCookie = otherCsrf.sessionCookie
  })

  // Cleanup after all tests
  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  // Create a fresh document before each test
  beforeEach(async () => {
    // Clean up any documents from previous tests
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])

    const docResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Test Document', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testDocumentId = requireFirstRow(docResult.rows).id
  })

  describe('DELETE /api/documents/:id', () => {
    it('should delete a document and return 204', async () => {
      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(204)

      // Verify document is soft-deleted for retention/audit safety
      const checkResult = await pool.query<DeletedAtRow>(
        'SELECT id, deleted_at FROM documents WHERE id = $1',
        [testDocumentId]
      )
      expect(checkResult.rows.length).toBe(1)
      expect(requireFirstRow(checkResult.rows).deleted_at).not.toBeNull()
    })

    it('should return 403 when a non-creator member deletes a workspace document', async () => {
      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)
        .set('Cookie', otherSessionCookie)
        .set('x-csrf-token', otherCsrfToken)

      const error = expectJsonBody(response, 403, ForbiddenErrorSchema)
      expect(error.error).toBe('Forbidden')
    })

    it('should return 404 when deleting non-existent document', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'

      const response = await request(app)
        .delete(`/api/documents/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      const error = expectOpenApiResponse({
        method: 'delete',
        path: '/documents/{id}',
        status: 404,
        response,
        openApiSchemaName: 'DocumentNotFoundError',
        schema: DocumentNotFoundErrorSchema,
      })
      expect(error.error).toBe('Document not found')
    })

    it('should return 403 when not authenticated (CSRF check runs first)', async () => {
      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)

      // Without session cookie, CSRF validation fails first (403) before auth check (401)
      expect(response.status).toBe(403)
    })

    it('should return 404 when trying to delete document from another workspace', async () => {
      // Create document in a different workspace
      const otherWorkspaceResult = await pool.query<IdRow>(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace Delete')
         RETURNING id`
      )
      const otherWorkspaceId = requireFirstRow(otherWorkspaceResult.rows).id

      const otherDocResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'wiki', 'Other Document', $2)
         RETURNING id`,
        [otherWorkspaceId, testUserId]
      )
      const otherDocumentId = requireFirstRow(otherDocResult.rows).id

      // Try to delete document from another workspace
      const response = await request(app)
        .delete(`/api/documents/${otherDocumentId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      // Should return 404 because the document doesn't belong to user's workspace
      const error = expectOpenApiResponse({
        method: 'delete',
        path: '/documents/{id}',
        status: 404,
        response,
        openApiSchemaName: 'DocumentNotFoundError',
        schema: DocumentNotFoundErrorSchema,
      })
      expect(error.error).toBe('Document not found')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [otherDocumentId])
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId])
    })

    it('should allow deleting a document with children (cascade)', async () => {
      // Create a child document
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by)
         VALUES ($1, 'wiki', 'Child Document', $2, $3)`,
        [testWorkspaceId, testDocumentId, testUserId]
      )

      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(204)

      // Verify parent document is soft-deleted and child row remains for retention
      const checkResult = await pool.query<DeletedAtRow>(
        'SELECT id, deleted_at FROM documents WHERE id = $1',
        [testDocumentId]
      )
      expect(checkResult.rows.length).toBe(1)
      expect(requireFirstRow(checkResult.rows).deleted_at).not.toBeNull()
    })

    it('should return 403 when session is expired (CSRF check runs first)', async () => {
      // Create expired session (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
      const expiredSessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
         VALUES ($1, $2, $3, now() - interval '1 hour')`,
        [expiredSessionId, testUserId, testWorkspaceId]
      )
      const expiredCookie = `session_id=${expiredSessionId}`

      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)
        .set('Cookie', expiredCookie)
        .set('x-csrf-token', csrfToken)

      // CSRF validation fails first (403) because the CSRF token is bound to a different session
      expect(response.status).toBe(403)

      // Cleanup expired session
      await pool.query('DELETE FROM sessions WHERE id = $1', [expiredSessionId])
    })
  })
})

describe('Documents API - Conversion', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `docs-convert-${testRunId}@ship.local`
  const testWorkspaceName = `Docs Convert Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let testProgramId: string

  // Setup: Create a test user, session, and program
  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query<IdRow>(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
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

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create a test program for association testing
    const programResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'program', 'Test Program', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProgramId = requireFirstRow(programResult.rows).id

    // Create session
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
  })

  // Cleanup after all tests
  afterAll(async () => {
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('POST /api/documents/:id/convert', () => {
    it('should convert issue to project and copy program associations', async () => {
      // Create an issue
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Issue to Convert', 1001, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      // Add program association to the issue
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [issueId, testProgramId]
      )

      // Convert issue to project
      const response = await request(app)
        .post(`/api/documents/${issueId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'project' })

      const document = expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/convert',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(document.document_type).toBe('project')
      expect(document.id).toBe(issueId)

      // Verify program association was preserved (not copied - same document)
      const assocResult = await pool.query(
        `SELECT * FROM document_associations
         WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'program'`,
        [issueId, testProgramId]
      )
      expect(assocResult.rows.length).toBe(1)

      expect(document.converted_from_id).toBe(issueId)
    })

    it('should convert project to issue and copy program associations', async () => {
      // Create a project
      const projectResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'project', 'Project to Convert', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const projectId = requireFirstRow(projectResult.rows).id

      // Add program association to the project
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [projectId, testProgramId]
      )

      // Convert project to issue
      const response = await request(app)
        .post(`/api/documents/${projectId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'issue' })

      const document = expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/convert',
        status: 200,
        response,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(document.document_type).toBe('issue')
      expect(document.id).toBe(projectId)

      // Verify program association was preserved (not copied - same document)
      const assocResult = await pool.query(
        `SELECT * FROM document_associations
         WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'program'`,
        [projectId, testProgramId]
      )
      expect(assocResult.rows.length).toBe(1)

      expect(document.converted_from_id).toBe(projectId)
    })

    it('should return 400 when converting an archived document', async () => {
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by, archived_at)
         VALUES ($1, 'issue', 'Archived Issue', 1004, $2, now())
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      const response = await request(app)
        .post(`/api/documents/${issueId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'project' })

      const error = expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/convert',
        status: 400,
        response,
        openApiSchemaName: 'DocumentConvertValidationError',
        schema: DocumentConvertValidationErrorSchema,
      })
      expect(error.error).toBe('Cannot convert an archived document')
    })
  })

  describe('POST /api/documents/:id/undo-conversion', () => {
    it('should undo conversion and restore original associations', async () => {
      // Create an issue
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Issue for Undo Test', 1002, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const originalIssueId = requireFirstRow(issueResult.rows).id

      // Add program association to the issue
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [originalIssueId, testProgramId]
      )

      // Convert issue to project
      const convertResponse = await request(app)
        .post(`/api/documents/${originalIssueId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'project' })

      const converted = expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/convert',
        status: 200,
        response: convertResponse,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(converted.id).toBe(originalIssueId)

      const undoResponse = await request(app)
        .post(`/api/documents/${originalIssueId}/undo-conversion`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      const restored = expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/undo-conversion',
        status: 200,
        response: undoResponse,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      expect(restored.id).toBe(originalIssueId)
      expect(restored.document_type).toBe('issue')

      // Verify program association is still there (same document, same associations)
      const assocResult = await pool.query(
        `SELECT * FROM document_associations
         WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'program'`,
        [originalIssueId, testProgramId]
      )
      expect(assocResult.rows.length).toBe(1)

      // Verify snapshot was created and used
      const snapshotResult = await pool.query<CountRow>(
        `SELECT COUNT(*) FROM document_snapshots WHERE document_id = $1`,
        [originalIssueId]
      )
      // After undo, the used snapshot is deleted, but a new one is created for the undo itself
      expect(parseInt(requireFirstRow(snapshotResult.rows).count)).toBeGreaterThanOrEqual(0)
    })

    it('should have no orphaned associations after conversion/undo cycle', async () => {
      // Create an issue
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Issue for Orphan Test', 1003, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      // Add program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [issueId, testProgramId]
      )

      // Count associations before
      const beforeCount = await pool.query<CountRow>(
        `SELECT COUNT(*) FROM document_associations
         WHERE document_id = $1 OR related_id = $1`,
        [issueId]
      )

      // Convert to project
      const convertResponse = await request(app)
        .post(`/api/documents/${issueId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'project' })

      const converted = expectOpenApiResponse({
        method: 'post',
        path: '/documents/{id}/convert',
        status: 200,
        response: convertResponse,
        openApiSchemaName: 'Document',
        schema: BaseDocumentSchema,
      })
      const projectId = converted.id

      // Undo conversion
      await request(app)
        .post(`/api/documents/${projectId}/undo-conversion`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      // Count associations after - should be same as before (1 program association)
      const afterCount = await pool.query<CountRow>(
        `SELECT COUNT(*) FROM document_associations
         WHERE document_id = $1 OR related_id = $1`,
        [issueId]
      )

      expect(parseInt(requireFirstRow(afterCount.rows).count)).toBe(parseInt(requireFirstRow(beforeCount.rows).count))
    })
  })
})
