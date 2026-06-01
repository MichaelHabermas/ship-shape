import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { z } from 'zod'
import type { z as zod } from 'zod'
import { createApp } from '../app.js'
import { CountRow, IdRow, RelatedIdRow, RelationshipTypeRow, requireFirstRow } from '../test/pg-result.js'
import { pool } from '../db/client.js'
import {
  IssueListResponseSchema,
  IssueResponseSchema,
  IncompleteChildrenWarningSchema,
} from '../openapi/schemas/issues.js'
import { expectOpenApiResponse } from '../test/openapi-response.js'
import { expectJsonBody } from '../test/expect-json-body.js'
import { getCsrfTokenFromApp } from '../test/session-csrf.js'

type IssueResponse = zod.infer<typeof IssueResponseSchema>
type IssueListItem = Pick<IssueResponse, 'id'>

type ContextIssuesPayload =
  | { items?: IssueListItem[] }
  | IssueListItem[]

function contextIssueList(issues: ContextIssuesPayload): IssueListItem[] {
  if (Array.isArray(issues)) {
    return issues
  }
  return issues.items ?? []
}

/**
 * Regression test suite for unified document model associations.
 * Tests junction table, belongs_to format, and multi-parent associations.
 */
describe('Associations Regression Tests', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `regression-${testRunId}@ship.local`
  const testWorkspaceName = `Regression Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let testProgramId: string
  let testProject1Id: string
  let testProject2Id: string
  let testSprint1Id: string
  let testSprint2Id: string

  // Setup: Create test user, workspace, program, projects, and sprints
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
       VALUES ($1, 'test-hash', 'Regression Test User')
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

    // Create test program
    const programResult = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'program', 'Test Program', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProgramId = requireFirstRow(programResult.rows).id

    // Create test project 1
    const project1Result = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'project', 'Test Project 1', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProject1Id = requireFirstRow(project1Result.rows).id

    // Create test project 2
    const project2Result = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'project', 'Test Project 2', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProject2Id = requireFirstRow(project2Result.rows).id

    // Create test sprint 1 (with dates in future for "active" status)
    const sprint1Result = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, properties)
       VALUES ($1, 'sprint', 'Sprint 1', $2, '{"sprint_number": 1}')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testSprint1Id = requireFirstRow(sprint1Result.rows).id

    // Create test sprint 2
    const sprint2Result = await pool.query<IdRow>(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, properties)
       VALUES ($1, 'sprint', 'Sprint 2', $2, '{"sprint_number": 2}')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testSprint2Id = requireFirstRow(sprint2Result.rows).id

    // Associate projects with program
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type)
       VALUES ($1, $2, 'program'), ($3, $4, 'program')`,
      [testProject1Id, testProgramId, testProject2Id, testProgramId]
    )

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

  describe('Issue CRUD with belongs_to associations', () => {
    let testIssueId: string

    afterEach(async () => {
      // Clean up test issues
      if (testIssueId) {
        await pool.query('DELETE FROM document_associations WHERE document_id = $1', [testIssueId])
        await pool.query('DELETE FROM documents WHERE id = $1', [testIssueId])
        testIssueId = ''
      }
    })

    it('creates issue with project and sprint associations via belongs_to', async () => {
      const response = await request(app)
        .post('/api/issues')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Test Issue with Associations',
          belongs_to: [
            { id: testProject1Id, type: 'project' },
            { id: testSprint1Id, type: 'sprint' },
            { id: testProgramId, type: 'program' }
          ]
        })

      const issue = expectOpenApiResponse({
        method: 'post',
        path: '/issues',
        status: 201,
        response,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      testIssueId = issue.id

      expect(issue.belongs_to).toBeDefined()
      expect(Array.isArray(issue.belongs_to)).toBe(true)
      expect(issue.belongs_to?.length).toBe(3)

      // Verify associations in database
      const assocResult = await pool.query<RelationshipTypeRow>(
        `SELECT relationship_type FROM document_associations WHERE document_id = $1`,
        [testIssueId]
      )
      const types = assocResult.rows.map(r => r.relationship_type).sort()
      expect(types).toEqual(['program', 'project', 'sprint'])
    })

    it('reads issue with belongs_to array correctly', async () => {
      // Create issue with associations
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Read Test Issue', 9001, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testIssueId = requireFirstRow(issueResult.rows).id

      // Add associations
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'project'), ($1, $3, 'sprint')`,
        [testIssueId, testProject1Id, testSprint1Id]
      )

      // Read issue via API
      const response = await request(app)
        .get(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)

      const issue = expectOpenApiResponse({
        method: 'get',
        path: '/issues/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.belongs_to).toBeDefined()
      expect(issue.belongs_to?.length).toBe(2)
      const projectAssoc = issue.belongs_to.find((b) => b.type === 'project')
      const sprintAssoc = issue.belongs_to.find((b) => b.type === 'sprint')

      expect(projectAssoc).toBeDefined()
      if (!projectAssoc || !sprintAssoc) {
        throw new Error('Expected project and sprint associations on issue')
      }
      expect(projectAssoc.id).toBe(testProject1Id)
      expect(sprintAssoc.id).toBe(testSprint1Id)
    })
  })

  describe('Move issue between sprints', () => {
    let testIssueId: string

    beforeEach(async () => {
      // Create issue in sprint 1 with estimate (required for sprint assignment)
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by, properties)
         VALUES ($1, 'issue', 'Sprint Move Test', 9002, $2, '{"state": "backlog", "priority": "medium", "estimate": 3}')
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testIssueId = requireFirstRow(issueResult.rows).id

      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint')`,
        [testIssueId, testSprint1Id]
      )
    })

    afterEach(async () => {
      await pool.query('DELETE FROM document_associations WHERE document_id = $1', [testIssueId])
      await pool.query('DELETE FROM documents WHERE id = $1', [testIssueId])
    })

    it('moves issue from sprint 1 to sprint 2 via PATCH belongs_to', async () => {
      // Verify initial state
      const beforeResult = await pool.query<RelatedIdRow>(
        `SELECT related_id FROM document_associations WHERE document_id = $1 AND relationship_type = 'sprint'`,
        [testIssueId]
      )
      expect(requireFirstRow(beforeResult.rows).related_id).toBe(testSprint1Id)

      // Move to sprint 2 via PATCH
      const response = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          belongs_to: [
            { id: testSprint2Id, type: 'sprint' }
          ]
        })

      expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })

      const afterResult = await pool.query<RelatedIdRow>(
        `SELECT related_id FROM document_associations WHERE document_id = $1 AND relationship_type = 'sprint'`,
        [testIssueId]
      )
      expect(requireFirstRow(afterResult.rows).related_id).toBe(testSprint2Id)
    })

    it('removes issue from sprint by omitting sprint in belongs_to', async () => {
      // Move to no sprint
      const response = await request(app)
        .patch(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          belongs_to: [] // Empty = remove all associations
        })

      expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })

      const afterResult = await pool.query(
        `SELECT * FROM document_associations WHERE document_id = $1 AND relationship_type = 'sprint'`,
        [testIssueId]
      )
      expect(afterResult.rows.length).toBe(0)
    })
  })

  describe('Multi-parent associations', () => {
    let testIssueId: string

    beforeEach(async () => {
      // Create issue
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Multi-parent Test', 9003, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testIssueId = requireFirstRow(issueResult.rows).id
    })

    afterEach(async () => {
      await pool.query('DELETE FROM document_associations WHERE document_id = $1', [testIssueId])
      await pool.query('DELETE FROM documents WHERE id = $1', [testIssueId])
    })

    it('creates issue belonging to multiple projects', async () => {
      // Add associations to both projects
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'project'), ($1, $3, 'project')`,
        [testIssueId, testProject1Id, testProject2Id]
      )

      // Read issue and verify both projects
      const response = await request(app)
        .get(`/api/issues/${testIssueId}`)
        .set('Cookie', sessionCookie)

      const issue = expectOpenApiResponse({
        method: 'get',
        path: '/issues/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      const projectAssocs = (issue.belongs_to ?? []).filter((b) => b.type === 'project')
      expect(projectAssocs.length).toBe(2)

      const projectIds = projectAssocs.map((p) => p.id).sort()
      expect(projectIds).toEqual([testProject1Id, testProject2Id].sort())
    })

    it('queries issues by project via association', async () => {
      // Associate with project 1
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'project')`,
        [testIssueId, testProject1Id]
      )

      // Query issues for project 1
      const response = await request(app)
        .get(`/api/issues?project_id=${testProject1Id}`)
        .set('Cookie', sessionCookie)

      const issues = expectOpenApiResponse({
        method: 'get',
        path: '/issues',
        status: 200,
        response,
        openApiSchemaName: 'IssueListItem',
        arrayItemSchemaName: 'IssueListItem',
        schema: z.array(IssueListResponseSchema),
      })
      const issueIds = issues.map((i) => i.id)
      expect(issueIds).toContain(testIssueId)
    })
  })

  describe('Cascade delete behavior', () => {
    it('deleting document removes its associations from junction table', async () => {
      // Create issue with associations
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Cascade Delete Test', 9004, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const issueId = requireFirstRow(issueResult.rows).id

      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'project'), ($1, $3, 'sprint')`,
        [issueId, testProject1Id, testSprint1Id]
      )

      // Verify associations exist
      const beforeResult = await pool.query<CountRow>(
        `SELECT COUNT(*) FROM document_associations WHERE document_id = $1`,
        [issueId]
      )
      expect(parseInt(requireFirstRow(beforeResult.rows).count)).toBe(2)

      // Delete the issue via API
      const response = await request(app)
        .delete(`/api/issues/${issueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(204)

      const afterResult = await pool.query<CountRow>(
        `SELECT COUNT(*) FROM document_associations WHERE document_id = $1`,
        [issueId]
      )
      expect(parseInt(requireFirstRow(afterResult.rows).count)).toBe(0)
    })
  })

  describe('Claude context API', () => {
    let testIssueId: string

    beforeEach(async () => {
      // Create issue in sprint with project association
      const issueResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by, properties)
         VALUES ($1, 'issue', 'Context API Test Issue', 9005, $2, '{"state": "in_progress"}')
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      testIssueId = requireFirstRow(issueResult.rows).id

      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'sprint'), ($1, $3, 'project'), ($1, $4, 'program')`,
        [testIssueId, testSprint1Id, testProject1Id, testProgramId]
      )

      // Associate sprint with project
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'project')
         ON CONFLICT DO NOTHING`,
        [testSprint1Id, testProject1Id]
      )
    })

    afterEach(async () => {
      await pool.query('DELETE FROM document_associations WHERE document_id = $1', [testIssueId])
      await pool.query('DELETE FROM documents WHERE id = $1', [testIssueId])
    })

    it('standup context returns issues via junction table', async () => {
      const response = await request(app)
        .get(`/api/claude/context?context_type=standup&sprint_id=${testSprint1Id}`)
        .set('Cookie', sessionCookie)

      const body = expectJsonBody(
        response,
        200,
        z.object({ issues: z.unknown() }).passthrough()
      )
      expect(body.issues).toBeDefined()

      const issueList = contextIssueList(body.issues as ContextIssuesPayload)
      const testIssue = issueList.find((i) => i.id === testIssueId)
      expect(testIssue).toBeDefined()
    })

    it('review context returns issues via junction table', async () => {
      const response = await request(app)
        .get(`/api/claude/context?context_type=review&sprint_id=${testSprint1Id}`)
        .set('Cookie', sessionCookie)

      const body = expectJsonBody(
        response,
        200,
        z.object({ issues: z.unknown() }).passthrough()
      )
      expect(body.issues).toBeDefined()
    })
  })

  describe('Status cascade warning for parent issues', () => {
    let parentIssueId: string
    let childIssueId: string

    beforeEach(async () => {
      // Create parent issue
      const parentResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by, properties)
         VALUES ($1, 'issue', 'Parent Issue', 9010, $2, '{"state": "in_progress", "priority": "medium"}')
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      parentIssueId = requireFirstRow(parentResult.rows).id

      // Create child issue
      const childResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by, properties)
         VALUES ($1, 'issue', 'Child Issue', 9011, $2, '{"state": "todo", "priority": "medium"}')
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      childIssueId = requireFirstRow(childResult.rows).id

      // Create parent-child association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'parent')`,
        [childIssueId, parentIssueId]
      )
    })

    afterEach(async () => {
      await pool.query('DELETE FROM document_associations WHERE document_id IN ($1, $2)', [parentIssueId, childIssueId])
      await pool.query('DELETE FROM documents WHERE id IN ($1, $2)', [parentIssueId, childIssueId])
    })

    it('returns 409 warning when closing parent with incomplete children', async () => {
      const response = await request(app)
        .patch(`/api/issues/${parentIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ state: 'done' })

      const warning = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 409,
        response,
        openApiSchemaName: 'IncompleteChildrenWarning',
        schema: IncompleteChildrenWarningSchema,
      })
      expect(warning.error).toBe('incomplete_children')
      expect(warning.incomplete_children.length).toBe(1)
      expect(warning.incomplete_children[0].id).toBe(childIssueId)
    })

    it('allows closing parent with confirm_orphan_children flag', async () => {
      const response = await request(app)
        .patch(`/api/issues/${parentIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ state: 'done', confirm_orphan_children: true })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.state).toBe('done')

      const assocResult = await pool.query(
        `SELECT * FROM document_associations WHERE document_id = $1 AND relationship_type = 'parent'`,
        [childIssueId]
      )
      expect(assocResult.rows.length).toBe(0)
    })

    it('closes parent without warning if all children are done', async () => {
      // Mark child as done first
      await pool.query(
        `UPDATE documents SET properties = properties || '{"state": "done"}' WHERE id = $1`,
        [childIssueId]
      )

      const response = await request(app)
        .patch(`/api/issues/${parentIssueId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ state: 'done' })

      const issue = expectOpenApiResponse({
        method: 'patch',
        path: '/issues/{id}',
        status: 200,
        response,
        openApiSchemaName: 'Issue',
        schema: IssueResponseSchema,
      })
      expect(issue.state).toBe('done')
    })
  })
})
