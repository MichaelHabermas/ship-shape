// In-process webhook event bus keeps domain publication decoupled from delivery.
import type { WebhookEvent } from '@ship/shared';
import type { Pool, PoolClient } from 'pg';
import { logHotError } from '../../utils/hot-log.js';
import { parseWebhookEvent } from './events.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type WebhookEventPublishOptions = {
  db?: QueryRunner;
  dispatch?: 'immediate' | 'none';
  errorMode?: 'log' | 'throw';
};

export type WebhookEventPublishResult = {
  deliveryIds: string[];
};

export interface IEventBus<TEvent = unknown, TResult = unknown, TOptions = unknown> {
  publish(event: TEvent, options?: TOptions): Promise<TResult>;
}

type WebhookEventHandler = (
  event: WebhookEvent,
  options: WebhookEventPublishOptions
) => Promise<void | WebhookEventPublishResult>;

type WebhookDeliveryDispatchHandler = (deliveryIds: string[]) => Promise<void>;

export class InProcessWebhookEventBus implements IEventBus<
  WebhookEvent,
  WebhookEventPublishResult,
  WebhookEventPublishOptions
> {
  private readonly handlers: WebhookEventHandler[] = [];

  subscribe(handler: WebhookEventHandler): void {
    this.handlers.push(handler);
  }

  async publish(
    event: WebhookEvent,
    options: WebhookEventPublishOptions = {}
  ): Promise<WebhookEventPublishResult> {
    const parsed = parseWebhookEvent(event);
    const results = await Promise.all(this.handlers.map(async (handler) => {
      try {
        return await handler(parsed, options);
      } catch (error) {
        logHotError('webhooks.event_bus', 'Webhook event handler failed', error, {
          eventType: parsed.type,
          workspaceId: parsed.workspace_id,
        });
        if (options.errorMode === 'throw') throw error;
        return undefined;
      }
    }));
    return {
      deliveryIds: results.flatMap(result => result?.deliveryIds ?? []),
    };
  }

  clearSubscribersForTests(): void {
    this.handlers.length = 0;
  }

  subscriberCountForTests(): number {
    return this.handlers.length;
  }
}

export const webhookEventBus = new InProcessWebhookEventBus();

let webhookDeliveryDispatchHandler: WebhookDeliveryDispatchHandler | null = null;

export function registerWebhookDeliveryDispatchHandler(
  handler: WebhookDeliveryDispatchHandler
): void {
  webhookDeliveryDispatchHandler = handler;
}

export function resetWebhookDeliveryDispatchHandlerForTests(): void {
  webhookDeliveryDispatchHandler = null;
}

export async function publishWebhookEvent(
  event: WebhookEvent,
  options?: WebhookEventPublishOptions
): Promise<WebhookEventPublishResult> {
  return webhookEventBus.publish(event, options);
}

export async function publishWebhookEventInTransaction(
  event: WebhookEvent,
  db: QueryRunner
): Promise<WebhookEventPublishResult> {
  return publishWebhookEvent(event, {
    db,
    dispatch: 'none',
    errorMode: 'throw',
  });
}

export function commitAndDispatchWebhooks(deliveryIds: string[]): void {
  scheduleWebhookDeliveryDispatch(deliveryIds);
}

export function scheduleWebhookEvent(event: WebhookEvent): void {
  void publishWebhookEvent(event).catch((error: unknown) => {
    logHotError('webhooks.event_bus', 'Webhook event publication failed', error, {
      eventType: event.type,
      workspaceId: event.workspace_id,
    });
  });
}

export function scheduleWebhookDeliveryDispatch(deliveryIds: string[]): void {
  if (deliveryIds.length === 0) return;
  if (!webhookDeliveryDispatchHandler) {
    logHotError('webhooks.event_bus', 'Webhook delivery dispatch handler missing', null, {
      deliveryCount: deliveryIds.length,
    });
    return;
  }
  void webhookDeliveryDispatchHandler(deliveryIds).catch((error: unknown) => {
    logHotError('webhooks.dispatch', 'Failed to dispatch queued webhook deliveries', error, {
      deliveryCount: deliveryIds.length,
    });
  });
}
