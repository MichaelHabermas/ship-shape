-- Ship Database Schema
-- Everything is a Document - Unified Model
-- Multi-Workspace Architecture

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sprint_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Users and auth (global identity - users can belong to multiple workspaces)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,  -- NULL if using PIV-only auth
  name TEXT NOT NULL,
  is_super_admin BOOLEAN DEFAULT FALSE,
  last_workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  x509_subject_dn TEXT,           -- PIV certificate X.509 Subject DN
  piv_first_login_at TIMESTAMPTZ, -- When user first logged in via PIV
  last_auth_provider VARCHAR(50), -- 'fpki_validator', 'caia', null (legacy)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Case-insensitive email uniqueness (prevents duplicate users with different casing)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));

-- Workspace memberships (users can be in multiple workspaces with different roles)
-- AUTHORIZATION ONLY: This table controls access. Person documents (content layer) are separate.
-- Person docs link to users via properties.user_id, NOT via this table.
CREATE TABLE IF NOT EXISTS workspace_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- Workspace invites (email invite flow)
CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT UNIQUE,  -- NULL for PIV invites (certificate proves identity)
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x509_subject_dn TEXT,  -- X.509 Subject DN for PIV invites
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit logs (compliance-grade logging)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,  -- NULL for global actions
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL for failed login attempts
  impersonating_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- If super-admin is impersonating
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sessions with 15-minute inactivity timeout and 12-hour absolute timeout
-- Session ID is TEXT (hex string from crypto.randomBytes) not UUID for enhanced security
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  -- Session binding data for audit and security
  user_agent TEXT,
  ip_address TEXT
);

-- OAuth state (survives server restarts during auth flow)
CREATE TABLE IF NOT EXISTS oauth_state (
  state_id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Document types enum
DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('wiki', 'issue', 'program', 'project', 'sprint', 'person', 'weekly_plan', 'weekly_retro', 'standup', 'weekly_review');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Core document table (unified model - EVERYTHING IS A DOCUMENT)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  document_type document_type NOT NULL DEFAULT 'wiki',
  title TEXT NOT NULL DEFAULT 'Untitled',

  -- TipTap JSON content stored as JSONB (shared by ALL document types)
  content JSONB DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',

  -- Yjs binary state for collaboration (shared by ALL document types)
  yjs_state BYTEA,

  -- Hierarchy (cascade delete: deleting parent deletes all children)
  parent_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 0,

  -- Associations: program, project, and sprint relationships are stored in document_associations table
  -- Legacy columns (project_id, sprint_id, program_id) were removed by migrations 027 and 029.
  -- Use document_associations table for all relationship queries.

  -- Type-specific properties stored as JSONB
  -- Issue properties: state, priority, assignee_id, source, rejection_reason
  -- Program/Project properties: color
  -- Sprint properties: start_date, end_date, sprint_status, plan
  -- Person properties: user_id (links to users.id), email, capacity_hours, skills
  properties JSONB DEFAULT '{}',

  -- Keep these as columns for indexing/relationships/sequences
  ticket_number INTEGER,  -- Auto-increment per workspace, needed for display_id
  archived_at TIMESTAMPTZ,  -- For filtering archived items
  deleted_at TIMESTAMPTZ,   -- For trash/soft delete (30 day retention)

  -- Status timestamps (for issues)
  started_at TIMESTAMPTZ,    -- When issue status first changed to in_progress
  completed_at TIMESTAMPTZ,  -- When issue status first changed to done
  cancelled_at TIMESTAMPTZ,  -- When issue status changed to cancelled
  reopened_at TIMESTAMPTZ,   -- When issue was reopened after being done/cancelled

  -- Document conversion tracking
  converted_to_id UUID REFERENCES documents(id) ON DELETE SET NULL,   -- Points to new doc (on archived original)
  converted_from_id UUID REFERENCES documents(id) ON DELETE SET NULL, -- Points to original doc (on new doc)
  converted_at TIMESTAMPTZ,
  converted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  original_type VARCHAR(50),    -- Original document_type when first created
  conversion_count INTEGER DEFAULT 0,  -- Number of times converted

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Document visibility (private = creator only, workspace = all members)
  visibility TEXT NOT NULL DEFAULT 'workspace' CHECK (visibility IN ('private', 'workspace')),

  -- Prevent self-referencing parent
  CONSTRAINT documents_no_self_parent CHECK (id != parent_id)
);

