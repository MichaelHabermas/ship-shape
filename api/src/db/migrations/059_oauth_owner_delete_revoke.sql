-- Revokes third-party OAuth app credentials when ownership is deleted or already orphaned.

ALTER TABLE oauth_apps DROP CONSTRAINT IF EXISTS oauth_apps_owner_user_id_fkey;
ALTER TABLE oauth_apps ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE oauth_apps
  ADD CONSTRAINT oauth_apps_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_apps
SET is_active = FALSE,
    updated_at = NOW()
WHERE id IN (SELECT id FROM orphaned_apps)
  AND is_active IS TRUE;

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_app_secrets secret
SET status = 'revoked',
    revoked_at = COALESCE(secret.revoked_at, NOW()),
    expires_at = NULL,
    updated_at = NOW()
FROM orphaned_apps
WHERE secret.app_id = orphaned_apps.id
  AND secret.workspace_id = orphaned_apps.workspace_id
  AND secret.status IN ('active', 'grace');

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_access_tokens token
SET revoked_at = COALESCE(token.revoked_at, NOW())
FROM orphaned_apps
WHERE token.app_id = orphaned_apps.id
  AND token.workspace_id = orphaned_apps.workspace_id
  AND token.revoked_at IS NULL;

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_authorization_codes code
SET consumed_at = COALESCE(code.consumed_at, NOW())
FROM orphaned_apps
WHERE code.app_id = orphaned_apps.id
  AND code.workspace_id = orphaned_apps.workspace_id
  AND code.consumed_at IS NULL;

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_refresh_token_families family
SET invalidated_at = COALESCE(family.invalidated_at, NOW()),
    invalidated_reason = COALESCE(family.invalidated_reason, 'owner_deleted')
FROM orphaned_apps
WHERE family.app_id = orphaned_apps.id
  AND family.workspace_id = orphaned_apps.workspace_id
  AND family.invalidated_at IS NULL;

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_refresh_tokens token
SET revoked_at = COALESCE(token.revoked_at, NOW())
FROM orphaned_apps
WHERE token.app_id = orphaned_apps.id
  AND token.workspace_id = orphaned_apps.workspace_id
  AND token.revoked_at IS NULL;

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_grants grant_row
SET revoked_at = COALESCE(grant_row.revoked_at, NOW()),
    updated_at = NOW()
FROM orphaned_apps
WHERE grant_row.app_id = orphaned_apps.id
  AND grant_row.workspace_id = orphaned_apps.workspace_id
  AND grant_row.revoked_at IS NULL;

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_authorization_requests request
SET denied_at = COALESCE(request.denied_at, NOW())
FROM orphaned_apps
WHERE request.app_id = orphaned_apps.id
  AND request.workspace_id = orphaned_apps.workspace_id
  AND request.approved_at IS NULL
  AND request.denied_at IS NULL;

WITH orphaned_apps AS (
  SELECT id, workspace_id
  FROM oauth_apps
  WHERE owner_user_id IS NULL
    AND is_first_party IS NOT TRUE
)
UPDATE oauth_device_authorizations request
SET denied_at = COALESCE(request.denied_at, NOW()),
    updated_at = NOW()
FROM orphaned_apps
WHERE request.app_id = orphaned_apps.id
  AND request.workspace_id = orphaned_apps.workspace_id
  AND request.denied_at IS NULL
  AND request.consumed_at IS NULL;

CREATE OR REPLACE FUNCTION revoke_oauth_app_on_owner_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.owner_user_id IS NOT NULL
     AND NEW.owner_user_id IS NULL
     AND OLD.is_first_party IS FALSE THEN
    NEW.is_active := FALSE;
    NEW.updated_at := NOW();

    UPDATE oauth_app_secrets
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, NOW()),
        expires_at = NULL,
        updated_at = NOW()
    WHERE app_id = OLD.id
      AND workspace_id = OLD.workspace_id
      AND status IN ('active', 'grace');

    UPDATE oauth_access_tokens
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE app_id = OLD.id
      AND workspace_id = OLD.workspace_id
      AND revoked_at IS NULL;

    UPDATE oauth_authorization_codes
    SET consumed_at = COALESCE(consumed_at, NOW())
    WHERE app_id = OLD.id
      AND workspace_id = OLD.workspace_id
      AND consumed_at IS NULL;

    UPDATE oauth_refresh_token_families
    SET invalidated_at = COALESCE(invalidated_at, NOW()),
        invalidated_reason = COALESCE(invalidated_reason, 'owner_deleted')
    WHERE app_id = OLD.id
      AND workspace_id = OLD.workspace_id
      AND invalidated_at IS NULL;

    UPDATE oauth_refresh_tokens
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE app_id = OLD.id
      AND workspace_id = OLD.workspace_id
      AND revoked_at IS NULL;

    UPDATE oauth_grants
    SET revoked_at = COALESCE(revoked_at, NOW()),
        updated_at = NOW()
    WHERE app_id = OLD.id
      AND workspace_id = OLD.workspace_id
      AND revoked_at IS NULL;

    UPDATE oauth_authorization_requests
    SET denied_at = COALESCE(denied_at, NOW())
    WHERE app_id = OLD.id
      AND workspace_id = OLD.workspace_id
      AND approved_at IS NULL
      AND denied_at IS NULL;

    UPDATE oauth_device_authorizations
    SET denied_at = COALESCE(denied_at, NOW()),
        updated_at = NOW()
    WHERE app_id = OLD.id
      AND workspace_id = OLD.workspace_id
      AND denied_at IS NULL
      AND consumed_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS oauth_apps_owner_delete_revoke ON oauth_apps;
CREATE TRIGGER oauth_apps_owner_delete_revoke
BEFORE UPDATE OF owner_user_id ON oauth_apps
FOR EACH ROW
EXECUTE FUNCTION revoke_oauth_app_on_owner_delete();
