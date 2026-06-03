// Webhook platform bootstrap wires the event bus subscriber and dispatch handler once at startup.
import {
  registerWebhookDeliveryDispatchHandler,
  resetWebhookDeliveryDispatchHandlerForTests,
  webhookEventBus,
} from './event-bus.js';
import { dispatchWebhookDeliveries, enqueueWebhookEvent } from './service.js';

let bootstrapped = false;

export function bootstrapWebhooks(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  registerWebhookDeliveryDispatchHandler(dispatchWebhookDeliveries);

  webhookEventBus.subscribe(async (event, options) => {
    const enqueued = await enqueueWebhookEvent(event, options.db);
    if (options.dispatch === 'none') {
      return { deliveryIds: enqueued.deliveryIds };
    }
    await dispatchWebhookDeliveries(enqueued.deliveryIds);
    return { deliveryIds: enqueued.deliveryIds };
  });
}

export function resetWebhookBootstrapForTests(): void {
  bootstrapped = false;
  webhookEventBus.clearSubscribersForTests();
  resetWebhookDeliveryDispatchHandlerForTests();
}
