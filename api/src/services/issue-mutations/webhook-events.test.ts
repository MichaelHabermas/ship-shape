// Issue mutation webhook tests prove public events are emitted from domain services.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/client.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';
import type {
  IWebhookDeliverer,
  WebhookDelivererRequest,
  WebhookDelivererResult,
} from '../../platform/webhooks/deliverer.js';
import {
  configureWebhookServiceDependencies,
  createWebhookSubscription,
  replayWebhookDelivery,
  type WebhookClock,
} from '../../platform/webhooks/service.js';
import { createIssueMutation, updateIssueMutation } from './index.js';
import type { Principal } from '../../security/principal.js';

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

type DeliveryRow = {
  id: string;
  idempotency_key: string;
  status: string;
};

describe('issue mutation webhook events', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clientId = `ship_app_issue_webhooks_${testRunId}`;

  let workspaceId: string;
  let userId: string;
  let assigneeUserId: string;
  let appId: string;
  let deliverer: FakeWebhookDeliverer;
  let restoreWebhookDependencies: (() => void) | null = null;

  beforeAll(async () => {
    workspaceId = requireFirstRow((await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Issue Webhooks ${testRunId}`]
    )).rows).id;
    userId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Issue Webhook Actor')
       RETURNING id`,
      [`issue-webhooks-${testRunId}@ship.local`]
    )).rows).id;
    assigneeUserId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Issue Webhook Assignee')
       RETURNING id`,
      [`issue-webhooks-assignee-${testRunId}@ship.local`]
    )).rows).id;
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, userId, assigneeUserId]
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
       VALUES ($1, $2, 'Issue Webhook Test App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        ['https://example.test/callback'],
        ['webhooks:manage', 'issues:read', 'issues:write'],
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
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, assigneeUserId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('emits signed issue.created deliveries and replays with the original idempotency key', async () => {
    await createSubscription('issue.created');

    const issueId = await createIssue('Created webhook issue');
    await waitForDeliveries(1);

    const firstDelivery = deliverer.requests[0];
    expect(firstDelivery?.headers['Ship-Event-Type']).toBe('issue.created');
    expect(firstDelivery?.headers['Idempotency-Key']).toBe(`issue.created:${issueId}`);
    expect(firstDelivery?.headers['Ship-Signature']).toEqual(expect.stringContaining('v1='));
    expect(JSON.stringify(JSON.parse(firstDelivery?.rawBody ?? '{}'))).not.toContain('content');

    const delivery = await findDelivery(`issue.created:${issueId}`);
    expect(delivery.status).toBe('succeeded');

    await replayWebhookDelivery({
      deliveryId: delivery.id,
      appId,
      workspaceId,
    });
    expect(deliverer.requests[1]?.headers['Idempotency-Key']).toBe(`issue.created:${issueId}`);
  });

  it('emits issue.assigned and issue.status_changed from update mutation deltas', async () => {
    const issueId = await createIssue('Updated webhook issue');
    await createSubscription('issue.assigned');
    await createSubscription('issue.status_changed');

    await updateIssue(issueId, { assignee_id: assigneeUserId, state: 'in_progress' });
    await waitForDeliveries(2);

    const eventTypes = deliverer.requests.map(request => request.headers['Ship-Event-Type']).sort();
    expect(eventTypes).toEqual(['issue.assigned', 'issue.status_changed']);
    const assigned = deliverer.requests.find(request => request.headers['Ship-Event-Type'] === 'issue.assigned');
    const statusChanged = deliverer.requests.find(request => request.headers['Ship-Event-Type'] === 'issue.status_changed');
    const assignedData = webhookData(assigned?.rawBody);
    const statusData = webhookData(statusChanged?.rawBody);

    expect(assigned?.headers['Idempotency-Key']).toEqual(expect.stringMatching(/^issue\.assigned:/));
    expect(statusChanged?.headers['Idempotency-Key']).toEqual(expect.stringMatching(/^issue\.status_changed:/));
    expect(nestedString(assignedData, ['assignee', 'id'])).toBe(assigneeUserId);
    expect(statusData.previous_status).toBe('backlog');
    expect(statusData.status).toBe('in_progress');
  });

  it('does not fan out private issue webhook payloads to unreadable subscription subjects', async () => {
    const privateIssueId = await insertPrivateIssue('Private webhook issue');
    await createSubscription('issue.status_changed', assigneeUserId);

    await updateIssue(privateIssueId, { state: 'in_progress' });

    expect(deliverer.requests).toHaveLength(0);
  });

  it('fans out private issue webhook payloads to readable subscription subjects', async () => {
    const privateIssueId = await insertPrivateIssue('Private webhook issue for actor');
    await createSubscription('issue.status_changed', userId);

    await updateIssue(privateIssueId, { state: 'in_progress' });
    await waitForDeliveries(1);

    expect(deliverer.requests[0]?.headers['Ship-Event-Type']).toBe('issue.status_changed');
  });

  async function createSubscription(
    event: 'issue.created' | 'issue.assigned' | 'issue.status_changed',
    readSubjectUserId = userId
  ): Promise<void> {
    await createWebhookSubscription({
      appId,
      workspaceId,
      event,
      targetUrl: `https://hooks.example.test/${event}/${testRunId}`,
      readSubjectUserId,
      readSubjectScopes: ['issues:read', 'webhooks:manage'],
      readContextSource: 'portal_session',
    });
  }

  async function createIssue(title: string): Promise<string> {
    const client = await pool.connect();
    try {
      const result = await createIssueMutation({
        client,
        actor,
        principal,
        userId,
        workspaceId,
        data: {
          title,
          state: 'backlog',
          priority: 'medium',
          assignee_id: null,
          belongs_to: [],
          source: 'internal',
          due_date: null,
          is_system_generated: false,
          accountability_target_id: null,
          accountability_type: null,
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok || typeof result.body.id !== 'string') throw new Error('Issue create failed');
      return result.body.id;
    } finally {
      client.release();
    }
  }

  async function updateIssue(
    issueId: string,
    data: { assignee_id?: string; state?: 'in_progress' }
  ): Promise<void> {
    const client = await pool.connect();
    try {
      const result = await updateIssueMutation({
        client,
        actor,
        principal,
        userId,
        workspaceId,
        issueId,
        data,
      });
      expect(result.ok).toBe(true);
    } finally {
      client.release();
    }
  }

  async function insertPrivateIssue(title: string): Promise<string> {
    return requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, ticket_number, created_by, visibility
       )
       VALUES ($1, 'issue', $2, $3, 700, $4, 'private')
       RETURNING id`,
      [
        workspaceId,
        title,
        { state: 'backlog', priority: 'medium', source: 'internal', assignee_id: null },
        userId,
      ]
    )).rows).id;
  }

  async function waitForDeliveries(count: number): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (deliverer.requests.length >= count) return;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error(`Expected ${count} webhook deliveries, saw ${deliverer.requests.length}`);
  }

  async function findDelivery(idempotencyKey: string): Promise<DeliveryRow> {
    const result = await pool.query<DeliveryRow>(
      `SELECT id, idempotency_key, status
       FROM webhook_deliveries
       WHERE workspace_id = $1
         AND idempotency_key = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [workspaceId, idempotencyKey]
    );
    return requireFirstRow(result.rows);
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
    sessionId: `issue-webhook-${testRunId}`,
    get userId() {
      return userId;
    },
    get workspaceId() {
      return workspaceId;
    },
    isSuperAdmin: false,
  };
});
