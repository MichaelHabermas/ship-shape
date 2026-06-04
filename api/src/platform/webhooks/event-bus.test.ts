// Webhook event-bus tests cover handler failure modes without touching transport.
import type { WebhookEvent } from '@ship/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InProcessWebhookEventBus, scheduleWebhookEvent } from './event-bus.js';
import { WEBHOOK_EVENT_SCHEMAS, parseWebhookEvent } from './events.js';

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

  it('validates every registered event with a specific payload schema', () => {
    expect(Object.keys(WEBHOOK_EVENT_SCHEMAS).sort()).toEqual([
      'document.created',
      'document.deleted',
      'document.updated',
      'issue.assigned',
      'issue.created',
      'issue.status_changed',
      'sprint.completed',
      'sprint.started',
    ]);

    for (const event of allWebhookEvents()) {
      expect(() => parseWebhookEvent(event)).not.toThrow();
      expect(() => parseWebhookEvent({
        ...event,
        payload: {},
      })).toThrow();
    }
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

function allWebhookEvents(): WebhookEvent[] {
  const documentId = '22222222-2222-4222-8222-222222222222';
  const issueId = '44444444-4444-4444-8444-444444444444';
  const sprintId = '55555555-5555-4555-8555-555555555555';
  const actor = { id: '33333333-3333-4333-8333-333333333333' };
  const document = {
    id: documentId,
    title: 'Webhook document proof',
    document_type: 'wiki' as const,
    api_url: `/api/v1/documents/${documentId}`,
    ui_url: `/documents/${documentId}`,
  };
  const issue = {
    id: issueId,
    title: 'Webhook issue proof',
    display_id: '#34',
    ticket_number: 34,
    state: 'backlog' as const,
    assignee_id: null,
    api_url: `/api/v1/issues/${issueId}`,
    ui_url: `/documents/${issueId}`,
  };
  const sprint = {
    id: sprintId,
    title: 'Webhook sprint proof',
    sprint_number: 6,
    status: 'active' as const,
    api_url: `/api/v1/sprints/${sprintId}`,
    ui_url: `/documents/${sprintId}`,
  };

  return [
    {
      type: 'document.created',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: `document.created:${documentId}`,
      resource: { kind: 'document', id: documentId, document_type: 'wiki' },
      payload: { document, actor },
    },
    {
      type: 'document.updated',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: `document.updated:${documentId}:2030-01-01T00:00:00.000Z`,
      resource: { kind: 'document', id: documentId, document_type: 'wiki' },
      payload: { document, actor, updated_at: '2030-01-01T00:00:00.000Z' },
    },
    {
      type: 'document.deleted',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: `document.deleted:${documentId}:2030-01-01T00:00:00.000Z`,
      resource: { kind: 'document', id: documentId, document_type: 'wiki' },
      payload: { document, actor, deleted_at: '2030-01-01T00:00:00.000Z' },
    },
    {
      type: 'issue.created',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: `issue.created:${issueId}`,
      resource: { kind: 'document', id: issueId, document_type: 'issue' },
      payload: { issue, actor },
    },
    {
      type: 'issue.assigned',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: `issue.assigned:${issueId}:2030-01-01T00:00:00.000Z`,
      resource: { kind: 'document', id: issueId, document_type: 'issue' },
      payload: { issue, assignee: actor, actor },
    },
    {
      type: 'issue.status_changed',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: `issue.status_changed:${issueId}:2030-01-01T00:00:00.000Z`,
      resource: { kind: 'document', id: issueId, document_type: 'issue' },
      payload: { issue, previous_status: 'backlog', status: 'in_progress', actor },
    },
    {
      type: 'sprint.started',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: `sprint.started:${sprintId}:2030-01-01T00:00:00.000Z`,
      resource: { kind: 'document', id: sprintId, document_type: 'sprint' },
      payload: { sprint, actor },
    },
    {
      type: 'sprint.completed',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      idempotency_key: `sprint.completed:${sprintId}:2030-01-01T00:00:00.000Z`,
      resource: { kind: 'document', id: sprintId, document_type: 'sprint' },
      payload: { sprint: { ...sprint, status: 'completed' as const }, actor },
    },
  ];
}
