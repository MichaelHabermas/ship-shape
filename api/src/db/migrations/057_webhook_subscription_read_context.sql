-- Adds webhook subscription subject snapshots and resource metadata for enqueue-time authorization.

ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS read_subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS read_subject_scopes TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS read_context_source TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS read_context_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE webhook_subscriptions
  DROP CONSTRAINT IF EXISTS webhook_subscriptions_read_context_source_check;
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_subscriptions_read_context_source_check
  CHECK (read_context_source IN ('legacy', 'public_oauth', 'portal_session'));

ALTER TABLE webhook_subscriptions
  DROP CONSTRAINT IF EXISTS webhook_subscriptions_read_context_version_check;
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_subscriptions_read_context_version_check
  CHECK (read_context_version > 0);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_read_subject
  ON webhook_subscriptions(workspace_id, read_subject_user_id)
  WHERE read_subject_user_id IS NOT NULL;

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS resource_kind TEXT,
  ADD COLUMN IF NOT EXISTS resource_id UUID,
  ADD COLUMN IF NOT EXISTS resource_document_type TEXT;

ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_resource_kind_check;
ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_resource_kind_check
  CHECK (resource_kind IS NULL OR resource_kind = 'document');

ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_resource_document_type_check;
ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_resource_document_type_check
  CHECK (
    resource_document_type IS NULL
    OR resource_document_type IN (
      'wiki',
      'issue',
      'program',
      'project',
      'sprint',
      'person',
      'weekly_plan',
      'weekly_retro',
      'standup',
      'weekly_review'
    )
  );

UPDATE webhook_events
SET resource_kind = 'document',
    resource_id = (payload->'document'->>'id')::uuid,
    resource_document_type = payload->'document'->>'document_type'
WHERE resource_id IS NULL
  AND event_type LIKE 'document.%'
  AND payload->'document'->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

UPDATE webhook_events
SET resource_kind = 'document',
    resource_id = (payload->'issue'->>'id')::uuid,
    resource_document_type = 'issue'
WHERE resource_id IS NULL
  AND event_type LIKE 'issue.%'
  AND payload->'issue'->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

COMMENT ON COLUMN webhook_subscriptions.read_subject_user_id IS
  'User whose current resource read authorization gates delivery row creation.';
COMMENT ON COLUMN webhook_subscriptions.read_subject_scopes IS
  'Granted public API scope snapshot captured when the subscription was created.';
COMMENT ON COLUMN webhook_subscriptions.read_context_source IS
  'Source of the webhook read-context snapshot.';
COMMENT ON COLUMN webhook_events.resource_kind IS
  'Resource class used for enqueue-time delivery authorization.';
COMMENT ON COLUMN webhook_events.resource_id IS
  'Resource identifier used for enqueue-time delivery authorization.';
COMMENT ON COLUMN webhook_events.resource_document_type IS
  'Document type for document-backed webhook resources.';
