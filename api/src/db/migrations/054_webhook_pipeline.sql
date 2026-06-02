-- Public webhook subscriptions, event ledger, and delivery attempts for PlugForge.

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

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_app_created
  ON webhook_subscriptions(app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_match
  ON webhook_subscriptions(workspace_id, event_type)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_workspace_created
  ON webhook_events(workspace_id, created_at DESC);

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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription_created
  ON webhook_deliveries(subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON webhook_deliveries(next_attempt_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event
  ON webhook_deliveries(event_id, attempt_number);

COMMENT ON TABLE webhook_subscriptions IS 'Per-OAuth-app public webhook subscriptions.';
COMMENT ON TABLE webhook_events IS 'Canonical public webhook event ledger.';
COMMENT ON TABLE webhook_deliveries IS 'Every public webhook delivery attempt, including retries and replays.';
