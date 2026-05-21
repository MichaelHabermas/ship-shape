-- Migration 038: Derived full-content document search index
--
-- Stores extracted TipTap text and a weighted tsvector for content search.
-- The source documents table remains canonical; this table is rebuilt/upserted
-- by the API search indexing utility.

CREATE TABLE IF NOT EXISTS document_search_index (
  document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_type document_type NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  properties_text TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  search_vector TSVECTOR NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_search_index
  ADD COLUMN IF NOT EXISTS properties_text TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS document_search_index_workspace_type_idx
  ON document_search_index (workspace_id, document_type);

CREATE INDEX IF NOT EXISTS document_search_index_source_updated_at_idx
  ON document_search_index (source_updated_at);

CREATE INDEX IF NOT EXISTS document_search_index_vector_idx
  ON document_search_index USING GIN (search_vector);
