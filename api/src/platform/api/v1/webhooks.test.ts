// Public webhook API tests prove signed delivery, cursor listing, idempotency, and replay.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  PublicApiErrorSchema,
  PublicWebhookDeliveriesListResponseSchema,
  PublicWebhookSubscriptionCreatedSchema,
  PublicWebhookSubscriptionsListResponseSchema,
} from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import { createOAuthAccessToken } from '../../oauth/tokens.js';
import type { IWebhookDeliverer, WebhookDelivererRequest } from '../../webhooks/deliverer.js';
import {
  configureWebhookServiceDependencies,
  dispatchWebhookDeliveries,
  enqueueWebhookEvent,
} from '../../webhooks/service.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';

type CapturedWebhookDelivery = {
  headers: Record<string, string>;
  rawBody: string;
};

class CapturingWebhookDeliverer implements IWebhookDeliverer {
  constructor(private readonly deliveries: CapturedWebhookDelivery[]) {}

  async deliver(delivery: WebhookDelivererRequest) {
    this.deliveries.push({
      headers: delivery.headers,
      rawBody: delivery.rawBody,
    });
    return {
      responseStatus: 200,
      responseExcerpt: '{"ok":true}',
      error: null,
    };
  }
}

describe('/api/v1/webhooks', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `public-webhooks-${testRunId}@ship.local`;
  const clientId = `ship_app_webhooks_${testRunId}`;
  const targetUrl = 'https://hooks.example.test/webhook';

  let workspaceId: string;
  let userId: string;
  let appId: string;
  let token: string;
  let restoreWebhookDependencies: (() => void) | null = null;
  const deliveries: CapturedWebhookDelivery[] = [];

  beforeAll(async () => {
    restoreWebhookDependencies = configureWebhookServiceDependencies({
      deliverer: new CapturingWebhookDeliverer(deliveries),
      validateTargetUrl: async () => {},
    });

    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`Public Webhooks ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;
    const userResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Public Webhooks User')
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
       VALUES ($1, $2, 'Public Webhooks Test App', $3, 'test-secret-hash', $4, $5)
       RETURNING id`,
      [
        workspaceId,
        userId,
        clientId,
        ['https://example.test/callback'],
        ['documents:read', 'documents:write', 'webhooks:manage'],
      ]
    );
    appId = requireFirstRow(appResult.rows).id;
    token = (await createOAuthAccessToken({
      appId,
      userId,
      workspaceId,
      grantedScopes: ['documents:read', 'documents:write', 'webhooks:manage'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })).token;
  });

  afterAll(async () => {
    restoreWebhookDependencies?.();
    await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_subscriptions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1 OR client_id = $2', [workspaceId, clientId]);
    await pool.query('DELETE FROM oauth_access_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE id = $1', [appId]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('rejects webhook target URLs with fragments', async () => {
    const response = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ event: 'document.created', target_url: 'https://example.test/callback#fragment' });

    const body = expectJsonBody(response, 400, PublicApiErrorSchema);
    expect(body.code).toBe('validation_failed');
  });

  it('pages webhook subscriptions with cursors', async () => {
    const firstResponse = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ event: 'document.created', target_url: targetUrl });
    expectJsonBody(firstResponse, 201, PublicWebhookSubscriptionCreatedSchema);

    const secondResponse = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ event: 'document.created', target_url: targetUrl });
    expectJsonBody(secondResponse, 201, PublicWebhookSubscriptionCreatedSchema);

    const pageResponse = await request(app)
      .get('/api/v1/webhooks')
      .query({ limit: 1 })
      .set('Authorization', `Bearer ${token}`);
    const firstPage = expectJsonBody(pageResponse, 200, PublicWebhookSubscriptionsListResponseSchema);
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const nextResponse = await request(app)
      .get('/api/v1/webhooks')
      .query({ limit: 1, cursor: firstPage.next_cursor })
      .set('Authorization', `Bearer ${token}`);
    const secondPage = expectJsonBody(nextResponse, 200, PublicWebhookSubscriptionsListResponseSchema);
    expect(secondPage.data).toHaveLength(1);
  });

  it('delivers signed document.created and replays with the original idempotency key', async () => {
    const subscriptionResponse = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ event: 'document.created', target_url: targetUrl });
    const subscription = expectJsonBody(subscriptionResponse, 201, PublicWebhookSubscriptionCreatedSchema);

    const deliveryStart = deliveries.length;
    const documentId = crypto.randomUUID();
    const idempotencyKey = `document.created:${documentId}`;
    const enqueued = await enqueueWebhookEvent({
      type: 'document.created',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: {
        document: {
          id: documentId,
          title: 'webhook hello',
          document_type: 'wiki',
          api_url: `/api/v1/documents/${documentId}`,
          ui_url: `/documents/${documentId}`,
        },
        actor: { id: userId },
      },
    });
    expect(enqueued.deliveryIds.length).toBeGreaterThan(0);
    await dispatchWebhookDeliveries(enqueued.deliveryIds);

    const firstDelivery = findVerifiedDelivery(subscription.signing_secret, idempotencyKey, deliveryStart);
    expect(headerValue(firstDelivery.headers, 'Ship-Event-Type')).toBe('document.created');
    expect(headerValue(firstDelivery.headers, 'Idempotency-Key')).toBe(idempotencyKey);
    expect(verifySignature(
      headerValue(firstDelivery.headers, 'Ship-Signature'),
      firstDelivery.rawBody,
      subscription.signing_secret
    )).toBe(true);

    const listResponse = await request(app)
      .get('/api/v1/webhooks/deliveries')
      .set('Authorization', `Bearer ${token}`);
    const deliveryPage = expectJsonBody(listResponse, 200, PublicWebhookDeliveriesListResponseSchema);
    const delivery = deliveryPage.data.find(row => (
      row.idempotency_key === idempotencyKey && row.subscription_id === subscription.id
    ));
    expect(delivery?.status).toBe('succeeded');
    if (!delivery) throw new Error('Expected webhook delivery row');

    const replayStart = deliveries.length;
    const replayResponse = await request(app)
      .post(`/api/v1/webhooks/deliveries/${delivery.id}/replay`)
      .set('Authorization', `Bearer ${token}`);
    expect(replayResponse.status).toBe(202);

    const replayDelivery = findVerifiedDelivery(subscription.signing_secret, idempotencyKey, replayStart);
    expect(headerValue(replayDelivery.headers, 'Idempotency-Key')).toBe(idempotencyKey);
    expect(verifySignature(
      headerValue(replayDelivery.headers, 'Ship-Signature'),
      replayDelivery.rawBody,
      subscription.signing_secret
    )).toBe(true);
  });

  it('does not create duplicate delivery attempts for duplicate event publication', async () => {
    const subscriptionResponse = await request(app)
      .post('/api/v1/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ event: 'document.created', target_url: targetUrl });
    expectJsonBody(subscriptionResponse, 201, PublicWebhookSubscriptionCreatedSchema);

    const idempotencyKey = `document.created:duplicate-${testRunId}`;
    const event = {
      type: 'document.created' as const,
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      payload: {
        document: {
          id: crypto.randomUUID(),
          title: 'duplicate proof',
          document_type: 'wiki',
          api_url: '/api/v1/documents/duplicate-proof',
          ui_url: '/documents/duplicate-proof',
        },
        actor: { id: userId },
      },
    };

    const first = await enqueueWebhookEvent(event);
    const second = await enqueueWebhookEvent(event);

    expect(first.deliveryIds.length).toBeGreaterThan(0);
    expect(second.deliveryIds).toHaveLength(0);

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM webhook_deliveries
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    expect(Number(count.rows[0]?.count)).toBe(first.deliveryIds.length);
  });

  function findVerifiedDelivery(
    secret: string,
    idempotencyKey: string,
    startIndex: number
  ): {
    headers: Record<string, string>;
    rawBody: string;
  } {
    const delivery = deliveries.slice(startIndex).find(candidate => (
      headerValue(candidate.headers, 'Ship-Event-Type') === 'document.created' &&
      headerValue(candidate.headers, 'Idempotency-Key') === idempotencyKey &&
      verifySignature(headerValue(candidate.headers, 'Ship-Signature'), candidate.rawBody, secret)
    ));
    if (delivery) return delivery;
    throw new Error(`Timed out waiting for verified webhook delivery ${idempotencyKey}`);
  }
});

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

function verifySignature(
  header: string | string[] | undefined,
  rawBody: string,
  secret: string
): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  const parts: Record<string, string> = {};
  for (const part of value.split(',')) {
    const [key, partValue] = part.split('=', 2);
    if (key && partValue) parts[key] = partValue;
  }
  const timestamp = parts.t;
  const actual = parts.v1;
  if (!timestamp || !actual) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return expected === actual;
}
