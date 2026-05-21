import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { isWorkspaceAdmin } from '../middleware/visibility.js';
import { documentTypeSchema } from '../schemas/document-boundary.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';

type RouterType = ReturnType<typeof Router>;
export const searchRouter: RouterType = Router();

type ContentSearchRow = {
  id: string | null;
  title: string | null;
  document_type: string | null;
  visibility: string | null;
  ticket_number: number | null;
  updated_at: Date | null;
  rank: number | null;
  snippet: string | null;
  total: number;
};

type ContentSearchDocumentRow = Omit<ContentSearchRow, 'total'> & { id: string };

// SECURITY: Escape SQL LIKE pattern special characters to prevent wildcard injection
// This prevents users from using % and _ to match arbitrary patterns
function escapeLikePattern(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

function hasContentSearchDocument(row: ContentSearchRow): row is ContentSearchDocumentRow & { total: number } {
  return row.id !== null;
}

// Search for mentions (people + documents)
// GET /api/search/mentions?q=:query
searchRouter.get('/mentions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const searchQuery = (req.query.q as string) || '';
    const { workspaceId, userId } = getAuthenticatedRouteContext(req);

    // SECURITY: Escape wildcard characters to prevent SQL wildcard injection
    const sanitizedQuery = escapeLikePattern(searchQuery);

    // Check if user is admin for visibility filtering
    const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

    // Search for people (person documents linked via properties.user_id)
    // Person documents are always workspace-visible, so no visibility filter needed
    const peopleResult = await pool.query(
      `SELECT
         d.id::text as id,
         d.title as name,
         'person' as document_type
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND d.archived_at IS NULL
         AND d.deleted_at IS NULL
         AND d.title ILIKE $2
       ORDER BY d.title ASC
       LIMIT 5`,
      [workspaceId, `%${sanitizedQuery}%`]
    );

    // Search for other documents (wiki, issue, project, program)
    // Filter by visibility: workspace docs, user's private docs, or all if admin
    const documentsResult = await pool.query(
      `SELECT id, title, document_type, visibility
       FROM documents
       WHERE workspace_id = $1
         AND document_type IN ('wiki', 'issue', 'project', 'program')
         AND archived_at IS NULL
         AND deleted_at IS NULL
         AND title ILIKE $2
         AND (visibility = 'workspace' OR created_by = $3 OR $4 = TRUE)
       ORDER BY
         CASE document_type
           WHEN 'issue' THEN 1
           WHEN 'wiki' THEN 2
           WHEN 'project' THEN 3
           WHEN 'program' THEN 4
           ELSE 5
         END,
         updated_at DESC
       LIMIT 10`,
      [workspaceId, `%${sanitizedQuery}%`, userId, isAdmin]
    );

    res.json({
      people: peopleResult.rows,
      documents: documentsResult.rows,
    });
  } catch (error) {
    console.error('Error searching mentions:', error);
    res.status(500).json({ error: 'Failed to search mentions' });
  }
});

