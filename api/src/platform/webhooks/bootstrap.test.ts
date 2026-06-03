// Webhook bootstrap tests prove test reset avoids stacking event-bus subscribers.
import { describe, expect, it } from 'vitest';
import { bootstrapWebhooks, resetWebhookBootstrapForTests } from './bootstrap.js';
import { webhookEventBus } from './event-bus.js';

describe('bootstrapWebhooks', () => {
  it('does not stack subscribers when bootstrap is reset and called again', () => {
    resetWebhookBootstrapForTests();
    bootstrapWebhooks();
    expect(webhookEventBus.subscriberCountForTests()).toBe(1);

    bootstrapWebhooks();
    expect(webhookEventBus.subscriberCountForTests()).toBe(1);

    resetWebhookBootstrapForTests();
    expect(webhookEventBus.subscriberCountForTests()).toBe(0);

    bootstrapWebhooks();
    expect(webhookEventBus.subscriberCountForTests()).toBe(1);
  });
});