-- Function and trigger to prevent circular parent references
CREATE OR REPLACE FUNCTION prevent_circular_parent()
RETURNS TRIGGER AS $$
DECLARE
  current_parent UUID;
  depth INT := 0;
  max_depth INT := 100;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.parent_id IS NOT DISTINCT FROM NEW.parent_id THEN
    RETURN NEW;
  END IF;
  current_parent := NEW.parent_id;
  WHILE current_parent IS NOT NULL AND depth < max_depth LOOP
    IF current_parent = NEW.id THEN
      RAISE EXCEPTION 'Circular reference detected: document % cannot be a descendant of itself', NEW.id;
    END IF;
    SELECT parent_id INTO current_parent FROM documents WHERE id = current_parent;
    depth := depth + 1;
  END LOOP;
  IF depth >= max_depth THEN
    RAISE EXCEPTION 'Maximum nesting depth (%) exceeded while checking for circular reference', max_depth;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_circular_parent_trigger ON documents;
CREATE TRIGGER prevent_circular_parent_trigger
BEFORE INSERT OR UPDATE OF parent_id ON documents
FOR EACH ROW
EXECUTE FUNCTION prevent_circular_parent();

CREATE OR REPLACE FUNCTION validate_document_parent_reference()
RETURNS TRIGGER AS $$
DECLARE
  parent_workspace UUID;
  parent_deleted_at TIMESTAMPTZ;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT workspace_id, deleted_at
  INTO parent_workspace, parent_deleted_at
  FROM documents
  WHERE id = NEW.parent_id;

  IF parent_workspace IS NULL THEN
    RAISE EXCEPTION 'Parent document % does not exist', NEW.parent_id;
  END IF;

  IF parent_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Parent document % is in a different workspace', NEW.parent_id;
  END IF;

  IF parent_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Parent document % is deleted', NEW.parent_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_document_parent_reference_trigger ON documents;
CREATE TRIGGER validate_document_parent_reference_trigger
BEFORE INSERT OR UPDATE OF parent_id, workspace_id ON documents
FOR EACH ROW
EXECUTE FUNCTION validate_document_parent_reference();

-- Derived full-content search index (rebuildable from documents)
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

-- Relationship type enum for document associations
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'relationship_type') THEN
    CREATE TYPE relationship_type AS ENUM ('parent', 'project', 'sprint', 'program');
  END IF;
END
$$;

-- Document associations junction table (replaces direct relationship columns)
CREATE TABLE IF NOT EXISTS document_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  related_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  relationship_type relationship_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',

  -- Prevent duplicate associations of the same type
  CONSTRAINT unique_association UNIQUE (document_id, related_id, relationship_type),

  -- Prevent self-references
  CONSTRAINT no_self_reference CHECK (document_id != related_id)
);

CREATE OR REPLACE FUNCTION validate_document_association_reference()
RETURNS TRIGGER AS $$
DECLARE
  source_workspace UUID;
  source_deleted_at TIMESTAMPTZ;
  related_workspace UUID;
  related_deleted_at TIMESTAMPTZ;
  related_type document_type;
BEGIN
  SELECT workspace_id, deleted_at
  INTO source_workspace, source_deleted_at
  FROM documents
  WHERE id = NEW.document_id;

  SELECT workspace_id, deleted_at, document_type
  INTO related_workspace, related_deleted_at, related_type
  FROM documents
  WHERE id = NEW.related_id;

  IF source_workspace IS NULL THEN
    RAISE EXCEPTION 'Source document % does not exist', NEW.document_id;
  END IF;

  IF related_workspace IS NULL THEN
    RAISE EXCEPTION 'Related document % does not exist', NEW.related_id;
  END IF;

  IF source_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Source document % is deleted', NEW.document_id;
  END IF;

  IF related_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Related document % is deleted', NEW.related_id;
  END IF;

  IF source_workspace <> related_workspace THEN
    RAISE EXCEPTION 'Association documents must be in the same workspace';
  END IF;

  IF NEW.relationship_type = 'program' AND related_type <> 'program' THEN
    RAISE EXCEPTION 'Program association target must be a program document';
  END IF;

  IF NEW.relationship_type = 'project' AND related_type <> 'project' THEN
    RAISE EXCEPTION 'Project association target must be a project document';
  END IF;

  IF NEW.relationship_type = 'sprint' AND related_type <> 'sprint' THEN
    RAISE EXCEPTION 'Sprint association target must be a sprint document';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_document_association_reference_trigger ON document_associations;
