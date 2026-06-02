-- Ship database schema for the unified document model.
-- Includes multi-workspace core tables, collaboration state, and FleetGraph support tables.

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

-- OAuth platform app and token state for public /api/v1 access
CREATE TABLE IF NOT EXISTS oauth_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL CHECK (cardinality(redirect_uris) > 0),
  requested_scopes TEXT[] NOT NULL CHECK (cardinality(requested_scopes) > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_apps_id_workspace_unique UNIQUE (id, workspace_id)
);

CREATE TABLE IF NOT EXISTS oauth_app_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'grace', 'revoked')),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_app_secrets_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT oauth_app_secrets_status_timestamps_check
    CHECK (
      (status = 'active' AND expires_at IS NULL AND revoked_at IS NULL)
      OR (status = 'grace' AND expires_at IS NOT NULL AND revoked_at IS NULL)
      OR (status = 'revoked' AND revoked_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  granted_scopes TEXT[] NOT NULL CHECK (cardinality(granted_scopes) > 0),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_grants_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT oauth_grants_app_user_workspace_unique UNIQUE (app_id, user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL CHECK (cardinality(requested_scopes) > 0),
  state TEXT,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_authorization_requests_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_request_id UUID REFERENCES oauth_authorization_requests(id) ON DELETE SET NULL,
  grant_id UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  app_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL,
  granted_scopes TEXT[] NOT NULL CHECK (cardinality(granted_scopes) > 0),
  state TEXT,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_authorization_codes_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_refresh_token_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  app_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ,
  invalidated_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_refresh_token_families_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES oauth_refresh_token_families(id) ON DELETE CASCADE,
  app_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  replaced_by_token_id UUID REFERENCES oauth_refresh_tokens(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_refresh_tokens_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_device_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code_hash TEXT NOT NULL UNIQUE,
  requested_scopes TEXT[] NOT NULL CHECK (cardinality(requested_scopes) > 0),
  interval_seconds INTEGER NOT NULL DEFAULT 5 CHECK (interval_seconds > 0),
  slow_down_count INTEGER NOT NULL DEFAULT 0 CHECK (slow_down_count >= 0),
  last_polled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  authorized_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  grant_id UUID REFERENCES oauth_grants(id) ON DELETE SET NULL,
  authorized_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_device_authorizations_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  grant_id UUID REFERENCES oauth_grants(id) ON DELETE SET NULL,
  refresh_token_family_id UUID REFERENCES oauth_refresh_token_families(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  granted_scopes TEXT[] NOT NULL CHECK (cardinality(granted_scopes) > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_access_tokens_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public_api_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL CHECK (char_length(request_id) <= 128),
  app_id UUID REFERENCES oauth_apps(id) ON DELETE SET NULL,
  client_id TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  scope_used TEXT,
  status INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  signing_secret_hash TEXT NOT NULL,
  signing_secret_ciphertext TEXT NOT NULL,
  signing_secret_iv TEXT NOT NULL,
  signing_secret_tag TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_subscriptions_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'succeeded', 'retrying', 'failed', 'dlq')),
  idempotency_key TEXT NOT NULL,
  response_status INTEGER,
  response_excerpt TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  next_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  replay_of_delivery_id UUID REFERENCES webhook_deliveries(id) ON DELETE SET NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_deliveries_subscription_event_attempt_unique
    UNIQUE (subscription_id, event_id, attempt_number)
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
  scopes TEXT[] NOT NULL DEFAULT ARRAY['legacy:full']::text[],
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

-- FleetGraph-owned diagnosis state. Ship documents, issues, weeks, ownership,
-- priority, and status remain canonical.
CREATE TABLE IF NOT EXISTS fleetgraph_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_issue_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_sprint_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'needs_confirmation', 'dismissed', 'resolved', 'suppressed', 'error')),
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'urgent')),
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.000
    CHECK (confidence >= 0 AND confidence <= 1),

  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_action JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_content JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_recipient JSONB NOT NULL DEFAULT '{}'::jsonb,
  human_gate JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fleetgraph_findings_status_timestamps_check CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL AND dismissed_at IS NULL AND dismissed_by IS NULL)
    OR (status = 'dismissed' AND dismissed_at IS NOT NULL AND dismissed_by IS NOT NULL AND resolved_at IS NULL)
    OR (status IN ('open', 'needs_confirmation', 'error') AND resolved_at IS NULL AND dismissed_at IS NULL AND dismissed_by IS NULL)
    OR status = 'suppressed'
  )
);

