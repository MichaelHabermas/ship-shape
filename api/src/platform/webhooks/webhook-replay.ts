// Manual webhook delivery replay for a prior delivery attempt.
import type { PublicWebhookDelivery } from '@ship/shared';
import {
  createReplayDeliveryAttempt,
  deliverWebhookDelivery,
  findDelivery,
  publicDeliveryFromRow,
  type WebhookDeliveryRow,
} from './webhook-delivery.js';
import { webhookDb } from './webhook-service-deps.js';

export async function replayWebhookDelivery(input: {
  deliveryId: string;
  appId: string;
  workspaceId: string;
}): Promise<PublicWebhookDelivery> {
  const originalResult = await webhookDb().query<WebhookDeliveryRow>(
    `SELECT d.id, d.subscription_id, d.event_id, e.event_type, d.workspace_id, d.attempt_number,
            d.status, d.idempotency_key, d.response_status, d.response_excerpt,
            d.latency_ms, d.next_attempt_at, d.replay_of_delivery_id,
            d.created_at, d.updated_at
       FROM webhook_deliveries d
       JOIN webhook_subscriptions s ON s.id = d.subscription_id
       JOIN webhook_events e ON e.id = d.event_id
      WHERE d.id = $1
        AND d.workspace_id = $2
        AND s.app_id = $3`,
    [input.deliveryId, input.workspaceId, input.appId]
  );
  const original = originalResult.rows[0];
  if (!original) {
    throw new Error('WEBHOOK_DELIVERY_NOT_FOUND');
  }

  const replay = await createReplayDeliveryAttempt(original);
  await deliverWebhookDelivery(replay.id);
  const updated = await findDelivery(replay.id);
  return publicDeliveryFromRow(updated);
}