CREATE TRIGGER validate_document_association_reference_trigger
BEFORE INSERT OR UPDATE OF document_id, related_id, relationship_type ON document_associations
FOR EACH ROW
EXECUTE FUNCTION validate_document_association_reference();

CREATE OR REPLACE FUNCTION guard_document_relationship_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    IF EXISTS (
      SELECT 1 FROM documents child WHERE child.parent_id = NEW.id
    ) OR NEW.parent_id IS NOT NULL OR EXISTS (
      SELECT 1
      FROM document_associations da
      WHERE da.document_id = NEW.id OR da.related_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Cannot move document % to another workspace while relationships exist', NEW.id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.document_type IS DISTINCT FROM NEW.document_type THEN
    IF EXISTS (
      SELECT 1
      FROM document_associations da
      WHERE da.related_id = NEW.id
        AND (
          (da.relationship_type = 'program' AND NEW.document_type <> 'program')
          OR (da.relationship_type = 'project' AND NEW.document_type <> 'project')
          OR (da.relationship_type = 'sprint' AND NEW.document_type <> 'sprint')
        )
    ) THEN
      RAISE EXCEPTION 'Cannot change document % type while typed associations depend on it', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_document_relationship_mutation_trigger ON documents;
CREATE TRIGGER guard_document_relationship_mutation_trigger
BEFORE UPDATE OF workspace_id, document_type ON documents
FOR EACH ROW
EXECUTE FUNCTION guard_document_relationship_mutation();

CREATE OR REPLACE FUNCTION cleanup_document_relationships_on_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM document_associations
    WHERE document_id = NEW.id OR related_id = NEW.id;

    UPDATE documents
    SET parent_id = NULL,
        updated_at = NOW()
    WHERE parent_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cleanup_document_relationships_on_soft_delete_trigger ON documents;
CREATE TRIGGER cleanup_document_relationships_on_soft_delete_trigger
AFTER UPDATE OF deleted_at ON documents
FOR EACH ROW
EXECUTE FUNCTION cleanup_document_relationships_on_soft_delete();

-- Document history (audit trail for all document field changes)
CREATE TABLE IF NOT EXISTS document_history (
  id SERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES users(id),
  automated_by TEXT,  -- Identifies automated change source (e.g., "claude")
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Document snapshots (preserves state before type conversions for undo)
CREATE TABLE IF NOT EXISTS document_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  -- Snapshot of document state at time of conversion
  document_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  properties JSONB,
  ticket_number INTEGER,  -- Preserved for issues

  -- Metadata
  snapshot_reason VARCHAR(50) NOT NULL DEFAULT 'conversion',  -- 'conversion', 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- API tokens for CLI/external tool authentication
CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,         -- User-provided name (e.g., "Claude Code")
  token_hash TEXT NOT NULL,   -- SHA-256 hash (never store plain token)
  token_prefix TEXT NOT NULL, -- First 8 chars for identification
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,     -- NULL = never expires
  revoked_at TIMESTAMPTZ,     -- NULL = active, timestamp = revoked
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, workspace_id, name)
);

-- Sprint iterations (tracking work progress per sprint)
CREATE TABLE IF NOT EXISTS sprint_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  story_id TEXT,
  story_title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'in_progress')),
  what_attempted TEXT,
  blockers_encountered TEXT,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Issue iterations (tracking work progress per issue)
CREATE TABLE IF NOT EXISTS issue_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'in_progress')),
  what_attempted TEXT,
  blockers_encountered TEXT,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- File uploads (images, attachments)
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  s3_key TEXT NOT NULL,        -- S3 object key (or local path for dev)
  cdn_url TEXT,                -- CloudFront URL after processing
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document links (for backlinks feature)
CREATE TABLE IF NOT EXISTS document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id)
);

-- Comments (inline document comments with threading)
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL,  -- Thread identifier (matches TipTap mark commentId)
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,  -- NULL for root, set for replies
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,  -- NULL when unresolved
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Session indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);

