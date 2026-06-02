// Public webhook API tests prove signed document.created delivery and replay idempotency.
import crypto from 'node:crypto';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  PublicDocumentSchema,
  PublicApiErrorSchema,
  PublicWebhookDeliveriesListResponseSchema,
  PublicWebhookSubscriptionCreatedSchema,
  PublicWebhookSubscriptionsListResponseSchema,
} from '@ship/shared';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/client.js';
import { createOAuthAccessToken } from '../../oauth/tokens.js';
import { enqueueWebhookEvent } from '../../webhooks/service.js';
import { expectJsonBody } from '../../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../../test/pg-result.js';

describe('/api/v1/webhooks', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `public-webhooks-${testRunId}@ship.local`;
  const clientId = `ship_app_webhooks_${testRunId}`;

  let workspaceId: string;
  let userId: string;
  let appId: string;
  let token: string;
  let server: http.Server;
  let targetUrl: string;
  const deliveries: Array<{
    headers: http.IncomingHttpHeaders;
    rawBody: string;
  }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        deliveries.push({
          headers: req.headers,
          rawBody: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    targetUrl = await listen(server);

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
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
    const createResponse = await request(app)
      .post('/api/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'webhook hello' });
    const document = expectJsonBody(createResponse, 201, PublicDocumentSchema);
    const idempotencyKey = `document.created:${document.id}`;

    const firstDelivery = await waitForVerifiedDelivery(subscription.signing_secret, idempotencyKey, deliveryStart);
    expect(firstDelivery.headers['ship-event-type']).toBe('document.created');
    expect(firstDelivery.headers['idempotency-key']).toBe(idempotencyKey);
    expect(verifySignature(firstDelivery.headers['ship-signature'], firstDelivery.rawBody, subscription.signing_secret)).toBe(true);

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

    const replayDelivery = await waitForVerifiedDelivery(subscription.signing_secret, idempotencyKey, replayStart);
    expect(replayDelivery.headers['idempotency-key']).toBe(idempotencyKey);
    expect(verifySignature(replayDelivery.headers['ship-signature'], replayDelivery.rawBody, subscription.signing_secret)).toBe(true);
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

  async function waitForVerifiedDelivery(
    secret: string,
    idempotencyKey: string,
    startIndex: number
  ): Promise<{
    headers: http.IncomingHttpHeaders;
    rawBody: string;
  }> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const delivery = deliveries.slice(startIndex).find(candidate => (
        candidate.headers['ship-event-type'] === 'document.created' &&
        candidate.headers['idempotency-key'] === idempotencyKey &&
        verifySignature(candidate.headers['ship-signature'], candidate.rawBody, secret)
      ));
      if (delivery) return delivery;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for verified webhook delivery ${idempotencyKey}`);
  }
});

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Webhook test server did not bind to a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/webhook`);
    });
  });
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