CREATE TABLE IF NOT EXISTS fleetgraph_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  finding_id UUID REFERENCES fleetgraph_findings(id) ON DELETE SET NULL,
  source_issue_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  source_sprint_id UUID REFERENCES documents(id) ON DELETE SET NULL,

  mode TEXT NOT NULL CHECK (mode IN ('proactive', 'on_demand')),
  trigger_reason TEXT NOT NULL,
  decision TEXT NOT NULL
    CHECK (decision IN ('quiet_exit', 'create_finding', 'update_finding', 'explain', 'refine_draft', 'summarize_changes', 'needs_confirmation', 'dismiss', 'resolve', 'error')),
  dedupe_key TEXT,

  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fleetgraph_worker_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'completed', 'failed', 'skipped_lock')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deadline_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  workspace_count INTEGER NOT NULL DEFAULT 0 CHECK (workspace_count >= 0),
  detector_decision_count INTEGER NOT NULL DEFAULT 0 CHECK (detector_decision_count >= 0),
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  model_call_count INTEGER NOT NULL DEFAULT 0 CHECK (model_call_count >= 0),
  error_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fleetgraph_worker_ticks_completed_check CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status IN ('completed', 'failed', 'skipped_lock') AND completed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS fleetgraph_attention_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_issue_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_sprint_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  source_sprint_key UUID GENERATED ALWAYS AS (COALESCE(source_sprint_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'issue_changed',
    'issue_iteration_added',
    'issue_week_changed',
    'issue_visibility_changed',
    'repair_scan'
  )),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'processing',
    'completed',
    'failed',
    'skipped'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fleetgraph_attention_events_processing_lock_check CHECK (
    (status = 'processing' AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
    OR (status <> 'processing')
  ),
  CONSTRAINT fleetgraph_attention_events_processed_check CHECK (
    (status IN ('completed', 'failed', 'skipped') AND processed_at IS NOT NULL)
    OR (status IN ('pending', 'processing'))
  )
);

CREATE TABLE IF NOT EXISTS fleetgraph_notification_reads (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  finding_id UUID NOT NULL REFERENCES fleetgraph_findings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (finding_id, user_id)
);

CREATE TABLE IF NOT EXISTS fleetgraph_reviewer_chat_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_issue_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  finding_id UUID REFERENCES fleetgraph_findings(id) ON DELETE SET NULL,
  chat_run_id UUID REFERENCES fleetgraph_runs(id) ON DELETE SET NULL,
  before_state JSONB NOT NULL DEFAULT '{}',
  after_state JSONB NOT NULL DEFAULT '{}',
  changed_fields TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION validate_fleetgraph_reviewer_chat_proof_reference()
RETURNS TRIGGER AS $$
DECLARE
  issue_workspace UUID;
  issue_type document_type;
  issue_deleted_at TIMESTAMPTZ;
  finding_workspace UUID;
  finding_source_issue_id UUID;
  run_workspace UUID;
  run_source_issue_id UUID;
  run_finding_id UUID;
  run_mode TEXT;
  run_trigger_reason TEXT;
BEGIN
  SELECT workspace_id, document_type, deleted_at
  INTO issue_workspace, issue_type, issue_deleted_at
  FROM documents
  WHERE id = NEW.source_issue_id;

  IF issue_workspace IS NULL THEN
    RAISE EXCEPTION 'FleetGraph reviewer proof source issue % does not exist', NEW.source_issue_id;
  END IF;

  IF issue_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph reviewer proof source issue % is deleted', NEW.source_issue_id;
  END IF;

  IF issue_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'FleetGraph reviewer proof source issue must be in the proof workspace';
  END IF;

  IF issue_type <> 'issue' THEN
    RAISE EXCEPTION 'FleetGraph reviewer proof source issue must be an issue document';
  END IF;

  IF NEW.finding_id IS NOT NULL THEN
    SELECT workspace_id, source_issue_id
    INTO finding_workspace, finding_source_issue_id
    FROM fleetgraph_findings
    WHERE id = NEW.finding_id;

    IF finding_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof finding % does not exist', NEW.finding_id;
    END IF;

    IF finding_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof finding must be in the proof workspace';
    END IF;

    IF finding_source_issue_id <> NEW.source_issue_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof finding must match the proof source issue';
    END IF;
  END IF;

  IF NEW.chat_run_id IS NOT NULL THEN
    SELECT workspace_id, source_issue_id, finding_id, mode, trigger_reason
    INTO run_workspace, run_source_issue_id, run_finding_id, run_mode, run_trigger_reason
    FROM fleetgraph_runs
    WHERE id = NEW.chat_run_id;

    IF run_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run % does not exist', NEW.chat_run_id;
    END IF;

    IF run_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run must be in the proof workspace';
    END IF;

    IF run_source_issue_id <> NEW.source_issue_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run must match the proof source issue';
    END IF;

    IF NEW.finding_id IS NOT NULL AND run_finding_id <> NEW.finding_id THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run must match the proof finding';
    END IF;

    IF run_mode <> 'on_demand' OR run_trigger_reason <> 'reviewer-source-mutation-proof' THEN
      RAISE EXCEPTION 'FleetGraph reviewer proof chat run must be the reviewer source mutation proof run';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_fleetgraph_attention_event_reference()