// Search document titles for command palette navigation
// GET /api/search/documents?q=:query&type=:document_type&limit=:limit
searchRouter.get('/documents', authMiddleware, async (req: Request, res: Response) => {
  try {
    const searchQuery = ((req.query.q as string) || '').trim();
    const documentType = req.query.type as string | undefined;
    const { workspaceId, userId } = getAuthenticatedRouteContext(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);

    const sanitizedQuery = escapeLikePattern(searchQuery);
    const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

    if (documentType && !documentTypeSchema.safeParse(documentType).success) {
      res.status(400).json({ error: 'Invalid document type' });
      return;
    }

    const params: (string | boolean | number)[] = [workspaceId, userId, isAdmin];
    let query = `
      SELECT id, title, document_type, visibility, ticket_number, updated_at
      FROM documents
      WHERE workspace_id = $1
        AND archived_at IS NULL
        AND deleted_at IS NULL
        AND (visibility = 'workspace' OR created_by = $2 OR $3 = TRUE)
    `;

    if (searchQuery) {
      params.push(`%${sanitizedQuery}%`);
      query += ` AND title ILIKE $${params.length}`;
    }

    if (documentType) {
      params.push(documentType);
      query += ` AND document_type = $${params.length}`;
    } else {
      query += ` AND document_type IN ('wiki', 'issue', 'project', 'program', 'sprint', 'person')`;
    }

    params.push(limit);
    query += `
      ORDER BY
        CASE document_type
          WHEN 'issue' THEN 1
          WHEN 'wiki' THEN 2
          WHEN 'program' THEN 3
          WHEN 'project' THEN 4
          WHEN 'sprint' THEN 5
          WHEN 'person' THEN 6
          ELSE 7
        END,
        updated_at DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(query, params);

    res.json({
      documents: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Error searching documents:', error);
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

// Search document titles and full TipTap content
// GET /api/search/content?q=:query&type=:document_type&limit=:limit&offset=:offset
searchRouter.get('/content', authMiddleware, async (req: Request, res: Response) => {
  try {
    const searchQuery = ((req.query.q as string) || '').trim();
    const documentType = req.query.type as string | undefined;
    const { workspaceId, userId } = getAuthenticatedRouteContext(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    if (!searchQuery) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    if (documentType && !documentTypeSchema.safeParse(documentType).success) {
      res.status(400).json({ error: 'Invalid document type' });
      return;
    }

    const isAdmin = await isWorkspaceAdmin(userId, workspaceId);
    const params: (string | boolean | number)[] = [workspaceId, searchQuery, userId, isAdmin];
    let typeFilter = '';

    if (documentType) {
      params.push(documentType);
      typeFilter = `AND d.document_type = $${params.length}`;
    }

    params.push(limit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const result = await pool.query<ContentSearchRow>(
      `WITH search_query AS (
         SELECT websearch_to_tsquery('english', $2) AS query
       ),
       visible_matches AS (
         SELECT
           d.id,
           d.title,
           d.document_type,
           d.visibility,
           d.ticket_number,
           d.updated_at,
           ts_rank_cd(i.search_vector, search_query.query) AS rank,
           COALESCE(
             NULLIF(ts_headline(
               'english',
               i.content_text,
               search_query.query,
               'StartSel=<mark>, StopSel=</mark>, MaxWords=24, MinWords=8, ShortWord=3'
             ), ''),
             ts_headline(
               'english',
               i.title,
               search_query.query,
               'StartSel=<mark>, StopSel=</mark>, MaxWords=16, MinWords=4, ShortWord=3'
             )
           ) AS snippet
         FROM document_search_index i
         JOIN documents d ON d.id = i.document_id
         CROSS JOIN search_query
         WHERE d.workspace_id = $1
           AND d.archived_at IS NULL
           AND d.deleted_at IS NULL
           AND (d.visibility = 'workspace' OR d.created_by = $3 OR $4 = TRUE)
           ${typeFilter}
           AND i.search_vector @@ search_query.query
       )
       SELECT
         paged_matches.id,
         paged_matches.title,
         paged_matches.document_type,
         paged_matches.visibility,
         paged_matches.ticket_number,
         paged_matches.updated_at,
         paged_matches.rank,
         paged_matches.snippet,
         total_count.total
       FROM (SELECT COUNT(*)::int AS total FROM visible_matches) total_count
       LEFT JOIN LATERAL (
         SELECT *
         FROM visible_matches
         ORDER BY rank DESC, updated_at DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}
       ) paged_matches ON TRUE`,
      params
    );

    res.json({
      documents: result.rows
        .filter(hasContentSearchDocument)
        .map(({ total, ...row }) => row),
      total: result.rows[0]?.total ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error searching document content:', error);
    res.status(500).json({ error: 'Failed to search document content' });
  }
});

// Search for learning wiki documents
// GET /api/search/learnings?q=:query&program_id=:program_id
searchRouter.get('/learnings', authMiddleware, async (req: Request, res: Response) => {
  try {
    const searchQuery = (req.query.q as string) || '';
    const programId = req.query.program_id as string | undefined;
    const { workspaceId, userId } = getAuthenticatedRouteContext(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    // SECURITY: Escape wildcard characters to prevent SQL wildcard injection
    const sanitizedQuery = escapeLikePattern(searchQuery);

    // Check if user is admin for visibility filtering
    const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

    // Search for learning wiki documents
    // Match documents where:
    // - title starts with "Learning:" OR properties.tags contains "learning"
    // - AND title/tags match the search query
    const params: (string | boolean | number)[] = [workspaceId, userId, isAdmin];
    let query = `
      SELECT
        d.id,
        d.title,
        prog_da.related_id as program_id,
        d.properties->>'category' as category,
        d.properties->'tags' as tags,
        d.properties->>'source_prd' as source_prd,
        d.properties->>'source_sprint_id' as source_sprint_id,
        d.created_at,
        d.updated_at,
        substring(d.content::text, 1, 500) as content_preview
      FROM documents d
      LEFT JOIN document_associations prog_da ON d.id = prog_da.document_id AND prog_da.relationship_type = 'program'
      WHERE d.workspace_id = $1
        AND d.document_type = 'wiki'
        AND d.archived_at IS NULL
        AND d.deleted_at IS NULL
        AND (d.visibility = 'workspace' OR d.created_by = $2 OR $3 = TRUE)
        AND (
          d.title LIKE 'Learning:%'
          OR d.properties->'tags' ? 'learning'
        )
    `;

    // Add search query filter if provided
    if (searchQuery) {
      params.push(`%${sanitizedQuery}%`);
      const queryParamIndex = params.length;
      query += `
        AND (
          d.title ILIKE $${queryParamIndex}
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(d.properties->'tags') AS tag
            WHERE tag ILIKE $${queryParamIndex}
          )
          OR d.properties->>'category' ILIKE $${queryParamIndex}
        )
      `;
    }

    // Filter by program if provided
    if (programId) {
      params.push(programId);
      query += ` AND d.id IN (SELECT document_id FROM document_associations WHERE related_id = $${params.length} AND relationship_type = 'program')`;
    }

    params.push(limit);
    query += ` ORDER BY d.updated_at DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);

    res.json({
      learnings: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error('Error searching learnings:', error);
    res.status(500).json({ error: 'Failed to search learnings' });
  }
});
