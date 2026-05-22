import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pgResult } from '../test/pg-result.js';

// Mock pool before importing the module
vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { transformIssueLinks } from '../utils/transformIssueLinks.js';
import { pool } from '../db/client.js';

describe('transformIssueLinks', () => {
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pattern matching and transformation', () => {
    it('transforms #123 pattern to clickable link', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'See #42 for details' }],
          },
        ],
      };

      // Mock issue lookup
      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([{ id: 'issue-uuid-42', ticket_number: 42 }])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      expect(result.content[0].content).toHaveLength(3);
      expect(result.content[0].content[0]).toEqual({ type: 'text', text: 'See ' });
      expect(result.content[0].content[1]).toEqual({
        type: 'text',
        text: '#42',
        marks: [
          {
            type: 'link',
            attrs: {
              href: '/issues/issue-uuid-42',
              target: '_self',
            },
          },
        ],
      });
      expect(result.content[0].content[2]).toEqual({ type: 'text', text: ' for details' });
    });

    it('transforms "issue #123" pattern to clickable link', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Fixed in issue #100' }],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([{ id: 'issue-uuid-100', ticket_number: 100 }])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      expect(result.content[0].content[1]).toEqual({
        type: 'text',
        text: 'issue #100',
        marks: [
          {
            type: 'link',
            attrs: {
              href: '/issues/issue-uuid-100',
              target: '_self',
            },
          },
        ],
      });
    });

    it('transforms "ISS-123" pattern to clickable link', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Related to ISS-500' }],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([{ id: 'issue-uuid-500', ticket_number: 500 }])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      expect(result.content[0].content[1]).toEqual({
        type: 'text',
        text: 'ISS-500',
        marks: [
          {
            type: 'link',
            attrs: {
              href: '/issues/issue-uuid-500',
              target: '_self',
            },
          },
        ],
      });
    });

    it('transforms multiple issue references in same text', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'See #10, #20, and issue #30' }],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([
          { id: 'issue-uuid-10', ticket_number: 10 },
          { id: 'issue-uuid-20', ticket_number: 20 },
          { id: 'issue-uuid-30', ticket_number: 30 },
        ])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      // Should split into multiple text nodes with links
      const nodes = result.content[0].content;
      expect(nodes.some((n: any) => n.text === '#10' && n.marks)).toBe(true);
      expect(nodes.some((n: any) => n.text === '#20' && n.marks)).toBe(true);
      expect(nodes.some((n: any) => n.text === 'issue #30' && n.marks)).toBe(true);
    });

    it('queries database for all unique ticket numbers', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#1 and #2 and #3' }],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      await transformIssueLinks(content, workspaceId);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('ticket_number = ANY'),
        [workspaceId, expect.arrayContaining([1, 2, 3])]
      );
    });

    it('deduplicates ticket numbers in query', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#5 and #5 and #5' }],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      await transformIssueLinks(content, workspaceId);

      const queryArgs = vi.mocked(pool.query).mock.calls[0]![1] as any[];
      const ticketNumbers = queryArgs[1];

      // Should only query for #5 once despite appearing multiple times
      expect(ticketNumbers).toEqual([5]);
    });
  });

  describe('edge cases', () => {
    it('does not transform text that already has marks', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '#99 is already a link',
                marks: [{ type: 'link', attrs: { href: '/somewhere' } }],
              },
            ],
          },
        ],
      };

      // Mock database lookup (implementation still queries even for marked text)
      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([{ id: 'issue-uuid-99', ticket_number: 99 }])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      // Should not transform already marked text
      expect(result.content[0].content[0]).toEqual({
        type: 'text',
        text: '#99 is already a link',
        marks: [{ type: 'link', attrs: { href: '/somewhere' } }],
      });

      // Note: Implementation does query database for ticket numbers,
      // but doesn't transform text that already has marks
      expect(pool.query).toHaveBeenCalled();
    });

    it('keeps issue reference as plain text when issue does not exist', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Non-existent #999' }],
          },
        ],
      };

      // No matching issues found
      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      const result = await transformIssueLinks(content, workspaceId) as any;

      // When no issues are found, content is returned unchanged
      // (implementation optimization - doesn't transform if issueMap is empty)
      expect(result).toEqual(content);
      expect(result.content[0].content[0].text).toBe('Non-existent #999');
      expect(result.content[0].content[0].marks).toBeUndefined();
    });

    it('transforms existing issues but not non-existent ones', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'See #50 and #999' }],
          },
        ],
      };

      // Only #50 exists
      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([{ id: 'issue-uuid-50', ticket_number: 50 }])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      const nodes = result.content[0].content;

      // #50 should have link mark
      const link50 = nodes.find((n: any) => n.text === '#50');
      expect(link50?.marks).toBeDefined();

      // #999 should be plain text (no marks)
      const text999 = nodes.find((n: any) => n.text === '#999');
      expect(text999?.marks).toBeUndefined();
    });

    it('returns unchanged content when no issue patterns found', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'No issue references here' }],
          },
        ],
      };

      const result = await transformIssueLinks(content, workspaceId);

      // Should not query database
      expect(pool.query).not.toHaveBeenCalled();

      // Should return unchanged
      expect(result).toEqual(content);
    });

    it('returns unchanged content for invalid input', async () => {
      expect(await transformIssueLinks(null, workspaceId)).toBeNull();
      expect(await transformIssueLinks(undefined, workspaceId)).toBeUndefined();
      expect(await transformIssueLinks('string', workspaceId)).toBe('string');
      expect(await transformIssueLinks(123, workspaceId)).toBe(123);
    });

    it('returns unchanged content when not a doc type', async () => {
      const content = {
        type: 'paragraph',
        content: [{ type: 'text', text: '#123' }],
      };

      const result = await transformIssueLinks(content, workspaceId);
      expect(result).toEqual(content);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('handles empty document content', async () => {
      const content = {
        type: 'doc',
        content: [],
      };

      const result = await transformIssueLinks(content, workspaceId);
      expect(result).toEqual(content);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('nested content structures', () => {
    it('transforms issue links in nested paragraphs', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Item with #25' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([{ id: 'issue-uuid-25', ticket_number: 25 }])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      const paragraph = result.content[0].content[0].content[0];
      const link = paragraph.content.find((n: any) => n.text === '#25');
      expect(link?.marks).toBeDefined();
      expect(link?.marks[0].attrs.href).toBe('/issues/issue-uuid-25');
    });

    it('transforms issue links in blockquotes', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Quoted text with issue #77' }],
              },
            ],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([{ id: 'issue-uuid-77', ticket_number: 77 }])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      const paragraph = result.content[0].content[0];
      const link = paragraph.content.find((n: any) => n.text === 'issue #77');
      expect(link?.marks).toBeDefined();
    });

    it('recursively transforms all nested issue references', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Top level #1' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Nested #2' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([
          { id: 'issue-uuid-1', ticket_number: 1 },
          { id: 'issue-uuid-2', ticket_number: 2 },
        ])
      );

      await transformIssueLinks(content, workspaceId);

      // Should find both #1 and #2
      expect(pool.query).toHaveBeenCalledWith(
        expect.anything(),
        [workspaceId, expect.arrayContaining([1, 2])]
      );
    });
  });

  describe('workspace isolation', () => {
    it('only looks up issues in the specified workspace', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#123' }],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      await transformIssueLinks(content, workspaceId);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('workspace_id = $1'),
        [workspaceId, [123]]
      );
    });

    it('does not transform issues from other workspaces', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#888' }],
          },
        ],
      };

      // Issue exists but in different workspace
      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      const result = await transformIssueLinks(content, workspaceId) as any;

      // Should remain plain text
      const textNode = result.content[0].content[0];
      expect(textNode.marks).toBeUndefined();
    });
  });

  describe('case variations', () => {
    it('handles "issue #" with various casings', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Issue #5 and ISSUE #6' }],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(
        pgResult([
          { id: 'issue-uuid-5', ticket_number: 5 },
          { id: 'issue-uuid-6', ticket_number: 6 },
        ])
      );

      const result = await transformIssueLinks(content, workspaceId) as any;

      const nodes = result.content[0].content;

      // Both should be transformed
      expect(nodes.some((n: any) => n.text === 'Issue #5' && n.marks)).toBe(true);
      expect(nodes.some((n: any) => n.text === 'ISSUE #6' && n.marks)).toBe(true);
    });
  });

  describe('performance considerations', () => {
    it('does not query database when no patterns detected', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Just normal text without issue refs' }],
          },
        ],
      };

      const result = await transformIssueLinks(content, workspaceId);

      // Should not query when no issue patterns found
      expect(pool.query).not.toHaveBeenCalled();

      // Should return unchanged content
      expect(result).toEqual(content);
    });

    it('makes single batch query for multiple issues', async () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '#1 #2 #3 #4 #5' }],
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(pgResult([]));

      await transformIssueLinks(content, workspaceId);

      // Should make exactly one query for all issues
      expect(pool.query).toHaveBeenCalledTimes(1);
    });
  });
});