RETURNS TRIGGER AS $$
DECLARE
  issue_workspace UUID;
  issue_type TEXT;
  issue_deleted_at TIMESTAMPTZ;
  issue_archived_at TIMESTAMPTZ;
  sprint_workspace UUID;
  sprint_type TEXT;
  sprint_deleted_at TIMESTAMPTZ;
  sprint_archived_at TIMESTAMPTZ;
BEGIN
  SELECT workspace_id, document_type, deleted_at, archived_at
    INTO issue_workspace, issue_type, issue_deleted_at, issue_archived_at
    FROM documents
   WHERE id = NEW.source_issue_id;

  IF issue_workspace IS NULL THEN
    IF TG_OP = 'UPDATE'
      AND OLD.source_issue_id = NEW.source_issue_id
      AND OLD.source_sprint_id IS NOT NULL
      AND NEW.source_sprint_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FleetGraph attention event source issue must exist';
  END IF;

  IF issue_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'FleetGraph attention event source issue must be in the event workspace';
  END IF;

  IF issue_type <> 'issue' THEN
    RAISE EXCEPTION 'FleetGraph attention event source issue must be an issue document';
  END IF;

  IF issue_deleted_at IS NOT NULL OR issue_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph attention event source issue must be active';
  END IF;

  IF NEW.source_sprint_id IS NOT NULL THEN
    SELECT workspace_id, document_type, deleted_at, archived_at
      INTO sprint_workspace, sprint_type, sprint_deleted_at, sprint_archived_at
      FROM documents
     WHERE id = NEW.source_sprint_id;

    IF sprint_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must exist';
    END IF;

    IF sprint_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must be in the event workspace';
    END IF;

    IF sprint_type <> 'sprint' THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must be a sprint document';
    END IF;

    IF sprint_deleted_at IS NOT NULL OR sprint_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'FleetGraph attention event source sprint must be active';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_attention_event_reference_trigger ON fleetgraph_attention_events;
CREATE TRIGGER validate_fleetgraph_attention_event_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, source_issue_id, source_sprint_id ON fleetgraph_attention_events
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_attention_event_reference();

CREATE OR REPLACE FUNCTION validate_fleetgraph_notification_read_reference()
RETURNS TRIGGER AS $$
DECLARE
  finding_workspace UUID;
BEGIN
  SELECT workspace_id
    INTO finding_workspace
    FROM fleetgraph_findings
   WHERE id = NEW.finding_id;

  IF finding_workspace IS NULL THEN
    RAISE EXCEPTION 'FleetGraph notification read finding must exist';
  END IF;

  IF finding_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'FleetGraph notification read workspace must match finding workspace';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_notification_read_reference_trigger ON fleetgraph_notification_reads;
CREATE TRIGGER validate_fleetgraph_notification_read_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, finding_id ON fleetgraph_notification_reads
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_notification_read_reference();

CREATE OR REPLACE FUNCTION validate_fleetgraph_finding_reference()
RETURNS TRIGGER AS $$
DECLARE
  issue_workspace UUID;
  issue_type document_type;
  issue_deleted_at TIMESTAMPTZ;
  sprint_workspace UUID;
  sprint_type document_type;
  sprint_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT workspace_id, document_type, deleted_at
  INTO issue_workspace, issue_type, issue_deleted_at
  FROM documents
  WHERE id = NEW.source_issue_id;

  SELECT workspace_id, document_type, deleted_at
  INTO sprint_workspace, sprint_type, sprint_deleted_at
  FROM documents
  WHERE id = NEW.source_sprint_id;

  IF issue_workspace IS NULL THEN
    RAISE EXCEPTION 'FleetGraph source issue % does not exist', NEW.source_issue_id;
  END IF;

  IF sprint_workspace IS NULL THEN
    RAISE EXCEPTION 'FleetGraph source sprint % does not exist', NEW.source_sprint_id;
  END IF;

  IF issue_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph source issue % is deleted', NEW.source_issue_id;
  END IF;

  IF sprint_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FleetGraph source sprint % is deleted', NEW.source_sprint_id;
  END IF;

  IF issue_workspace <> NEW.workspace_id OR sprint_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'FleetGraph source documents must be in the finding workspace';
  END IF;

  IF issue_type <> 'issue' THEN
    RAISE EXCEPTION 'FleetGraph source issue must be an issue document';
  END IF;

  IF sprint_type <> 'sprint' THEN
    RAISE EXCEPTION 'FleetGraph source sprint must be a sprint document';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_finding_reference_trigger ON fleetgraph_findings;
