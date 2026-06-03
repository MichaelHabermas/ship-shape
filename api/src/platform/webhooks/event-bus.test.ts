// Webhook event-bus tests cover handler failure modes without touching transport.
import type { WebhookEvent } from '@ship/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InProcessWebhookEventBus, scheduleWebhookEvent } from './event-bus.js';

describe('webhook event bus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs handler failures by default and returns remaining delivery ids', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = new InProcessWebhookEventBus();
    bus.subscribe(async () => ({ deliveryIds: ['delivery-ok'] }));
    bus.subscribe(async () => {
      throw new Error('handler failed');
    });

    const result = await bus.publish(webhookEvent());

    expect(result.deliveryIds).toEqual(['delivery-ok']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook event handler failed'));
  });

  it('rethrows handler failures when the publisher requires durability', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = new InProcessWebhookEventBus();
    bus.subscribe(async () => {
      throw new Error('handler failed');
    });

    await expect(bus.publish(webhookEvent(), { errorMode: 'throw' })).rejects.toThrow('handler failed');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook event handler failed'));
  });

  it('logs invalid scheduled publications without throwing to the caller', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    scheduleWebhookEvent({
      ...webhookEvent(),
      payload: {},
    });
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook event publication failed'));
  });
});

function webhookEvent(): WebhookEvent {
  return {
    type: 'issue.created',
    workspace_id: '11111111-1111-4111-8111-111111111111',
    idempotency_key: 'issue.created:22222222-2222-4222-8222-222222222222',
    resource: {
      kind: 'document',
      id: '22222222-2222-4222-8222-222222222222',
      document_type: 'issue',
    },
    payload: {
      issue: {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Webhook event bus proof',
        display_id: '#12',
        ticket_number: 12,
        state: 'backlog',
        assignee_id: null,
        api_url: '/api/v1/issues/22222222-2222-4222-8222-222222222222',
        ui_url: '/documents/22222222-2222-4222-8222-222222222222',
      },
      actor: { id: '33333333-3333-4333-8333-333333333333' },
    },
  };
}
