-- OAuth platform foundation for PlugForge public API access.

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

ALTER TABLE oauth_apps DROP CONSTRAINT IF EXISTS oauth_apps_owner_user_id_fkey;
ALTER TABLE oauth_apps ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE oauth_apps
  ADD CONSTRAINT oauth_apps_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE oauth_apps DROP CONSTRAINT IF EXISTS oauth_apps_redirect_uris_check;
ALTER TABLE oauth_apps DROP CONSTRAINT IF EXISTS oauth_apps_redirect_uris_nonempty;
ALTER TABLE oauth_apps
  ADD CONSTRAINT oauth_apps_redirect_uris_nonempty CHECK (cardinality(redirect_uris) > 0);

ALTER TABLE oauth_apps DROP CONSTRAINT IF EXISTS oauth_apps_requested_scopes_check;
ALTER TABLE oauth_apps DROP CONSTRAINT IF EXISTS oauth_apps_requested_scopes_nonempty;
ALTER TABLE oauth_apps
  ADD CONSTRAINT oauth_apps_requested_scopes_nonempty CHECK (cardinality(requested_scopes) > 0);

ALTER TABLE oauth_apps DROP CONSTRAINT IF EXISTS oauth_apps_id_workspace_unique;
ALTER TABLE oauth_apps
  ADD CONSTRAINT oauth_apps_id_workspace_unique UNIQUE (id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_oauth_apps_workspace_owner
  ON oauth_apps(workspace_id, owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  granted_scopes TEXT[] NOT NULL CHECK (cardinality(granted_scopes) > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT oauth_access_tokens_app_workspace_fk
    FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE
);

ALTER TABLE oauth_access_tokens DROP CONSTRAINT IF EXISTS oauth_access_tokens_app_id_fkey;
ALTER TABLE oauth_access_tokens DROP CONSTRAINT IF EXISTS oauth_access_tokens_granted_scopes_check;
ALTER TABLE oauth_access_tokens DROP CONSTRAINT IF EXISTS oauth_access_tokens_granted_scopes_nonempty;
ALTER TABLE oauth_access_tokens
  ADD CONSTRAINT oauth_access_tokens_granted_scopes_nonempty CHECK (cardinality(granted_scopes) > 0);

ALTER TABLE oauth_access_tokens DROP CONSTRAINT IF EXISTS oauth_access_tokens_app_workspace_fk;
ALTER TABLE oauth_access_tokens
  ADD CONSTRAINT oauth_access_tokens_app_workspace_fk
  FOREIGN KEY (app_id, workspace_id) REFERENCES oauth_apps(id, workspace_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_lookup
  ON oauth_access_tokens(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_app_user
  ON oauth_access_tokens(app_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public_api_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
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

ALTER TABLE public_api_audit_logs DROP CONSTRAINT IF EXISTS public_api_audit_logs_request_id_length;
ALTER TABLE public_api_audit_logs
  ADD CONSTRAINT public_api_audit_logs_request_id_length CHECK (char_length(request_id) <= 128);

CREATE INDEX IF NOT EXISTS idx_public_api_audit_logs_app_created
  ON public_api_audit_logs(app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_api_audit_logs_request_id
  ON public_api_audit_logs(request_id);

CREATE INDEX IF NOT EXISTS idx_public_api_audit_logs_workspace_created
  ON public_api_audit_logs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_api_audit_logs_created
  ON public_api_audit_logs(created_at DESC);

COMMENT ON TABLE oauth_apps IS 'OAuth client applications registered for PlugForge public API access.';
COMMENT ON TABLE oauth_access_tokens IS 'OAuth access tokens for /api/v1 bearer authentication; raw tokens are never stored.';
COMMENT ON TABLE public_api_audit_logs IS 'Per-request audit rows for PlugForge public API calls.';