CREATE TRIGGER validate_fleetgraph_finding_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, source_issue_id, source_sprint_id ON fleetgraph_findings
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_finding_reference();

CREATE OR REPLACE FUNCTION validate_fleetgraph_run_reference()
RETURNS TRIGGER AS $$
DECLARE
  finding_workspace UUID;
  issue_workspace UUID;
  issue_type document_type;
  issue_deleted_at TIMESTAMPTZ;
  sprint_workspace UUID;
  sprint_type document_type;
  sprint_deleted_at TIMESTAMPTZ;
BEGIN
  IF NEW.finding_id IS NOT NULL THEN
    SELECT workspace_id
    INTO finding_workspace
    FROM fleetgraph_findings
    WHERE id = NEW.finding_id;

    IF finding_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph finding % does not exist', NEW.finding_id;
    END IF;

    IF finding_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph run finding must be in the run workspace';
    END IF;
  END IF;

  IF NEW.source_issue_id IS NOT NULL THEN
    SELECT workspace_id, document_type, deleted_at
    INTO issue_workspace, issue_type, issue_deleted_at
    FROM documents
    WHERE id = NEW.source_issue_id;

    IF issue_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph run source issue % does not exist', NEW.source_issue_id;
    END IF;

    IF issue_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'FleetGraph run source issue % is deleted', NEW.source_issue_id;
    END IF;

    IF issue_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph run source issue must be in the run workspace';
    END IF;

    IF issue_type <> 'issue' THEN
      RAISE EXCEPTION 'FleetGraph run source issue must be an issue document';
    END IF;
  END IF;

  IF NEW.source_sprint_id IS NOT NULL THEN
    SELECT workspace_id, document_type, deleted_at
    INTO sprint_workspace, sprint_type, sprint_deleted_at
    FROM documents
    WHERE id = NEW.source_sprint_id;

    IF sprint_workspace IS NULL THEN
      RAISE EXCEPTION 'FleetGraph run source sprint % does not exist', NEW.source_sprint_id;
    END IF;

    IF sprint_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'FleetGraph run source sprint % is deleted', NEW.source_sprint_id;
    END IF;

    IF sprint_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'FleetGraph run source sprint must be in the run workspace';
    END IF;

    IF sprint_type <> 'sprint' THEN
      RAISE EXCEPTION 'FleetGraph run source sprint must be a sprint document';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_fleetgraph_run_reference_trigger ON fleetgraph_runs;
CREATE TRIGGER validate_fleetgraph_run_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, finding_id, source_issue_id, source_sprint_id ON fleetgraph_runs
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_run_reference();

CREATE OR REPLACE FUNCTION suppress_invalid_fleetgraph_findings_on_document_mutation()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE fleetgraph_findings
     SET status = 'suppressed',
         updated_at = NOW(),
         run_metadata = run_metadata || jsonb_build_object(
           'suppressed_reason', 'source_issue_invalidated',
           'suppressed_at', NOW()
         )
   WHERE source_issue_id = NEW.id
     AND status IN ('open', 'needs_confirmation', 'error')
     AND (
       NEW.workspace_id <> workspace_id
       OR NEW.document_type <> 'issue'
       OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
     );

  UPDATE fleetgraph_findings
     SET status = 'suppressed',
         updated_at = NOW(),
         run_metadata = run_metadata || jsonb_build_object(
           'suppressed_reason', 'source_sprint_invalidated',
           'suppressed_at', NOW()
         )
   WHERE source_sprint_id = NEW.id
     AND status IN ('open', 'needs_confirmation', 'error')
     AND (
       NEW.workspace_id <> workspace_id
       OR NEW.document_type <> 'sprint'
       OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
     );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_fleetgraph_source_document_mutation_trigger ON documents;
DROP TRIGGER IF EXISTS suppress_invalid_fleetgraph_findings_on_document_mutation_trigger ON documents;
CREATE TRIGGER suppress_invalid_fleetgraph_findings_on_document_mutation_trigger
AFTER UPDATE OF workspace_id, document_type, deleted_at ON documents
FOR EACH ROW
EXECUTE FUNCTION suppress_invalid_fleetgraph_findings_on_document_mutation();

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Session indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace_id ON sessions(workspace_id);

