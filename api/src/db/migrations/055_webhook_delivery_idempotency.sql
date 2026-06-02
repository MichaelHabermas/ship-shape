-- Prevent duplicate webhook delivery attempts for the same subscription/event.

ALTER TABLE webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_subscription_event_attempt_unique;

ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_subscription_event_attempt_unique
  UNIQUE (subscription_id, event_id, attempt_number);
