-- Add comments table for inline document comments
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL,  -- Thread identifier (matches TipTap mark commentId)
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,  -- NULL for root comments, set for replies
  author_id UUID NOT NULL REFERENCES users(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  content TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,  -- NULL when unresolved
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_comments_document_id ON comments(document_id);
CREATE INDEX IF NOT EXISTS idx_comments_comment_id ON comments(comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