-- OAuth state indexes
CREATE INDEX IF NOT EXISTS idx_oauth_state_expires_at ON oauth_state(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_apps_workspace_owner
  ON oauth_apps(workspace_id, owner_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_app_secrets_one_active
  ON oauth_app_secrets(app_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_oauth_app_secrets_app_created
  ON oauth_app_secrets(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oauth_app_secrets_grace_expiry
  ON oauth_app_secrets(expires_at)
  WHERE status = 'grace';
CREATE INDEX IF NOT EXISTS idx_oauth_grants_app_user
  ON oauth_grants(app_id, user_id, workspace_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_lookup
  ON oauth_authorization_requests(id, user_id, workspace_id)
  WHERE approved_at IS NULL AND denied_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_expires
  ON oauth_authorization_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_lookup
  ON oauth_authorization_codes(code_hash)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_expires
  ON oauth_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_token_families_active
  ON oauth_refresh_token_families(app_id, user_id, workspace_id, expires_at)
  WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_lookup
  ON oauth_refresh_tokens(token_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family
  ON oauth_refresh_tokens(family_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oauth_device_authorizations_user_code
  ON oauth_device_authorizations(user_code_hash)
  WHERE authorized_at IS NULL AND denied_at IS NULL AND consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_device_authorizations_device_code
  ON oauth_device_authorizations(device_code_hash)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_device_authorizations_expires
  ON oauth_device_authorizations(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_lookup
  ON oauth_access_tokens(token_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_app_user
  ON oauth_access_tokens(app_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_grant
  ON oauth_access_tokens(grant_id)
  WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_refresh_family
  ON oauth_access_tokens(refresh_token_family_id)
  WHERE refresh_token_family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_public_api_audit_logs_app_created
  ON public_api_audit_logs(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_audit_logs_request_id
  ON public_api_audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_public_api_audit_logs_workspace_created
  ON public_api_audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_api_audit_logs_created
  ON public_api_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_app_created
  ON webhook_subscriptions(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_match
  ON webhook_subscriptions(workspace_id, event_type)
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_webhook_events_workspace_created
  ON webhook_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription_created
  ON webhook_deliveries(subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries(next_attempt_at)
  WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event
  ON webhook_deliveries(event_id, attempt_number);

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

-- FleetGraph indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetgraph_findings_open_dedupe
  ON fleetgraph_findings(dedupe_key)
  WHERE status IN ('open', 'needs_confirmation', 'error');
CREATE INDEX IF NOT EXISTS idx_fleetgraph_findings_workspace_status
  ON fleetgraph_findings(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_findings_source_issue
  ON fleetgraph_findings(source_issue_id, status);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_findings_source_sprint
  ON fleetgraph_findings(source_sprint_id, status);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_runs_workspace_created
  ON fleetgraph_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_runs_finding
  ON fleetgraph_runs(finding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_runs_decision
  ON fleetgraph_runs(decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_worker_ticks_started
  ON fleetgraph_worker_ticks(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_worker_ticks_status
  ON fleetgraph_worker_ticks(status, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleetgraph_attention_events_active_dedupe
  ON fleetgraph_attention_events(
    workspace_id,
    source_issue_id,
    source_sprint_key,
    event_type
  )
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_fleetgraph_attention_events_claim
  ON fleetgraph_attention_events(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_attention_events_source
  ON fleetgraph_attention_events(workspace_id, source_issue_id, source_sprint_id, status);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_notification_reads_workspace_user
  ON fleetgraph_notification_reads(workspace_id, user_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_reviewer_chat_proofs_workspace_created
  ON fleetgraph_reviewer_chat_proofs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_reviewer_chat_proofs_source
  ON fleetgraph_reviewer_chat_proofs(workspace_id, source_issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleetgraph_reviewer_chat_proofs_finding
  ON fleetgraph_reviewer_chat_proofs(workspace_id, finding_id, created_at DESC)
  WHERE finding_id IS NOT NULL;
DROP TRIGGER IF EXISTS validate_fleetgraph_reviewer_chat_proof_reference_trigger ON fleetgraph_reviewer_chat_proofs;
CREATE TRIGGER validate_fleetgraph_reviewer_chat_proof_reference_trigger
BEFORE INSERT OR UPDATE OF workspace_id, source_issue_id, finding_id, chat_run_id ON fleetgraph_reviewer_chat_proofs
FOR EACH ROW
EXECUTE FUNCTION validate_fleetgraph_reviewer_chat_proof_reference();

-- Drop the legacy separate tables if they exist (greenfield cleanup)
DROP TABLE IF EXISTS sprints CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