-- OAuth state indexes
CREATE INDEX IF NOT EXISTS idx_oauth_state_expires_at ON oauth_state(expires_at);

-- User indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_workspace_id ON users(last_workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_x509_subject_dn ON users(x509_subject_dn) WHERE x509_subject_dn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_last_auth_provider ON users(last_auth_provider) WHERE last_auth_provider IS NOT NULL;

-- Document indexes
CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_document_type ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_properties ON documents USING GIN (properties);
CREATE INDEX IF NOT EXISTS idx_documents_person_user_id ON documents ((properties->>'user_id')) WHERE document_type = 'person';

-- Document visibility indexes
CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents(visibility);
CREATE INDEX IF NOT EXISTS idx_documents_visibility_created_by ON documents(visibility, created_by);

-- Document archive/delete indexes
CREATE INDEX IF NOT EXISTS idx_documents_archived_at ON documents(archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(workspace_id, document_type) WHERE archived_at IS NULL AND deleted_at IS NULL;

-- Document conversion indexes
CREATE INDEX IF NOT EXISTS idx_documents_converted_to ON documents(converted_to_id) WHERE converted_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_converted_from ON documents(converted_from_id) WHERE converted_from_id IS NOT NULL;

-- Document search index indexes
CREATE INDEX IF NOT EXISTS document_search_index_workspace_type_idx
  ON document_search_index (workspace_id, document_type);
CREATE INDEX IF NOT EXISTS document_search_index_source_updated_at_idx
  ON document_search_index (source_updated_at);
CREATE INDEX IF NOT EXISTS document_search_index_vector_idx
  ON document_search_index USING GIN (search_vector);

-- Document associations indexes
CREATE INDEX IF NOT EXISTS idx_document_associations_document_id ON document_associations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_associations_related_id ON document_associations(related_id);
CREATE INDEX IF NOT EXISTS idx_document_associations_type ON document_associations(relationship_type);
CREATE INDEX IF NOT EXISTS idx_document_associations_related_type ON document_associations(related_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_document_associations_document_type ON document_associations(document_id, relationship_type);

-- Document history indexes
CREATE INDEX IF NOT EXISTS idx_document_history_document_created ON document_history(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_history_changed_by ON document_history(changed_by, created_at DESC);

-- Document snapshots indexes
CREATE INDEX IF NOT EXISTS idx_document_snapshots_document_id ON document_snapshots(document_id);
CREATE INDEX IF NOT EXISTS idx_document_snapshots_created_at ON document_snapshots(document_id, created_at DESC);

-- Workspace membership indexes
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_id ON workspace_memberships(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_id ON workspace_memberships(user_id);

-- Workspace invite indexes
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(email);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_expires_at ON workspace_invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_x509_subject_dn ON workspace_invites(x509_subject_dn) WHERE x509_subject_dn IS NOT NULL AND used_at IS NULL;

-- Audit log indexes (compliance queries)
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created ON audit_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- API token indexes
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_workspace_id ON api_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token_prefix ON api_tokens(token_prefix);

-- Sprint iterations indexes
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_sprint_id ON sprint_iterations(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_workspace_id ON sprint_iterations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_status ON sprint_iterations(status);
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_story_id ON sprint_iterations(story_id);
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_created_at ON sprint_iterations(created_at DESC);

-- Issue iterations indexes
CREATE INDEX IF NOT EXISTS idx_issue_iterations_issue_id ON issue_iterations(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_iterations_workspace_id ON issue_iterations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_issue_iterations_status ON issue_iterations(status);
CREATE INDEX IF NOT EXISTS idx_issue_iterations_created_at ON issue_iterations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_iterations_issue_workspace ON issue_iterations(issue_id, workspace_id);

-- File indexes
CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
CREATE INDEX IF NOT EXISTS idx_files_document_id ON files(document_id);

-- Document links indexes
CREATE INDEX IF NOT EXISTS idx_document_links_target ON document_links(target_id);
CREATE INDEX IF NOT EXISTS idx_document_links_source ON document_links(source_id);

-- Comments indexes
CREATE INDEX IF NOT EXISTS idx_comments_document_id ON comments(document_id);
CREATE INDEX IF NOT EXISTS idx_comments_comment_id ON comments(comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);

-- Drop the legacy separate tables if they exist (greenfield cleanup)
DROP TABLE IF EXISTS sprints CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
