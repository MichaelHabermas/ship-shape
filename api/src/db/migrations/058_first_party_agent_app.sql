-- Adds first-party OAuth app identity for delegated Ship Agent public API access.

ALTER TABLE oauth_apps
  ADD COLUMN IF NOT EXISTS is_first_party BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS system_key TEXT;

ALTER TABLE oauth_apps
  ALTER COLUMN owner_user_id DROP NOT NULL;

ALTER TABLE oauth_apps
  DROP CONSTRAINT IF EXISTS oauth_apps_system_key_nonempty;
ALTER TABLE oauth_apps
  ADD CONSTRAINT oauth_apps_system_key_nonempty
  CHECK (system_key IS NULL OR btrim(system_key) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_apps_workspace_system_key
  ON oauth_apps(workspace_id, system_key)
  WHERE system_key IS NOT NULL;

INSERT INTO oauth_apps (
  workspace_id,
  owner_user_id,
  name,
  client_id,
  client_secret_hash,
  redirect_uris,
  requested_scopes,
  is_first_party,
  system_key
)
SELECT
  workspace.id,
  NULL,
  'Ship Agent',
  'ship_agent_' || replace(workspace.id::text, '-', ''),
  'first-party-agent-no-client-secret',
  ARRAY['https://ship.local/first-party/ship-agent']::text[],
  ARRAY['documents:read', 'issues:read', 'sprints:read']::text[],
  TRUE,
  'ship-agent'
FROM workspaces workspace
ON CONFLICT (workspace_id, system_key) WHERE system_key IS NOT NULL
DO UPDATE SET
  name = EXCLUDED.name,
  requested_scopes = EXCLUDED.requested_scopes,
  is_first_party = TRUE,
  updated_at = NOW();

COMMENT ON COLUMN oauth_apps.is_first_party IS
  'True for Ship-owned OAuth app identities that consume the public API.';
COMMENT ON COLUMN oauth_apps.system_key IS
  'Stable first-party system key, unique per workspace when present.';
