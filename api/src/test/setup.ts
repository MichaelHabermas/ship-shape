// Test database setup truncates disposable API data before each integration file.
import { beforeAll, afterAll } from 'vitest'
import { pool } from '../db/client.js'

// Test setup for API integration tests
// This runs before all tests in each test file

beforeAll(async () => {
  // Ensure test environment
  process.env.NODE_ENV = 'test'

  const databaseUrl = process.env.DATABASE_URL || ''
  const databaseName = databaseUrl.split('/').pop()?.split('?')[0] || ''
  const isDisposableDatabase = /(^|[_-])(test|audit)([_-]|$)/i.test(databaseName)

  if (!isDisposableDatabase && process.env.ALLOW_DESTRUCTIVE_TEST_DB !== 'true') {
    throw new Error(
      `Refusing to truncate non-test database "${databaseName || '(unknown)'}". ` +
      'Set DATABASE_URL to a disposable test database or ALLOW_DESTRUCTIVE_TEST_DB=true.'
    )
  }

  // Clean up test data from previous runs to prevent duplicate key errors
  // Use TRUNCATE CASCADE which is faster and bypasses row-level triggers
  // (audit_logs has AU-9 compliance triggers preventing DELETE)
  await pool.query(`TRUNCATE TABLE
    workspace_invites, sessions, files, document_links, document_history,
    comments, document_associations, document_snapshots, sprint_iterations,
    issue_iterations, fleetgraph_worker_ticks, documents, audit_logs, workspace_memberships,
    users, workspaces
    CASCADE`)
})

afterAll(async () => {
  // Close pool only at the very end - vitest handles this via globalTeardown
})
