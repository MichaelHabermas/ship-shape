// Thin facade re-exporting webhook subscriptions, fanout, delivery, and DI.
import type { WebhookEvent } from '@ship/shared';
import { validateWebhookTargetUrl } from './webhook-target-url.js';
import { webhookServiceDependencies } from './webhook-service-deps.js';
import { dispatchWebhookDeliveries } from './webhook-delivery.js';
import { enqueueWebhookEvent } from './webhook-fanout.js';

webhookServiceDependencies.validateTargetUrl = validateWebhookTargetUrl;

export {
  configureWebhookServiceDependencies,
  type WebhookClock,
  type WebhookServiceDependencies,
} from './webhook-service-deps.js';

export {
  WebhookTargetUrlError,
  isWebhookTargetUrlError,
  validateWebhookTargetUrl,
} from './webhook-target-url.js';

export {
  WebhookSubscriptionScopeError,
  isWebhookSubscriptionScopeError,
  type WebhookReadContextSource,
  createWebhookSubscription,
  listWebhookSubscriptions,
} from './webhook-subscriptions.js';

export { enqueueWebhookEvent } from './webhook-fanout.js';

export {
  dispatchWebhookDeliveries,
  processDueWebhookDeliveries,
  listWebhookDeliveries,
} from './webhook-delivery.js';

export { replayWebhookDelivery } from './webhook-replay.js';

export async function persistAndDispatchWebhookEvent(event: WebhookEvent): Promise<void> {
  const enqueued = await enqueueWebhookEvent(event);
  await dispatchWebhookDeliveries(enqueued.deliveryIds);
}
