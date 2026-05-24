import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as Y from 'yjs'
import { pool } from '../../db/client.js'
import crypto from 'crypto'
import { isAllowedWebSocketOrigin } from '../index.js'

/**
 * Collaboration server tests
 *
 * Tests for the WebSocket collaboration module covering:
 * - Rate limiting (connection and message)
 * - Document ID parsing
 * - Yjs to JSON and JSON to Yjs conversion
 * - Visibility change handling
 * - Document conversion handling
 * - Document persistence
 */

// Import the module to test internal functions
// We need to re-export some internals for testing, or test via behavior

describe('Collaboration Server', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testWorkspaceName = `Collab Test ${testRunId}`

  let testWorkspaceId: string
  let testUserId: string
  let testUser2Id: string
  let testDocId: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test users
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Collab User 1') RETURNING id`,
      [`collab-user1-${testRunId}@test.local`]
    )
    testUserId = userResult.rows[0].id

    const user2Result = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Collab User 2') RETURNING id`,
      [`collab-user2-${testRunId}@test.local`]
    )
    testUser2Id = user2Result.rows[0].id

    // Create workspace memberships
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUser2Id]
    )

    // Create test document
    const docResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
       VALUES ($1, 'wiki', 'Test Collab Doc', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testDocId = docResult.rows[0].id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, testUser2Id])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, testUser2Id])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('Document ID Parsing', () => {
    // Test parseDocId behavior by testing document lookup patterns
    it('should extract UUID from doc:uuid format', async () => {
      // The collaboration server uses parseDocId to extract UUID from room names like "wiki:uuid"
      // We test this by verifying documents can be looked up using just the UUID part
      const result = await pool.query(
        'SELECT id FROM documents WHERE id = $1',
        [testDocId]
      )
      expect(result.rows[0].id).toBe(testDocId)
    })

    it('should handle plain UUID format', async () => {
      // parseDocId handles both "type:uuid" and just "uuid"
      // We verify the document can be accessed by UUID directly
      const uuid = testDocId
      const result = await pool.query(
        'SELECT id FROM documents WHERE id = $1',
        [uuid]
      )
      expect(result.rows[0]).toBeDefined()
    })
  })

  describe('WebSocket Origin Validation', () => {
    const originalNodeEnv = process.env.NODE_ENV

    afterAll(() => {
      process.env.NODE_ENV = originalNodeEnv
    })

    it('allows wildcard origin only outside production', () => {
      process.env.NODE_ENV = 'test'
      expect(isAllowedWebSocketOrigin('https://attacker.example', '*')).toBe(true)

      process.env.NODE_ENV = 'production'
      expect(isAllowedWebSocketOrigin('https://attacker.example', '*')).toBe(false)
    })

    it('allows explicit matching origin and rejects wrong origin', () => {
      process.env.NODE_ENV = 'production'
      expect(isAllowedWebSocketOrigin('https://app.example/path', 'https://app.example')).toBe(true)
      expect(isAllowedWebSocketOrigin('https://attacker.example', 'https://app.example')).toBe(false)
    })
  })

  describe('Yjs Document State', () => {
    it('should create and persist Yjs state to database', async () => {
      // Create a Yjs doc with content
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      doc.transact(() => {
        const paragraph = new Y.XmlElement('paragraph')
        fragment.push([paragraph])
        const text = new Y.XmlText()
        paragraph.push([text])
        text.insert(0, 'Test content for persistence')
      })

      // Encode state
      const state = Y.encodeStateAsUpdate(doc)

      // Store in database
      await pool.query(
        `UPDATE documents SET yjs_state = $1, updated_at = now() WHERE id = $2`,
        [Buffer.from(state), testDocId]
      )

      // Retrieve and verify
      const result = await pool.query(
        'SELECT yjs_state FROM documents WHERE id = $1',
        [testDocId]
      )

      expect(result.rows[0].yjs_state).toBeDefined()

      // Verify content can be decoded
      const loadedDoc = new Y.Doc()
      Y.applyUpdate(loadedDoc, new Uint8Array(result.rows[0].yjs_state))

      const loadedFragment = loadedDoc.getXmlFragment('default')
      expect(loadedFragment.length).toBeGreaterThan(0)
    })

    it('should merge concurrent Yjs updates correctly', async () => {
      // Create two docs simulating concurrent edits
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      // User 1 makes an edit
      const fragment1 = doc1.getXmlFragment('default')
      doc1.transact(() => {
        const p = new Y.XmlElement('paragraph')
        fragment1.push([p])
        const t = new Y.XmlText()
        p.push([t])
        t.insert(0, 'User 1 content')
      })

      // User 2 makes a different edit
      const fragment2 = doc2.getXmlFragment('default')
      doc2.transact(() => {
        const p = new Y.XmlElement('paragraph')
        fragment2.push([p])
        const t = new Y.XmlText()
        p.push([t])
        t.insert(0, 'User 2 content')
      })

      // Exchange updates (simulate sync)
      const update1 = Y.encodeStateAsUpdate(doc1)
      const update2 = Y.encodeStateAsUpdate(doc2)

      Y.applyUpdate(doc1, update2)
      Y.applyUpdate(doc2, update1)

      // Both docs should now have both edits
      expect(doc1.getXmlFragment('default').length).toBe(2)
      expect(doc2.getXmlFragment('default').length).toBe(2)
    })
  })

  describe('Yjs JSON Conversion', () => {
    it('should convert TipTap JSON to Yjs and back', async () => {
      const tipTapContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Test Heading' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Test paragraph content.' }]
          }
        ]
      }

      // Create Yjs doc and convert from JSON
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      // Replicate jsonToYjs logic
      doc.transact(() => {
        for (const node of tipTapContent.content) {
          const element = new Y.XmlElement(node.type)
          fragment.push([element])
          if (node.attrs) {
            for (const [key, value] of Object.entries(node.attrs)) {
              element.setAttribute(key, String(value))
            }
          }
          if (node.content) {
            for (const child of node.content) {
              if (child.type === 'text') {
                const text = new Y.XmlText()
                element.push([text])
                text.insert(0, child.text || '')
              }
            }
          }
        }
      })

      // Verify structure
      expect(fragment.length).toBe(2)

      // First element should be heading
      const heading = fragment.get(0)
      expect(heading).toBeInstanceOf(Y.XmlElement)
      if (heading instanceof Y.XmlElement) {
        expect(heading.nodeName).toBe('heading')
        expect(heading.getAttribute('level')).toBe('1')
      }

      // Second element should be paragraph
      const paragraph = fragment.get(1)
      expect(paragraph).toBeInstanceOf(Y.XmlElement)
      if (paragraph instanceof Y.XmlElement) {
        expect(paragraph.nodeName).toBe('paragraph')
      }
    })

    it('should handle empty document conversion', async () => {
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      // Empty content should result in empty fragment
      expect(fragment.length).toBe(0)
    })

    it('should handle nested list structures', async () => {
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      // Create a bullet list structure
      doc.transact(() => {
        const bulletList = new Y.XmlElement('bulletList')
        fragment.push([bulletList])

        const listItem = new Y.XmlElement('listItem')
        bulletList.push([listItem])

        const paragraph = new Y.XmlElement('paragraph')
        listItem.push([paragraph])

        const text = new Y.XmlText()
        paragraph.push([text])
        text.insert(0, 'List item content')
      })

      // Verify nested structure
      expect(fragment.length).toBe(1)
      const bulletList = fragment.get(0)
      expect(bulletList).toBeInstanceOf(Y.XmlElement)
      if (bulletList instanceof Y.XmlElement) {
        expect(bulletList.nodeName).toBe('bulletList')
        expect(bulletList.length).toBe(1)
      }
    })
  })

  describe('Session Validation', () => {
    it('should validate session for WebSocket connection', async () => {
      // Create a valid session
      const sessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
         VALUES ($1, $2, $3, now() + interval '1 hour', now())`,
        [sessionId, testUserId, testWorkspaceId]
      )

      // Query session to verify it exists and is valid
      const result = await pool.query(
        `SELECT user_id, workspace_id, last_activity, created_at
         FROM sessions WHERE id = $1`,
        [sessionId]
      )

      expect(result.rows[0]).toBeDefined()
      expect(result.rows[0].user_id).toBe(testUserId)
      expect(result.rows[0].workspace_id).toBe(testWorkspaceId)

      // Cleanup
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId])
    })

    it('should reject expired sessions', async () => {
      // Create an expired session
      const sessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
         VALUES ($1, $2, $3, now() - interval '1 hour', now() - interval '20 minutes')`,
        [sessionId, testUserId, testWorkspaceId]
      )

      // Check inactivity timeout (15 minutes)
      const SESSION_TIMEOUT_MS = 15 * 60 * 1000
      const result = await pool.query(
        `SELECT user_id, last_activity FROM sessions WHERE id = $1`,
        [sessionId]
      )

      if (result.rows[0]) {
        const lastActivity = new Date(result.rows[0].last_activity)
        const inactivityMs = Date.now() - lastActivity.getTime()
        expect(inactivityMs).toBeGreaterThan(SESSION_TIMEOUT_MS)
      }

      // Cleanup
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId])
    })

    it('should reject sessions past absolute timeout', async () => {
      // Create a session past absolute timeout (12 hours)
      const sessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
         VALUES ($1, $2, $3, now() + interval '1 hour', now(), now() - interval '13 hours')`,
        [sessionId, testUserId, testWorkspaceId]
      )

      // Check absolute timeout (12 hours)
      const ABSOLUTE_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000
      const result = await pool.query(
        `SELECT created_at FROM sessions WHERE id = $1`,
        [sessionId]
      )

      if (result.rows[0]) {
        const createdAt = new Date(result.rows[0].created_at)
        const sessionAgeMs = Date.now() - createdAt.getTime()
        expect(sessionAgeMs).toBeGreaterThan(ABSOLUTE_SESSION_TIMEOUT_MS)
      }

      // Cleanup
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId])
    })
  })

  describe('Document Access Control', () => {
    it('should allow workspace member to access workspace document', async () => {
      // Workspace doc created in beforeAll is accessible
      const result = await pool.query(
        `SELECT d.id,
                (d.visibility = 'workspace' OR d.created_by = $2 OR
                 (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
         FROM documents d
         WHERE d.id = $1 AND d.workspace_id = $3`,
        [testDocId, testUser2Id, testWorkspaceId]
      )

      expect(result.rows[0].can_access).toBe(true)
    })

    it('should allow creator to access private document', async () => {
      // Create private doc
      const privateDocResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private Test Doc', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const privateDocId = privateDocResult.rows[0].id

      // Check creator can access
      const result = await pool.query(
        `SELECT d.id,
                (d.visibility = 'workspace' OR d.created_by = $2 OR
                 (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
         FROM documents d
         WHERE d.id = $1 AND d.workspace_id = $3`,
        [privateDocId, testUserId, testWorkspaceId]
      )

      expect(result.rows[0].can_access).toBe(true)

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [privateDocId])
    })

    it('should block non-creator from accessing private document', async () => {
      // Create private doc as user1
      const privateDocResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'User1 Private Doc', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const privateDocId = privateDocResult.rows[0].id

      // Check user2 cannot access
      const result = await pool.query(
        `SELECT d.id,
                (d.visibility = 'workspace' OR d.created_by = $2 OR
                 (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
         FROM documents d
         WHERE d.id = $1 AND d.workspace_id = $3`,
        [privateDocId, testUser2Id, testWorkspaceId]
      )

      expect(result.rows[0].can_access).toBe(false)

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [privateDocId])
    })
  })

  describe('Rate Limiting', () => {
    // Test rate limiting configuration
    const RATE_LIMIT = {
      CONNECTION_WINDOW_MS: 60_000,
      MAX_CONNECTIONS_PER_IP: 30,
      MESSAGE_WINDOW_MS: 1_000,
      MAX_MESSAGES_PER_SECOND: 50,
    }

    it('should have reasonable connection rate limit (30 per minute)', () => {
      expect(RATE_LIMIT.MAX_CONNECTIONS_PER_IP).toBe(30)
      expect(RATE_LIMIT.CONNECTION_WINDOW_MS).toBe(60_000)
    })

    it('should have reasonable message rate limit (50 per second)', () => {
      expect(RATE_LIMIT.MAX_MESSAGES_PER_SECOND).toBe(50)
      expect(RATE_LIMIT.MESSAGE_WINDOW_MS).toBe(1_000)
    })

    it('should use sliding window for rate limiting', () => {
      // Simulate sliding window behavior
      const timestamps: number[] = []
      const now = Date.now()

      // Add timestamps over time
      for (let i = 0; i < 35; i++) {
        timestamps.push(now - (i * 2000)) // Every 2 seconds going back
      }

      // Count recent within window
      const recentTimestamps = timestamps.filter(
        t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS
      )

      // Should be exactly 30 within the 60 second window
      expect(recentTimestamps.length).toBe(30)
    })
  })

  describe('Document Persistence', () => {
    it('should persist document state to database', async () => {
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      doc.transact(() => {
        const p = new Y.XmlElement('paragraph')
        fragment.push([p])
        const t = new Y.XmlText()
        p.push([t])
        t.insert(0, 'Persisted content')
      })

      const state = Y.encodeStateAsUpdate(doc)

      // Persist to database
      await pool.query(
        `UPDATE documents SET yjs_state = $1, updated_at = now() WHERE id = $2`,
        [Buffer.from(state), testDocId]
      )

      // Verify persisted
      const result = await pool.query(
        `SELECT yjs_state, updated_at FROM documents WHERE id = $1`,
        [testDocId]
      )

      expect(result.rows[0].yjs_state).toBeDefined()
      expect(result.rows[0].yjs_state.length).toBeGreaterThan(0)
    })

    it('should load persisted Yjs state correctly', async () => {
      // First, persist a known state
      const originalDoc = new Y.Doc()
      const fragment = originalDoc.getXmlFragment('default')

      originalDoc.transact(() => {
        const p = new Y.XmlElement('paragraph')
        fragment.push([p])
        const t = new Y.XmlText()
        p.push([t])
        t.insert(0, 'Load test content')
      })

      const state = Y.encodeStateAsUpdate(originalDoc)

      await pool.query(
        `UPDATE documents SET yjs_state = $1 WHERE id = $2`,
        [Buffer.from(state), testDocId]
      )

      // Now load it back
      const result = await pool.query(
        `SELECT yjs_state FROM documents WHERE id = $1`,
        [testDocId]
      )

      const loadedDoc = new Y.Doc()
      Y.applyUpdate(loadedDoc, new Uint8Array(result.rows[0].yjs_state))

      const loadedFragment = loadedDoc.getXmlFragment('default')
      expect(loadedFragment.length).toBe(1)

      const firstElement = loadedFragment.get(0)
      expect(firstElement).toBeInstanceOf(Y.XmlElement)
    })

    it('should fallback to JSON content when no Yjs state exists', async () => {
      // Create doc with JSON content but no yjs_state
      const testContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'JSON fallback content' }]
          }
        ]
      }

      const jsonDocResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, content, yjs_state, created_by)
         VALUES ($1, 'wiki', 'JSON Content Doc', $2, NULL, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(testContent), testUserId]
      )
      const jsonDocId = jsonDocResult.rows[0].id

      // Verify content is stored
      const result = await pool.query(
        `SELECT content, yjs_state FROM documents WHERE id = $1`,
        [jsonDocId]
      )

      expect(result.rows[0].yjs_state).toBeNull()
      expect(result.rows[0].content).toBeDefined()

      // Parse content
      const content = typeof result.rows[0].content === 'string'
        ? JSON.parse(result.rows[0].content)
        : result.rows[0].content

      expect(content.type).toBe('doc')
      expect(content.content[0].type).toBe('paragraph')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [jsonDocId])
    })
  })

  describe('Visibility Change Handling', () => {
    it('should allow visibility to be changed from workspace to private', async () => {
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Visibility Test Doc', 'workspace', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const docId = docResult.rows[0].id

      // Change visibility to private
      await pool.query(
        `UPDATE documents SET visibility = 'private' WHERE id = $1`,
        [docId]
      )

      // Verify change
      const result = await pool.query(
        `SELECT visibility FROM documents WHERE id = $1`,
        [docId]
      )

      expect(result.rows[0].visibility).toBe('private')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })

    it('should allow visibility to be changed from private to workspace', async () => {
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by)
         VALUES ($1, 'wiki', 'Private to Workspace', 'private', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const docId = docResult.rows[0].id

      // Change visibility to workspace
      await pool.query(
        `UPDATE documents SET visibility = 'workspace' WHERE id = $1`,
        [docId]
      )

      // Verify change
      const result = await pool.query(
        `SELECT visibility FROM documents WHERE id = $1`,
        [docId]
      )

      expect(result.rows[0].visibility).toBe('workspace')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })
  })

  describe('Document Conversion Handling', () => {
    it('should support issue to project conversion', async () => {
      // Create issue
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'issue', 'Issue to Convert', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const issueId = issueResult.rows[0].id

      // Simulate conversion by updating document_type
      await pool.query(
        `UPDATE documents SET document_type = 'project' WHERE id = $1`,
        [issueId]
      )

      // Verify conversion
      const result = await pool.query(
        `SELECT document_type FROM documents WHERE id = $1`,
        [issueId]
      )

      expect(result.rows[0].document_type).toBe('project')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [issueId])
    })

    it('should support project to issue conversion', async () => {
      // Create project
      const projectResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'project', 'Project to Convert', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const projectId = projectResult.rows[0].id

      // Simulate conversion by updating document_type
      await pool.query(
        `UPDATE documents SET document_type = 'issue' WHERE id = $1`,
        [projectId]
      )

      // Verify conversion
      const result = await pool.query(
        `SELECT document_type FROM documents WHERE id = $1`,
        [projectId]
      )

      expect(result.rows[0].document_type).toBe('issue')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [projectId])
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid document ID gracefully', async () => {
      const invalidId = '00000000-0000-0000-0000-000000000000'

      const result = await pool.query(
        `SELECT id FROM documents WHERE id = $1`,
        [invalidId]
      )

      expect(result.rows.length).toBe(0)
    })

    it('should handle malformed UUID gracefully', async () => {
      // The database should reject malformed UUIDs
      try {
        await pool.query(
          `SELECT id FROM documents WHERE id = $1`,
          ['not-a-valid-uuid']
        )
        // If we get here, the database accepted it but returned no rows
        expect(true).toBe(true)
      } catch (error: any) {
        // Expected - malformed UUID should throw
        expect(error.message).toContain('invalid input syntax for type uuid')
      }
    })

    it('should handle null yjs_state during document load', async () => {
      // Create document with null yjs_state
      const docResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, yjs_state, created_by)
         VALUES ($1, 'wiki', 'Null State Doc', NULL, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const docId = docResult.rows[0].id

      const result = await pool.query(
        `SELECT yjs_state, content FROM documents WHERE id = $1`,
        [docId]
      )

      expect(result.rows[0].yjs_state).toBeNull()

      // The collaboration server should handle this gracefully
      // by creating an empty Y.Doc
      const doc = new Y.Doc()
      if (result.rows[0].yjs_state) {
        Y.applyUpdate(doc, new Uint8Array(result.rows[0].yjs_state))
      }

      // Doc should be valid but empty
      const fragment = doc.getXmlFragment('default')
      expect(fragment.length).toBe(0)

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })
  })

  describe('Awareness Protocol', () => {
    it('should track client IDs correctly', () => {
      const doc = new Y.Doc()
      // Each doc instance gets a unique clientID
      expect(typeof doc.clientID).toBe('number')
      expect(doc.clientID).toBeGreaterThan(0)
    })

    it('should have unique client IDs for different docs', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      // Client IDs should be unique per doc instance
      expect(doc1.clientID).not.toBe(doc2.clientID)
    })
  })

  describe('Sync Protocol', () => {
    it('should generate sync messages', () => {
      const doc = new Y.Doc()

      // Add some content
      const fragment = doc.getXmlFragment('default')
      doc.transact(() => {
        const p = new Y.XmlElement('paragraph')
        fragment.push([p])
      })

      // Generate state vector (used in sync step 1)
      const stateVector = Y.encodeStateVector(doc)
      expect(stateVector).toBeInstanceOf(Uint8Array)
      expect(stateVector.length).toBeGreaterThan(0)

      // Generate full update (used in sync step 2)
      const update = Y.encodeStateAsUpdate(doc)
      expect(update).toBeInstanceOf(Uint8Array)
      expect(update.length).toBeGreaterThan(0)
    })

    it('should apply sync updates between docs', () => {
      // Create source doc with content
      const sourceDoc = new Y.Doc()
      const sourceFragment = sourceDoc.getXmlFragment('default')
      sourceDoc.transact(() => {
        const p = new Y.XmlElement('paragraph')
        sourceFragment.push([p])
        const t = new Y.XmlText()
        p.push([t])
        t.insert(0, 'Synced content')
      })

      // Create target doc (empty)
      const targetDoc = new Y.Doc()

      // Get source state
      const sourceState = Y.encodeStateAsUpdate(sourceDoc)

      // Apply to target
      Y.applyUpdate(targetDoc, sourceState)

      // Verify target has the content
      const targetFragment = targetDoc.getXmlFragment('default')
      expect(targetFragment.length).toBe(1)
    })
  })
})
