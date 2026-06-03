-- OAuth app secret records support shown-once rotation, grace, and revocation.

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_app_secrets_one_active
  ON oauth_app_secrets(app_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_oauth_app_secrets_app_created
  ON oauth_app_secrets(app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oauth_app_secrets_grace_expiry
  ON oauth_app_secrets(expires_at)
  WHERE status = 'grace';

INSERT INTO oauth_app_secrets (
  app_id,
  workspace_id,
  secret_hash,
  status,
  created_at,
  updated_at
)
SELECT
  app.id,
  app.workspace_id,
  app.client_secret_hash,
  'active',
  app.created_at,
  app.updated_at
FROM oauth_apps app
WHERE NOT EXISTS (
  SELECT 1
  FROM oauth_app_secrets secret
  WHERE secret.app_id = app.id
);

COMMENT ON TABLE oauth_app_secrets IS 'Shown-once OAuth client secret hashes with rotation and revocation state.';
