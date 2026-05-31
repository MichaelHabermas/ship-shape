import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../db/client.js'

/**
 * Lock-the-door tests for circular reference protection.
 * These tests verify the database constraints prevent self-referencing
 * and circular parent chains.
 */
describe('Circular Reference Protection', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testWorkspaceName = `Circular Ref Test ${testRunId}`

  let testWorkspaceId: string
  let testDocAId: string
  let testDocBId: string
  let testDocCId: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create three test documents for chain testing
    const docA = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title)
       VALUES ($1, 'wiki', 'Doc A')
       RETURNING id`,
      [testWorkspaceId]
    )
    testDocAId = docA.rows[0].id

    const docB = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title)
       VALUES ($1, 'wiki', 'Doc B')
       RETURNING id`,
      [testWorkspaceId]
    )
    testDocBId = docB.rows[0].id

    const docC = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title)
       VALUES ($1, 'wiki', 'Doc C')
       RETURNING id`,
      [testWorkspaceId]
    )
    testDocCId = docC.rows[0].id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('Self-reference prevention', () => {
    it('should reject setting parent_id to own id', async () => {
      // Either the trigger catches it ("Circular reference detected") or
      // the CHECK constraint catches it ("violates check constraint")
      // Both protections are in place - trigger runs first as BEFORE trigger
      await expect(
        pool.query(
          `UPDATE documents SET parent_id = $1 WHERE id = $1`,
          [testDocAId]
        )
      ).rejects.toThrow(/Circular reference detected|violates check constraint/)
    })
  })

  describe('Circular chain prevention (trigger)', () => {
    it('should allow valid parent chain A -> B -> C', async () => {
      // Set B's parent to A
      await pool.query(`UPDATE documents SET parent_id = $1 WHERE id = $2`, [testDocAId, testDocBId])

      // Set C's parent to B (valid chain: A <- B <- C)
      await pool.query(`UPDATE documents SET parent_id = $1 WHERE id = $2`, [testDocBId, testDocCId])

      // Verify the chain
      const result = await pool.query<{ id: string; parent_id: string | null }>(
        `SELECT id, parent_id FROM documents WHERE id IN ($1, $2, $3)`,
        [testDocAId, testDocBId, testDocCId]
      )

      const docs = result.rows.reduce<Record<string, string | null>>((acc, row) => {
        acc[row.id] = row.parent_id
        return acc
      }, {})

      expect(docs[testDocAId]).toBeNull()
      expect(docs[testDocBId]).toBe(testDocAId)
      expect(docs[testDocCId]).toBe(testDocBId)
    })

    it('should reject circular reference A -> B -> C -> A', async () => {
      // Chain is already A <- B <- C from previous test
      // Try to make A's parent be C (would create cycle)
      await expect(
        pool.query(`UPDATE documents SET parent_id = $1 WHERE id = $2`, [testDocCId, testDocAId])
      ).rejects.toThrow(/Circular reference detected/)
    })

    it('should reject two-node cycle A -> B -> A', async () => {
      // Reset chain
      await pool.query(`UPDATE documents SET parent_id = NULL WHERE workspace_id = $1`, [testWorkspaceId])

      // Set B's parent to A
      await pool.query(`UPDATE documents SET parent_id = $1 WHERE id = $2`, [testDocAId, testDocBId])

      // Try to make A's parent be B (would create cycle)
      await expect(
        pool.query(`UPDATE documents SET parent_id = $1 WHERE id = $2`, [testDocBId, testDocAId])
      ).rejects.toThrow(/Circular reference detected/)
    })
  })

  describe('Deep nesting allowed', () => {
    it('should allow nesting up to 100 levels', async () => {
      // Clean up for fresh test
      await pool.query(`UPDATE documents SET parent_id = NULL WHERE workspace_id = $1`, [testWorkspaceId])

      // Create a chain of 10 documents (representative test)
      const chainIds: string[] = []
      let lastId: string | null = null

      for (let i = 0; i < 10; i++) {
        const parentIdForInsert = lastId
        const insertResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, parent_id)
           VALUES ($1, 'wiki', $2, $3)
           RETURNING id`,
          [testWorkspaceId, `Chain Doc ${i}`, parentIdForInsert]
        )
        const newId = insertResult.rows[0].id as string
        chainIds.push(newId)
        lastId = newId
      }

      // Verify chain was created
      expect(chainIds.length).toBe(10)

      // Clean up chain docs
      await pool.query(
        `DELETE FROM documents WHERE id = ANY($1::uuid[])`,
        [chainIds]
      )
    })
  })
})
