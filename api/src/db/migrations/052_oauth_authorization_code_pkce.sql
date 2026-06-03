-- Durable OAuth authorization-code, consent, and refresh-token state for PlugForge.

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

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_lookup
  ON oauth_authorization_requests(id, user_id, workspace_id)
  WHERE approved_at IS NULL AND denied_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_expires
  ON oauth_authorization_requests(expires_at);

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

CREATE INDEX IF NOT EXISTS idx_oauth_grants_app_user
  ON oauth_grants(app_id, user_id, workspace_id)
  WHERE revoked_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_lookup
  ON oauth_authorization_codes(code_hash)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_codes_expires
  ON oauth_authorization_codes(expires_at);

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

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_token_families_active
  ON oauth_refresh_token_families(app_id, user_id, workspace_id, expires_at)
  WHERE invalidated_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_lookup
  ON oauth_refresh_tokens(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_family
  ON oauth_refresh_tokens(family_id, created_at DESC);

ALTER TABLE oauth_access_tokens
  ADD COLUMN IF NOT EXISTS grant_id UUID REFERENCES oauth_grants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_family_id UUID REFERENCES oauth_refresh_token_families(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_grant
  ON oauth_access_tokens(grant_id)
  WHERE grant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_refresh_family
  ON oauth_access_tokens(refresh_token_family_id)
  WHERE refresh_token_family_id IS NOT NULL;

COMMENT ON TABLE oauth_authorization_requests IS 'Pending OAuth authorization requests awaiting user consent.';
COMMENT ON TABLE oauth_grants IS 'User consent grants for OAuth apps and public API scopes.';
COMMENT ON TABLE oauth_authorization_codes IS 'One-time Authorization Code + PKCE codes; raw codes are never stored.';
COMMENT ON TABLE oauth_refresh_token_families IS 'Refresh-token rotation families; reuse invalidates the family.';
COMMENT ON TABLE oauth_refresh_tokens IS 'One-time-use OAuth refresh tokens; raw tokens are never stored.';
