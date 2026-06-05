// Webhook service tests prove retry and DLQ semantics with fake clocks and transport.
import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyWebhook } from '@ship/sdk';
import { pool } from '../../db/client.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';
import type {
  IWebhookDeliverer,
  WebhookDelivererRequest,
  WebhookDelivererResult,
} from './deliverer.js';
import {
  configureWebhookServiceDependencies,
  createWebhookSubscription,
  deactivateWebhookSubscription,
  dispatchWebhookDeliveries,
  enqueueWebhookEvent,
  processDueWebhookDeliveries,
  replayWebhookDelivery,
  type WebhookClock,
} from './service.js';
import { WEBHOOK_MAX_FAILED_ATTEMPTS, WEBHOOK_RETRY_DELAYS_MS } from './retry-schedule.js';

type DeliveryRow = {
  id: string;
  attempt_number: number;
  status: string;
  response_status: number | null;
  next_attempt_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  last_error: string | null;
};

class FakeWebhookClock implements WebhookClock {
  private timestampMs = Date.UTC(2030, 0, 1, 0, 0, 0);

  now(): Date {
    return new Date(this.timestampMs);
  }

  nowMs(): number {
    return this.timestampMs;
  }

  set(timestampMs: number): void {
    this.timestampMs = timestampMs;
  }
}

class FakeWebhookDeliverer implements IWebhookDeliverer {
  readonly requests: WebhookDelivererRequest[] = [];
  private readonly results: WebhookDelivererResult[] = [];

  queue(result: WebhookDelivererResult): void {
    this.results.push(result);
  }

  async deliver(delivery: WebhookDelivererRequest): Promise<WebhookDelivererResult> {
    this.requests.push(delivery);
    return this.results.shift() ?? {
      responseStatus: 204,
      responseExcerpt: '',
      error: null,
    };
  }
}

class DedupingWebhookReceiver implements IWebhookDeliverer {
  readonly records: Array<{ idempotencyKey: string | null; verified: boolean; deduped: boolean }> = [];
  private readonly seenKeys = new Set<string>();
  private signingSecret = '';

  setSigningSecret(secret: string): void {
    this.signingSecret = secret;
  }

  async deliver(delivery: WebhookDelivererRequest): Promise<WebhookDelivererResult> {
    const idempotencyKey = delivery.headers['Idempotency-Key'] ?? null;
    const verified = verifyWebhook(delivery.headers, delivery.rawBody, this.signingSecret);
    const deduped = Boolean(idempotencyKey && this.seenKeys.has(idempotencyKey));
    if (verified && idempotencyKey && !deduped) {
      this.seenKeys.add(idempotencyKey);
    }
    this.records.push({ idempotencyKey, verified, deduped });
    return {
      responseStatus: 200,
      responseExcerpt: JSON.stringify({ ok: verified, deduped }),
      error: null,
    };
  }
}

