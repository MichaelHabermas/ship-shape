-- Durable OAuth Device Authorization Grant state for CLI login.

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

CREATE INDEX IF NOT EXISTS idx_oauth_device_authorizations_user_code
  ON oauth_device_authorizations(user_code_hash)
  WHERE authorized_at IS NULL AND denied_at IS NULL AND consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_device_authorizations_device_code
  ON oauth_device_authorizations(device_code_hash)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_device_authorizations_expires
  ON oauth_device_authorizations(expires_at);

COMMENT ON TABLE oauth_device_authorizations IS 'Pending OAuth Device Authorization Grant requests for CLI login.';
