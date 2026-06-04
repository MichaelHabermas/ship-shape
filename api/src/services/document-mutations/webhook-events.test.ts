// Document mutation webhook tests prove document and sprint events publish from domain services.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/client.js';
import type {
  IWebhookDeliverer,
  WebhookDelivererRequest,
  WebhookDelivererResult,
} from '../../platform/webhooks/deliverer.js';
import {
  configureWebhookServiceDependencies,
  createWebhookSubscription,
  type WebhookClock,
} from '../../platform/webhooks/service.js';
import type { Principal } from '../../security/principal.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';
import { deleteDocumentMutation, updateDocumentMutation } from './index.js';

class FakeWebhookClock implements WebhookClock {
  private timestampMs = Date.UTC(2030, 0, 1, 0, 0, 0);

  now(): Date {
    return new Date(this.timestampMs);
  }

  nowMs(): number {
    return this.timestampMs;
  }
}

class FakeWebhookDeliverer implements IWebhookDeliverer {
  readonly requests: WebhookDelivererRequest[] = [];

  async deliver(delivery: WebhookDelivererRequest): Promise<WebhookDelivererResult> {
    this.requests.push(delivery);
    return { responseStatus: 204, responseExcerpt: '', error: null };
  }
}

describe('document mutation webhook events', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clientId = `ship_app_document_webhooks_${testRunId}`;

  let workspaceId: string;
  let userId: string;
  let appId: string;
  let deliverer: FakeWebhookDeliverer;
  let restoreWebhookDependencies: (() => void) | null = null;

  beforeAll(async () => {
    workspaceId = requireFirstRow((await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Document Webhooks ${testRunId}`]
    )).rows).id;
    userId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Document Webhook Actor')
       RETURNING id`,
      [`document-webhooks-${testRunId}@ship.local`]
    )).rows).id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [workspaceId, userId]
    );
    appId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, 'Document Webhook Test App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        ['https://example.test/callback'],
        ['documents:read', 'documents:write', 'sprints:read', 'sprints:write', 'webhooks:manage'],
      ]
    )).rows).id;
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_subscriptions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    deliverer = new FakeWebhookDeliverer();
    restoreWebhookDependencies = configureWebhookServiceDependencies({
      clock: new FakeWebhookClock(),
      deliverer,
      deliveryTimeoutMs: 123,
      validateTargetUrl: async () => {},
    });
  });

  afterEach(() => {
    restoreWebhookDependencies?.();
    restoreWebhookDependencies = null;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_subscriptions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [appId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('emits document.updated plus sprint lifecycle events from update mutation deltas', async () => {
    await createSubscription('document.updated');
    await createSubscription('sprint.started');
    await createSubscription('sprint.completed');
    const sprintId = await insertDocument('sprint', 'Lifecycle sprint', {
      sprint_number: 9,
      status: 'planning',
    });

    const started = await updateDocumentMutation({
      actor,
      principal,
      documentId: sprintId,
      patch: { properties: { status: 'active' } },
      source: 'rest',
    });
    expect(started.ok).toBe(true);
    await waitForDeliveries(2);
    expect(eventTypes().sort()).toEqual(['document.updated', 'sprint.started']);

    const completed = await updateDocumentMutation({
      actor,
      principal,
      documentId: sprintId,
      patch: { properties: { status: 'completed' } },
      source: 'rest',
    });
    expect(completed.ok).toBe(true);
    await waitForDeliveries(4);
    expect(eventTypes().sort()).toEqual([
      'document.updated',
      'document.updated',
      'sprint.completed',
      'sprint.started',
    ]);
    const sprintPayloads = deliverer.requests
      .filter(request => request.headers['Ship-Event-Type']?.startsWith('sprint.'))
      .map(request => webhookData(request.rawBody));
    expect(sprintPayloads).toHaveLength(2);
    const [startedPayload, completedPayload] = sprintPayloads;
    if (!startedPayload || !completedPayload) {
      throw new Error('Expected sprint lifecycle webhook payloads');
    }
    expect(nestedString(startedPayload, ['sprint', 'status'])).toBe('active');
    expect(nestedString(completedPayload, ['sprint', 'status'])).toBe('completed');
  });

  it('emits document.deleted from delete mutation', async () => {
    await createSubscription('document.deleted');
    const documentId = await insertDocument('wiki', 'Deleted webhook document', {});

    const deleted = await deleteDocumentMutation({
      actor,
      principal,
      documentId,
      source: 'rest',
    });
    expect(deleted.ok).toBe(true);
    await waitForDeliveries(1);

    const request = deliverer.requests[0];
    expect(request?.headers['Ship-Event-Type']).toBe('document.deleted');
    expect(request?.headers['Idempotency-Key']).toEqual(expect.stringMatching(/^document\.deleted:/));
    const body = webhookData(request?.rawBody);
    expect(nestedString(body, ['document', 'id'])).toBe(documentId);
    expect(typeof body.deleted_at).toBe('string');
  });

  async function createSubscription(
    event: 'document.updated' | 'document.deleted' | 'sprint.started' | 'sprint.completed'
  ): Promise<void> {
    await createWebhookSubscription({
      appId,
      workspaceId,
      event,
      targetUrl: `https://hooks.example.test/${event}/${testRunId}`,
      readSubjectUserId: userId,
      readSubjectScopes: ['documents:read', 'sprints:read', 'webhooks:manage'],
      readContextSource: 'portal_session',
    });
  }

  async function insertDocument(
    documentType: 'wiki' | 'sprint',
    title: string,
    properties: Record<string, unknown>
  ): Promise<string> {
    return requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, $2, $3, $4, $5, 'workspace')
       RETURNING id`,
      [workspaceId, documentType, title, properties, userId]
    )).rows).id;
  }

  async function waitForDeliveries(count: number): Promise<void> {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      if (deliverer.requests.length >= count) return;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error(`Expected ${count} webhook deliveries, saw ${deliverer.requests.length}`);
  }

  function eventTypes(): Array<string | undefined> {
    return deliverer.requests.map(request => request.headers['Ship-Event-Type']);
  }

  function webhookData(rawBody: string | undefined): Record<string, unknown> {
    const parsed = JSON.parse(rawBody ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
      throw new Error('Webhook body missing data');
    }
    const data = parsed.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Webhook data was not an object');
    }
    return data as Record<string, unknown>;
  }

  function nestedString(
    record: Record<string, unknown>,
    path: [string, string]
  ): string | undefined {
    const first = record[path[0]];
    if (!first || typeof first !== 'object' || Array.isArray(first)) return undefined;
    const second = (first as Record<string, unknown>)[path[1]];
    return typeof second === 'string' ? second : undefined;
  }

  const actor = {
    get userId() {
      return userId;
    },
    get workspaceId() {
      return workspaceId;
    },
    isSuperAdmin: false,
  };

  const principal: Principal = {
    kind: 'session',
    sessionId: `document-webhook-${testRunId}`,
    get userId() {
      return userId;
    },
    get workspaceId() {
      return workspaceId;
    },
    isSuperAdmin: true,
  };
});
