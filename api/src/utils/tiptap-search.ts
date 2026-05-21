import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/client.js';

type Queryable = Pool | PoolClient;

type SearchIndexDocument = {
  id: string;
  workspace_id: string;
  document_type: string;
  title: string | null;
  properties: unknown;
  content: unknown;
  updated_at: Date | string;
};

const BLOCK_NODE_TYPES = new Set([
  'blockquote',
  'bulletList',
  'codeBlock',
  'doc',
  'heading',
  'horizontalRule',
  'listItem',
  'orderedList',
  'paragraph',
  'table',
  'tableRow',
]);

function normalizeSearchText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractNodeText(node: unknown, chunks: string[]): void {
  if (!node || typeof node !== 'object') return;

  const tiptapNode = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: Record<string, unknown>;
  };

  if (tiptapNode.type === 'text') {
    if (tiptapNode.text) chunks.push(tiptapNode.text);
    return;
  }

  if (tiptapNode.type === 'hardBreak') {
    chunks.push('\n');
    return;
  }

  if (tiptapNode.type === 'mention') {
    const label = tiptapNode.attrs?.label ?? tiptapNode.attrs?.id;
    if (typeof label === 'string') chunks.push(label);
    return;
  }

  const chunkCountBeforeChildren = chunks.length;
  if (Array.isArray(tiptapNode.content)) {
    for (const child of tiptapNode.content) {
      extractNodeText(child, chunks);
    }
  }

  if (
    tiptapNode.type &&
    BLOCK_NODE_TYPES.has(tiptapNode.type) &&
    chunks.length > chunkCountBeforeChildren
  ) {
    chunks.push('\n');
  }
}

export function extractTipTapText(content: unknown): string {
  const chunks: string[] = [];
  extractNodeText(content, chunks);
  return normalizeSearchText(chunks.join(' '));
}

function extractPropertiesText(properties: unknown): string {
  if (!properties || typeof properties !== 'object') return '';

  const chunks: string[] = [];
  const visit = (value: unknown, key?: string): void => {
    if (value == null) return;
    if (typeof value === 'string') {
      if (!key || !key.endsWith('_id')) chunks.push(value);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      chunks.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };

  visit(properties);
  return normalizeSearchText(chunks.join(' '));
}

async function upsertSearchIndexRow(doc: SearchIndexDocument, db: Queryable): Promise<void> {
  const title = doc.title ?? '';
  const propertiesText = extractPropertiesText(doc.properties);
  const contentText = extractTipTapText(doc.content);

  await db.query(
    `INSERT INTO document_search_index (
       document_id,
       workspace_id,
       document_type,
       title,
       properties_text,
       content_text,
       search_vector,
       source_updated_at,
       indexed_at
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       setweight(to_tsvector('english', $4), 'A') ||
         setweight(to_tsvector('english', $5), 'B') ||
         setweight(to_tsvector('english', $6), 'C'),
       $7,
       NOW()
     )
     ON CONFLICT (document_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       document_type = EXCLUDED.document_type,
       title = EXCLUDED.title,
       properties_text = EXCLUDED.properties_text,
       content_text = EXCLUDED.content_text,
       search_vector = EXCLUDED.search_vector,
       source_updated_at = EXCLUDED.source_updated_at,
       indexed_at = NOW()`,
    [doc.id, doc.workspace_id, doc.document_type, title, propertiesText, contentText, doc.updated_at]
  );
}

export async function upsertDocumentSearchIndex(
  documentId: string,
  db: Queryable = pool
): Promise<boolean> {
  const result = await db.query<SearchIndexDocument>(
    `SELECT id, workspace_id, document_type::text AS document_type, title, properties, content, updated_at
     FROM documents
     WHERE id = $1
       AND archived_at IS NULL
       AND deleted_at IS NULL`,
    [documentId]
  );

  if (result.rows.length === 0) {
    await db.query('DELETE FROM document_search_index WHERE document_id = $1', [documentId]);
    return false;
  }

  const doc = result.rows[0];
  if (!doc) return false;

  await upsertSearchIndexRow(doc, db);
  return true;
}

export async function rebuildDocumentSearchIndex(
  workspaceId: string,
  db: Queryable = pool
): Promise<number> {
  await db.query(
    `DELETE FROM document_search_index i
     WHERE i.workspace_id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM documents d
         WHERE d.id = i.document_id
           AND d.archived_at IS NULL
           AND d.deleted_at IS NULL
       )`,
    [workspaceId]
  );

  const result = await db.query<SearchIndexDocument>(
    `SELECT d.id, d.workspace_id, d.document_type::text AS document_type, d.title, d.properties, d.content, d.updated_at
     FROM documents d
     LEFT JOIN document_search_index i ON i.document_id = d.id
     WHERE d.workspace_id = $1
       AND d.archived_at IS NULL
       AND d.deleted_at IS NULL
       AND (
         i.document_id IS NULL
         OR i.source_updated_at < d.updated_at
         OR i.title IS DISTINCT FROM d.title
         OR i.document_type IS DISTINCT FROM d.document_type
         OR i.properties_text IS NULL
       )`,
    [workspaceId]
  );

  for (const doc of result.rows) {
    await upsertSearchIndexRow(doc, db);
  }

  return result.rows.length;
}
