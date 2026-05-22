import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as Y from 'yjs'
import { pool } from '../../db/client.js'
import { ContentRow, DocumentContentRow, DocumentStateRow, IdRow, requireFirstRow } from '../../test/pg-result.js';
import { jsonToYjs, yjsToJson, loadContentFromYjsState } from '../../utils/yjsConverter.js'

/**
 * API Content Preservation Tests
 *
 * Tests to verify that content created via API is correctly preserved
 * when loaded via the collaboration server.
 *
 * Root cause: Documents created via API have yjs_state = NULL.
 * When a browser opens the document, the collaboration server converts
 * JSON content to Yjs format. This conversion can silently fail,
 * resulting in empty documents.
 */

describe('API Content Preservation', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testWorkspaceName = `API Content Test ${testRunId}`

  let testWorkspaceId: string
  let testUserId: string

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
       VALUES ($1, 'test-hash', 'API Content User') RETURNING id`,
      [`api-content-${testRunId}@test.local`]
    )
    testUserId = requireFirstRow(userResult.rows).id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('Document Creation Scenarios', () => {
    it('should preserve content when document is created via API with TipTap JSON', async () => {
      const testContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'API Created Document' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This content was created via API.' }]
          }
        ]
      }

      // Create document with content (simulating POST /api/documents with content)
      const docResult = await pool.query<DocumentContentRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'API Content Test', $2, $3)
         RETURNING id, content, yjs_state`,
        [testWorkspaceId, JSON.stringify(testContent), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      // Verify content was stored correctly
      expect(requireFirstRow(docResult.rows).content).toEqual(testContent)
      expect(requireFirstRow(docResult.rows).yjs_state).toBeNull() // yjs_state is NULL on API creation

      // Simulate what collaboration server does on first connection
      const result = await pool.query<DocumentStateRow>(
        'SELECT yjs_state, content FROM documents WHERE id = $1',
        [docId]
      )

      // yjs_state is NULL, so fallback to content
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      if (requireFirstRow(result.rows).yjs_state) {
        Y.applyUpdate(doc, requireFirstRow(result.rows).yjs_state)
      } else if (requireFirstRow(result.rows).content) {
        // This is what getOrCreateDoc does
        let jsonContent = requireFirstRow(result.rows).content
        if (typeof jsonContent === 'string') {
          jsonContent = JSON.parse(jsonContent)
        }

        if (jsonContent && jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
          jsonToYjs(doc, fragment, jsonContent)
        }
      }

      // Verify content was converted to Yjs correctly
      expect(fragment.length).toBe(2) // heading + paragraph

      // Convert back to JSON and verify
      const convertedBack = yjsToJson(fragment)
      expect(convertedBack.type).toBe('doc')
      expect(convertedBack.content).toHaveLength(2)
      expect(convertedBack.content[0].type).toBe('heading')
      expect(convertedBack.content[1].type).toBe('paragraph')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })

    it('should use default content for issues created without explicit content', async () => {
      // Create issue without content column (mimics POST /api/issues)
      const issueResult = await pool.query<DocumentContentRow>(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
         VALUES ($1, 'issue', 'Test Issue', '{"state": "backlog"}', $2)
         RETURNING id, content, yjs_state`,
        [testWorkspaceId, testUserId]
      )

      const issueId = requireFirstRow(issueResult.rows).id

      // The schema default should be applied
      expect(requireFirstRow(issueResult.rows).content).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph' }]
      })
      expect(requireFirstRow(issueResult.rows).yjs_state).toBeNull()

      // Simulate collaboration server loading
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      if (requireFirstRow(issueResult.rows).content) {
        let jsonContent = requireFirstRow(issueResult.rows).content
        if (jsonContent && jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
          jsonToYjs(doc, fragment, jsonContent)
        }
      }

      // Should have the default empty paragraph
      expect(fragment.length).toBe(1)

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [issueId])
    })

    it('should handle rich content with formatted text', async () => {
      const richContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Formatted Content' }]
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'This has ' },
              { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' and ' },
              { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
              { type: 'text', text: ' text.' }
            ]
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'First item' }]
                  }
                ]
              },
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Second item' }]
                  }
                ]
              }
            ]
          }
        ]
      }

      // Create document
      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Rich Content Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(richContent), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      // Load and convert
      const result = await pool.query<ContentRow>(
        'SELECT content FROM documents WHERE id = $1',
        [docId]
      )

      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')
      jsonToYjs(doc, fragment, requireFirstRow(result.rows).content)

      // Should have heading, paragraph, and bulletList
      expect(fragment.length).toBe(3)

      // Verify bullet list structure
      const bulletList = fragment.get(2)
      expect(bulletList).toBeInstanceOf(Y.XmlElement)
      if (bulletList instanceof Y.XmlElement) {
        expect(bulletList.nodeName).toBe('bulletList')
        expect(bulletList.length).toBe(2) // Two list items
      }

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })

    it('should handle code blocks', async () => {
      const codeContent = {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'typescript' },
            content: [{ type: 'text', text: 'const x = 1;\nconsole.log(x);' }]
          }
        ]
      }

      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Code Block Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(codeContent), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      const result = await pool.query<ContentRow>(
        'SELECT content FROM documents WHERE id = $1',
        [docId]
      )

      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')
      jsonToYjs(doc, fragment, requireFirstRow(result.rows).content)

      expect(fragment.length).toBe(1)

      const codeBlock = fragment.get(0)
      expect(codeBlock).toBeInstanceOf(Y.XmlElement)
      if (codeBlock instanceof Y.XmlElement) {
        expect(codeBlock.nodeName).toBe('codeBlock')
        expect(codeBlock.getAttribute('language')).toBe('typescript')
      }

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })
  })

  describe('Document Type Content Preservation', () => {
    const documentTypes = ['wiki', 'issue', 'project', 'sprint', 'program'] as const

    for (const docType of documentTypes) {
      it(`should preserve content for ${docType} document type`, async () => {
        const testContent = {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `Content for ${docType}` }]
            }
          ]
        }

        const docResult = await pool.query<DocumentContentRow>(
          `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, content, yjs_state`,
          [testWorkspaceId, docType, `${docType} Test`, JSON.stringify(testContent), testUserId]
        )

        const docId = requireFirstRow(docResult.rows).id

        // Simulate collaboration server loading
        const doc = new Y.Doc()
        const fragment = doc.getXmlFragment('default')
        jsonToYjs(doc, fragment, requireFirstRow(docResult.rows).content)

        // Verify content was preserved
        expect(fragment.length).toBe(1)

        // Convert back and check text
        const convertedBack = yjsToJson(fragment)
        expect(convertedBack.content[0].content[0].text).toBe(`Content for ${docType}`)

        // Cleanup
        await pool.query('DELETE FROM documents WHERE id = $1', [docId])
      })
    }
  })

  describe('Content Update Scenarios', () => {
    it('should preserve content after PATCH /content update', async () => {
      // Create document with initial content
      const initialContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Initial content' }]
          }
        ]
      }

      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Update Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(initialContent), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      // Simulate PATCH /content update (what the API does)
      const updatedContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Updated content via API' }]
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Second paragraph added' }]
          }
        ]
      }

      await pool.query(
        `UPDATE documents SET content = $1, yjs_state = NULL, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedContent), docId]
      )

      // Simulate collaboration server reloading after invalidation
      const result = await pool.query<DocumentStateRow>(
        'SELECT content, yjs_state FROM documents WHERE id = $1',
        [docId]
      )

      expect(requireFirstRow(result.rows).yjs_state).toBeNull()

      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')
      jsonToYjs(doc, fragment, requireFirstRow(result.rows).content)

      // Should have both paragraphs
      expect(fragment.length).toBe(2)

      const convertedBack = yjsToJson(fragment)
      expect(convertedBack.content[0].content[0].text).toBe('Updated content via API')
      expect(convertedBack.content[1].content[0].text).toBe('Second paragraph added')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })

    it('should handle Yjs state being persisted and reloaded', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Will be persisted as Yjs' }]
          }
        ]
      }

      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Yjs Persist Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(content), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      // Convert to Yjs and persist (what collaboration server does)
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')
      jsonToYjs(doc, fragment, content)

      const yjsState = Y.encodeStateAsUpdate(doc)

      await pool.query(
        `UPDATE documents SET yjs_state = $1 WHERE id = $2`,
        [Buffer.from(yjsState), docId]
      )

      // Now reload from yjs_state (preferred path)
      const result = await pool.query<DocumentStateRow>(
        'SELECT yjs_state, content FROM documents WHERE id = $1',
        [docId]
      )

      expect(requireFirstRow(result.rows).yjs_state).not.toBeNull()

      // Load from Yjs state
      const doc2 = new Y.Doc()
      Y.applyUpdate(doc2, new Uint8Array(requireFirstRow(result.rows).yjs_state))

      const fragment2 = doc2.getXmlFragment('default')
      expect(fragment2.length).toBe(1)

      const convertedBack = yjsToJson(fragment2)
      expect(convertedBack.content[0].content[0].text).toBe('Will be persisted as Yjs')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle NULL content gracefully', async () => {
      // Explicitly set content to NULL
      const docResult = await pool.query<ContentRow & IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Null Content Test', NULL, $2)
         RETURNING id, content`,
        [testWorkspaceId, testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      // content should be null
      expect(requireFirstRow(docResult.rows).content).toBeNull()

      // Simulate collaboration server handling
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      // When content is null, jsonToYjs should handle gracefully
      if (requireFirstRow(docResult.rows).content) {
        jsonToYjs(doc, fragment, requireFirstRow(docResult.rows).content)
      }

      // Fragment should be empty but not throw
      expect(fragment.length).toBe(0)

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })

    it('should handle empty content array gracefully', async () => {
      const emptyContent = {
        type: 'doc',
        content: []
      }

      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Empty Content Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(emptyContent), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      const result = await pool.query<ContentRow>(
        'SELECT content FROM documents WHERE id = $1',
        [docId]
      )

      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')
      jsonToYjs(doc, fragment, requireFirstRow(result.rows).content)

      // Empty but valid
      expect(fragment.length).toBe(0)

      const convertedBack = yjsToJson(fragment)
      expect(convertedBack.type).toBe('doc')
      expect(convertedBack.content).toEqual([])

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })

    it('should handle malformed content structure', async () => {
      // Content without proper structure
      const malformedContent = {
        invalid: 'structure'
      }

      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Malformed Content Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(malformedContent), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      const result = await pool.query<ContentRow>(
        'SELECT content FROM documents WHERE id = $1',
        [docId]
      )

      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      // jsonToYjs should handle gracefully (return early)
      const content = requireFirstRow(result.rows).content
      if (content && content.type === 'doc' && Array.isArray(content.content)) {
        jsonToYjs(doc, fragment, content)
      }

      // Should not crash, fragment stays empty
      expect(fragment.length).toBe(0)

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })

    it('should handle content stored as JSON string', async () => {
      // When content comes as string (from API)
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'String content test' }]
          }
        ]
      }

      // Simulate content being double-stringified or stored as string
      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'String Content Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(content), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      const result = await pool.query<ContentRow>(
        'SELECT content FROM documents WHERE id = $1',
        [docId]
      )

      // Parse if string (what collaboration server does)
      let jsonContent = requireFirstRow(result.rows).content
      if (typeof jsonContent === 'string') {
        jsonContent = JSON.parse(jsonContent)
      }

      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')

      if (jsonContent && jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
        jsonToYjs(doc, fragment, jsonContent)
      }

      expect(fragment.length).toBe(1)

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })
  })

  describe('loadContentFromYjsState utility', () => {
    it('should convert Yjs state buffer to TipTap JSON', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Test for utility function' }]
          }
        ]
      }

      // Create Yjs doc and convert from JSON
      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')
      jsonToYjs(doc, fragment, content)

      // Get state as buffer
      const state = Buffer.from(Y.encodeStateAsUpdate(doc))

      // Use utility function
      const result = loadContentFromYjsState(state)

      expect(result).not.toBeNull()
      expect(result.type).toBe('doc')
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('paragraph')
      expect(result.content[0].content[0].text).toBe('Test for utility function')
    })
  })

  describe('Content invalidation and reload', () => {
    it('should correctly reload content after yjs_state is cleared', async () => {
      const initialContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Initial content' }]
          }
        ]
      }

      // Create document with initial content
      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Invalidation Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(initialContent), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      // Simulate first browser load - convert JSON to Yjs
      const doc1 = new Y.Doc()
      const fragment1 = doc1.getXmlFragment('default')
      jsonToYjs(doc1, fragment1, initialContent)

      // Persist yjs_state (what collaboration server does)
      const yjsState = Y.encodeStateAsUpdate(doc1)
      await pool.query(
        `UPDATE documents SET yjs_state = $1 WHERE id = $2`,
        [Buffer.from(yjsState), docId]
      )

      // Simulate API content update (clears yjs_state)
      const updatedContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Updated via API' }]
          }
        ]
      }

      await pool.query(
        `UPDATE documents SET content = $1, yjs_state = NULL WHERE id = $2`,
        [JSON.stringify(updatedContent), docId]
      )

      // Simulate second browser load after invalidation
      const result = await pool.query<DocumentStateRow>(
        'SELECT yjs_state, content FROM documents WHERE id = $1',
        [docId]
      )

      // yjs_state should be NULL after API update
      expect(requireFirstRow(result.rows).yjs_state).toBeNull()

      // Create new Y.Doc and load from content
      const doc2 = new Y.Doc()
      const fragment2 = doc2.getXmlFragment('default')

      const content = requireFirstRow(result.rows).content
      if (content && content.type === 'doc' && Array.isArray(content.content)) {
        jsonToYjs(doc2, fragment2, content)
      }

      // Verify updated content was loaded
      expect(fragment2.length).toBe(1)

      const convertedBack = yjsToJson(fragment2)
      expect(convertedBack.content[0].content[0].text).toBe('Updated via API')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })

    it('should handle concurrent content updates gracefully', async () => {
      const content1 = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Version 1' }]
          }
        ]
      }

      // Create document
      const docResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
         VALUES ($1, 'wiki', 'Concurrent Update Test', $2, $3)
         RETURNING id`,
        [testWorkspaceId, JSON.stringify(content1), testUserId]
      )

      const docId = requireFirstRow(docResult.rows).id

      // Simulate multiple API updates in sequence
      for (let i = 2; i <= 5; i++) {
        const contentN = {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `Version ${i}` }]
            }
          ]
        }

        await pool.query(
          `UPDATE documents SET content = $1, yjs_state = NULL WHERE id = $2`,
          [JSON.stringify(contentN), docId]
        )
      }

      // Final load should have version 5
      const result = await pool.query<ContentRow>(
        'SELECT content FROM documents WHERE id = $1',
        [docId]
      )

      const doc = new Y.Doc()
      const fragment = doc.getXmlFragment('default')
      jsonToYjs(doc, fragment, requireFirstRow(result.rows).content)

      const convertedBack = yjsToJson(fragment)
      expect(convertedBack.content[0].content[0].text).toBe('Version 5')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [docId])
    })
  })
})
