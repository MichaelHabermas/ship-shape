// Integration proof: webhook enqueue through mocked delivery transport.
import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/client.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';
import { bootstrapWebhooks, resetWebhookBootstrapForTests } from './bootstrap.js';
import type {
  IWebhookDeliverer,
  WebhookDelivererRequest,
  WebhookDelivererResult,
} from './deliverer.js';
import {
  commitDomainWebhooks,
  publishDomainWebhookInTransaction,
} from './mutation-publisher.js';
import {
  configureWebhookServiceDependencies,
  createWebhookSubscription,
  dispatchWebhookDeliveries,
  enqueueWebhookEvent,
} from './service.js';

class FakeWebhookDeliverer implements IWebhookDeliverer {
  readonly requests: WebhookDelivererRequest[] = [];

  async deliver(delivery: WebhookDelivererRequest): Promise<WebhookDelivererResult> {
    this.requests.push(delivery);
    return { responseStatus: 204, responseExcerpt: '', error: null };
  }
}

describe('webhook delivery pipeline', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `webhook-pipeline-${testRunId}@ship.local`;
  const clientId = `ship_app_webhook_pipeline_${testRunId}`;
  let workspaceId: string;
  let userId: string;
  let appId: string;
  let deliverer: FakeWebhookDeliverer;
  let restoreWebhookDependencies: (() => void) | null = null;

  beforeAll(async () => {
    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Webhook Pipeline ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Webhook Pipeline User')
       RETURNING id`,
      [email]
    );
    userId = requireFirstRow(userResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [workspaceId, userId]
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
       VALUES ($1, $2, 'Webhook Pipeline Test App', $3, 'test-secret-hash', $4, $5)
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
    resetWebhookBootstrapForTests();
    bootstrapWebhooks();
    await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_subscriptions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    deliverer = new FakeWebhookDeliverer();
    restoreWebhookDependencies = configureWebhookServiceDependencies({
      deliverer,
      validateTargetUrl: async () => {},
    });
    await createWebhookSubscription({
      appId,
      workspaceId,
      event: 'document.created',
      targetUrl: `https://hooks.example.test/${crypto.randomUUID()}`,
      readSubjectUserId: userId,
      readSubjectScopes: ['documents:read', 'webhooks:manage'],
      readContextSource: 'portal_session',
    });
  });

  afterEach(() => {
    restoreWebhookDependencies?.();
    restoreWebhookDependencies = null;
    resetWebhookBootstrapForTests();
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

  it('delivers after enqueue and explicit dispatch', async () => {
    const documentId = await insertDocument();
    const idempotencyKey = `document.created:pipeline-enqueue-${testRunId}`;
    const enqueued = await enqueueWebhookEvent({
      type: 'document.created',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: eventPayload(documentId),
      resource: eventResource(documentId),
    });
    expect(enqueued.deliveryIds).toHaveLength(1);

    await dispatchWebhookDeliveries(enqueued.deliveryIds);

    expect(deliverer.requests).toHaveLength(1);
    expect(deliverer.requests[0]?.headers['Idempotency-Key']).toBe(idempotencyKey);
  });

  it('delivers after domain mutation publish and commit dispatch', async () => {
    const documentId = await insertDocument();
    const idempotencyKey = `document.created:pipeline-mutation-${testRunId}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const webhook = await publishDomainWebhookInTransaction({
        type: 'document.created',
        workspace_id: workspaceId,
        idempotency_key: idempotencyKey,
        payload: eventPayload(documentId),
        resource: eventResource(documentId),
      }, client);
      await client.query('COMMIT');
      commitDomainWebhooks(webhook.deliveryIds);
      await dispatchWebhookDeliveries(webhook.deliveryIds);
    } finally {
      client.release();
    }

    expect(deliverer.requests).toHaveLength(1);
    expect(deliverer.requests[0]?.headers['Idempotency-Key']).toBe(idempotencyKey);
  });

  async function insertDocument(): Promise<string> {
    const result = await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'wiki', $2, $3, $4, 'workspace')
       RETURNING id`,
      [workspaceId, `pipeline proof ${crypto.randomUUID()}`, {}, userId]
    );
    return requireFirstRow(result.rows).id;
  }

  function eventPayload(documentId: string) {
    return {
      document: {
        id: documentId,
        title: 'pipeline proof',
        document_type: 'wiki',
        api_url: `/api/v1/documents/${documentId}`,
        ui_url: `/documents/${documentId}`,
      },
      actor: { id: userId },
    };
  }

  function eventResource(documentId: string) {
    return {
      kind: 'document' as const,
      id: documentId,
      document_type: 'wiki' as const,
    };
  }

});
