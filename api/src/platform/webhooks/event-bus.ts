// In-process webhook event bus keeps domain publication decoupled from delivery.
import type { WebhookEvent } from '@ship/shared';
import { logHotError } from '../../utils/hot-log.js';
import { parseWebhookEvent } from './events.js';

export interface IEventBus<TEvent = unknown> {
  publish(event: TEvent): Promise<void>;
}

type WebhookEventHandler = (event: WebhookEvent) => Promise<void>;

export class InProcessWebhookEventBus implements IEventBus<WebhookEvent> {
  private readonly handlers: WebhookEventHandler[] = [];

  subscribe(handler: WebhookEventHandler): void {
    this.handlers.push(handler);
  }

  async publish(event: WebhookEvent): Promise<void> {
    const parsed = parseWebhookEvent(event);
    await Promise.all(this.handlers.map(async (handler) => {
      try {
        await handler(parsed);
      } catch (error) {
        logHotError('webhooks.event_bus', 'Webhook event handler failed', error, {
          eventType: parsed.type,
          workspaceId: parsed.workspace_id,
        });
      }
    }));
  }
}

export const webhookEventBus = new InProcessWebhookEventBus();

export async function publishWebhookEvent(event: WebhookEvent): Promise<void> {
  await webhookEventBus.publish(event);
}