describe('webhook delivery reliability', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `webhook-service-${testRunId}@ship.local`;
  const clientId = `ship_app_webhook_service_${testRunId}`;
  let workspaceId: string;
  let userId: string;
  let viewerUserId: string;
  let appId: string;
  let clock: FakeWebhookClock;
  let deliverer: FakeWebhookDeliverer;
  let restoreWebhookDependencies: (() => void) | null = null;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Webhook Service ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Webhook Service User')
       RETURNING id`,
      [email]
    );
    userId = requireFirstRow(userResult.rows).id;
    const viewerResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Webhook Service Viewer')
       RETURNING id`,
      [`webhook-service-viewer-${testRunId}@ship.local`]
    );
    viewerUserId = requireFirstRow(viewerResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, userId, viewerUserId]
    );

    const appResult = await pool.query<IdRow>(
      `INSERT INTO oauth_apps (
         workspace_id,
         owner_user_id,
         name,
         client_id,
         client_secret_hash,
         redirect_uris,
         requested_scopes
       )
       VALUES ($1, $2, 'Webhook Service Test App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        ['https://example.test/callback'],
        ['documents:read', 'webhooks:manage'],
      ]
    );
    appId = requireFirstRow(appResult.rows).id;
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_subscriptions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    clock = new FakeWebhookClock();
    deliverer = new FakeWebhookDeliverer();
    restoreWebhookDependencies = configureWebhookServiceDependencies({
      clock,
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
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, viewerUserId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('keeps canon retry constants explicit', () => {
    expect([...WEBHOOK_RETRY_DELAYS_MS]).toEqual([
      1_000,
      4_000,
      16_000,
      60_000,
      300_000,
      1_800_000,
    ]);
    expect(WEBHOOK_MAX_FAILED_ATTEMPTS).toBe(6);
  });

  it('marks 2xx delivery attempts succeeded', async () => {
    await createSubscription();
    const idempotencyKey = `document.created:success-${testRunId}`;
    const documentId = await insertWebhookDocument();
    deliverer.queue({ responseStatus: 204, responseExcerpt: '{"ok":true}', error: null });

    await publishAndDispatch(idempotencyKey, documentId);

    const rows = await findDeliveries(idempotencyKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attempt_number: 1,
      status: 'succeeded',
      response_status: 204,
      next_attempt_at: null,
      failed_at: null,
    });
    expect(rows[0]?.delivered_at?.getTime()).toBe(clock.nowMs());
    expect(deliverer.requests).toHaveLength(1);
    expect(deliverer.requests[0]?.timeoutMs).toBe(123);
    expect(deliverer.requests[0]?.headers['Idempotency-Key']).toBe(idempotencyKey);
  });

  it.each([
    ['429', { responseStatus: 429, responseExcerpt: 'too many', error: null }],
    ['5xx', { responseStatus: 503, responseExcerpt: 'unavailable', error: null }],
    ['timeout', { responseStatus: null, responseExcerpt: null, error: 'timeout' }],
  ] satisfies Array<[string, WebhookDelivererResult]>)(
    'schedules retry attempts for %s outcomes without sleeping',
    async (_label, result) => {
      await createSubscription();
      const idempotencyKey = `document.created:retry-${_label}-${testRunId}`;
      const documentId = await insertWebhookDocument();
      deliverer.queue(result);

      await publishAndDispatch(idempotencyKey, documentId);

      const rows = await findDeliveries(idempotencyKey);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        attempt_number: 1,
        status: 'retrying',
        response_status: result.responseStatus,
      });
      expect(rows[0]?.next_attempt_at?.getTime()).toBe(clock.nowMs() + WEBHOOK_RETRY_DELAYS_MS[0]);
      expect(rows[1]).toMatchObject({
        attempt_number: 2,
        status: 'pending',
      });
      expect(rows[1]?.next_attempt_at?.getTime()).toBe(clock.nowMs() + WEBHOOK_RETRY_DELAYS_MS[0]);
      expect(await processDueWebhookDeliveries(clock.now())).toBe(0);
    }
  );

  it('deactivation cancels pending retries and blocks replay', async () => {
    const subscription = await createSubscription();
    const idempotencyKey = `document.created:deactivate-pending-${testRunId}`;
    const documentId = await insertWebhookDocument();
    deliverer.queue({ responseStatus: 500, responseExcerpt: 'retry me', error: null });

    await publishAndDispatch(idempotencyKey, documentId);

    let rows = await findDeliveries(idempotencyKey);
    expect(rows).toHaveLength(2);
    const original = rows[0];
    const pendingRetry = rows[1];
    if (!original || !pendingRetry?.next_attempt_at) throw new Error('Expected original and pending retry');

    await deactivateWebhookSubscription({
      subscriptionId: subscription.id,
      appId,
      workspaceId,
    });

    rows = await findDeliveries(idempotencyKey);
    expect(rows[0]?.status).toBe('retrying');
    expect(rows[1]).toMatchObject({
      attempt_number: 2,
      status: 'dlq',
      next_attempt_at: null,
      last_error: 'Webhook subscription deactivated',
    });

    clock.set(pendingRetry.next_attempt_at.getTime());
    expect(await processDueWebhookDeliveries()).toBe(0);
    expect(deliverer.requests).toHaveLength(1);
    await expect(replayWebhookDelivery({
      deliveryId: original.id,
      appId,
      workspaceId,
    })).rejects.toThrow('WEBHOOK_DELIVERY_NOT_FOUND');
  });

  it('W6 retries 500,500,500,200 after 1s, 4s, and 16s and logs final success', async () => {
    await createSubscription();
    const idempotencyKey = `document.created:w6-exact-retry-${testRunId}`;
    const documentId = await insertWebhookDocument();
    deliverer.queue({ responseStatus: 500, responseExcerpt: 'failure 1', error: null });
    deliverer.queue({ responseStatus: 500, responseExcerpt: 'failure 2', error: null });
    deliverer.queue({ responseStatus: 500, responseExcerpt: 'failure 3', error: null });
    deliverer.queue({ responseStatus: 200, responseExcerpt: '{"ok":true}', error: null });

    await publishAndDispatch(idempotencyKey, documentId);

    for (let index = 0; index < 3; index += 1) {
      const attemptNumber = index + 1;
      const retryAttemptNumber = attemptNumber + 1;
      const expectedNextAttemptMs = clock.nowMs() + WEBHOOK_RETRY_DELAYS_MS[index];
      const rows = await findDeliveries(idempotencyKey);
      const failedAttempt = rows.find(row => row.attempt_number === attemptNumber);
      const pendingRetry = rows.find(row => row.attempt_number === retryAttemptNumber);

      expect(failedAttempt).toMatchObject({
        attempt_number: attemptNumber,
        status: 'retrying',
        response_status: 500,
      });
      expect(failedAttempt?.next_attempt_at?.getTime()).toBe(expectedNextAttemptMs);
      expect(pendingRetry).toMatchObject({
        attempt_number: retryAttemptNumber,
        status: 'pending',
      });
      expect(pendingRetry?.next_attempt_at?.getTime()).toBe(expectedNextAttemptMs);

      clock.set(expectedNextAttemptMs);
      expect(await processDueWebhookDeliveries()).toBe(1);
    }

    const rows = await findDeliveries(idempotencyKey);
    expect(rows).toHaveLength(4);
    expect(rows.map(row => row.status)).toEqual(['retrying', 'retrying', 'retrying', 'succeeded']);
    expect(rows[3]).toMatchObject({
      attempt_number: 4,
      response_status: 200,
      next_attempt_at: null,
      failed_at: null,
      last_error: null,
    });
    expect(rows[3]?.delivered_at?.getTime()).toBe(clock.nowMs());
    expect(deliverer.requests).toHaveLength(4);
  });

  it('claims a pending delivery once under concurrent dispatch', async () => {
    await createSubscription();
    const idempotencyKey = `document.created:claim-once-${testRunId}`;
    const documentId = await insertWebhookDocument();
    const enqueued = await enqueueWebhookEvent({
      type: 'document.created',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: eventPayload(documentId),
      resource: eventResource(documentId, 'wiki'),
    });
    expect(enqueued.deliveryIds).toHaveLength(1);
    const deliveryId = enqueued.deliveryIds[0];
    if (!deliveryId) throw new Error('Expected queued delivery');

    await dispatchWebhookDeliveries([deliveryId, deliveryId]);

    const rows = await findDeliveries(idempotencyKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('succeeded');
    expect(deliverer.requests).toHaveLength(1);
  });

  it('preserves Idempotency-Key on replay so subscribers can dedupe', async () => {
    const receiver = new DedupingWebhookReceiver();
    restoreWebhookDependencies?.();
    restoreWebhookDependencies = configureWebhookServiceDependencies({
      clock,
      deliverer: receiver,
      deliveryTimeoutMs: 123,
      validateTargetUrl: async () => {},
    });

    const subscription = await createWebhookSubscription({
      appId,
      workspaceId,
      event: 'document.created',
      targetUrl: `https://hooks.example.test/${crypto.randomUUID()}`,
      readSubjectUserId: userId,
      readSubjectScopes: ['documents:read', 'webhooks:manage'],
      readContextSource: 'portal_session',
    });
    receiver.setSigningSecret(subscription.signing_secret);

    const idempotencyKey = `document.created:replay-dedupe-${testRunId}`;
    const documentId = await insertWebhookDocument();
    const enqueued = await enqueueWebhookEvent({
      type: 'document.created',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: eventPayload(documentId),
      resource: eventResource(documentId, 'wiki'),
    });
    expect(enqueued.deliveryIds).toHaveLength(1);

    await dispatchWebhookDeliveries(enqueued.deliveryIds);
    const original = (await findDeliveries(idempotencyKey))[0];
    if (!original) throw new Error('expected original delivery');
    const replay = await replayWebhookDelivery({
      deliveryId: original.id,
      appId,
      workspaceId,
    });

    expect(replay).toMatchObject({
      idempotency_key: idempotencyKey,
      replay_of_delivery_id: original.id,
      status: 'succeeded',
    });
    expect(receiver.records).toEqual([
      { idempotencyKey, verified: true, deduped: false },
      { idempotencyKey, verified: true, deduped: true },
    ]);
  });

  it('recovers stale sending attempts through the due processor', async () => {
    await createSubscription();
    const idempotencyKey = `document.created:stale-sending-${testRunId}`;
    const documentId = await insertWebhookDocument();
    const enqueued = await enqueueWebhookEvent({
      type: 'document.created',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: eventPayload(documentId),
      resource: eventResource(documentId, 'wiki'),
    });
    const deliveryId = enqueued.deliveryIds[0];
    if (!deliveryId) throw new Error('Expected queued delivery');
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = 'sending',
           updated_at = $2
       WHERE id = $1`,
      [deliveryId, new Date(clock.nowMs() - 31_000)]
    );

    expect(await processDueWebhookDeliveries()).toBe(1);

    const rows = await findDeliveries(idempotencyKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('succeeded');
    expect(deliverer.requests).toHaveLength(1);
  });

  it('moves non-429 4xx failures directly to the DLQ', async () => {
    await createSubscription();
    const idempotencyKey = `document.created:terminal-${testRunId}`;
    const documentId = await insertWebhookDocument();
    deliverer.queue({ responseStatus: 400, responseExcerpt: 'bad request', error: null });

    await publishAndDispatch(idempotencyKey, documentId);

    const rows = await findDeliveries(idempotencyKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attempt_number: 1,
      status: 'dlq',
      response_status: 400,
      next_attempt_at: null,
      delivered_at: null,
    });
    expect(rows[0]?.failed_at?.getTime()).toBe(clock.nowMs());
  });

  it('moves the sixth failed attempt to the DLQ', async () => {
    await createSubscription();
    const idempotencyKey = `document.created:six-failures-${testRunId}`;
    const documentId = await insertWebhookDocument();
    for (let attempt = 0; attempt < WEBHOOK_MAX_FAILED_ATTEMPTS; attempt += 1) {
      deliverer.queue({ responseStatus: 500, responseExcerpt: `failure ${attempt + 1}`, error: null });
    }

    await publishAndDispatch(idempotencyKey, documentId);

    for (let attempt = 2; attempt <= WEBHOOK_MAX_FAILED_ATTEMPTS; attempt += 1) {
      const rows = await findDeliveries(idempotencyKey);
      const pending = rows.find(row => row.attempt_number === attempt);
      if (!pending?.next_attempt_at) {
        throw new Error(`Missing pending retry attempt ${attempt}`);
      }
      expect(pending.next_attempt_at.getTime()).toBe(clock.nowMs() + WEBHOOK_RETRY_DELAYS_MS[attempt - 2]);
      clock.set(pending.next_attempt_at.getTime());
      expect(await processDueWebhookDeliveries()).toBe(1);
    }

    const rows = await findDeliveries(idempotencyKey);
    expect(rows).toHaveLength(WEBHOOK_MAX_FAILED_ATTEMPTS);
    expect(rows.slice(0, -1).map(row => row.status)).toEqual([
      'retrying',
      'retrying',
      'retrying',
      'retrying',
      'retrying',
    ]);
    expect(rows[WEBHOOK_MAX_FAILED_ATTEMPTS - 1]).toMatchObject({
      attempt_number: WEBHOOK_MAX_FAILED_ATTEMPTS,
      status: 'dlq',
      next_attempt_at: null,
    });
    expect(deliverer.requests).toHaveLength(WEBHOOK_MAX_FAILED_ATTEMPTS);
  });

  it('filters private document deliveries by subscription subject at enqueue time', async () => {
    await createSubscription(viewerUserId);
    await createSubscription(userId);
    const documentId = await insertWebhookDocument('private');
    const idempotencyKey = `document.created:private-${testRunId}`;

    const enqueued = await enqueueWebhookEvent({
      type: 'document.created',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: eventPayload(documentId),
      resource: eventResource(documentId, 'wiki'),
    });

    expect(enqueued.deliveryIds).toHaveLength(1);
    await dispatchWebhookDeliveries(enqueued.deliveryIds);
    expect(deliverer.requests).toHaveLength(1);
    expect(deliverer.requests[0]?.headers['Idempotency-Key']).toBe(idempotencyKey);
  });

  async function createSubscription(readSubjectUserId = userId) {
    return await createWebhookSubscription({
      appId,
      workspaceId,
      event: 'document.created',
      targetUrl: `https://hooks.example.test/${crypto.randomUUID()}`,
      readSubjectUserId,
      readSubjectScopes: ['documents:read', 'webhooks:manage'],
      readContextSource: 'portal_session',
    });
  }

  async function publishAndDispatch(idempotencyKey: string, documentId: string): Promise<void> {
    const enqueued = await enqueueWebhookEvent({
      type: 'document.created',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: eventPayload(documentId),
      resource: eventResource(documentId, 'wiki'),
    });
    expect(enqueued.deliveryIds).toHaveLength(1);
    await dispatchWebhookDeliveries(enqueued.deliveryIds);
  }

  async function findDeliveries(idempotencyKey: string): Promise<DeliveryRow[]> {
    const result = await pool.query<DeliveryRow>(
      `SELECT id, attempt_number, status, response_status, next_attempt_at,
              delivered_at, failed_at, last_error
       FROM webhook_deliveries
       WHERE workspace_id = $1
         AND idempotency_key = $2
       ORDER BY attempt_number ASC`,
      [workspaceId, idempotencyKey]
    );
    return result.rows;
  }

  async function insertWebhookDocument(visibility: 'private' | 'workspace' = 'workspace'): Promise<string> {
    const result = await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'wiki', $2, $3, $4, $5)
       RETURNING id`,
      [
        workspaceId,
        `webhook service proof ${crypto.randomUUID()}`,
        {},
        userId,
        visibility,
      ]
    );
    return requireFirstRow(result.rows).id;
  }

  function eventPayload(documentId: string) {
    return {
      document: {
        id: documentId,
        title: 'webhook service proof',
        document_type: 'wiki',
        api_url: `/api/v1/documents/${documentId}`,
        ui_url: `/documents/${documentId}`,
      },
      actor: { id: userId },
    };
  }

  function eventResource(documentId: string, documentType: 'wiki' | 'issue') {
    return {
      kind: 'document' as const,
      id: documentId,
      document_type: documentType,
    };
  }
});
