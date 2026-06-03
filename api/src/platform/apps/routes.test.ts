// OAuth app control-plane tests exercise session auth, secrets, webhooks, and audit visibility.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import type { WebhookDelivererRequest, WebhookDelivererResult, IWebhookDeliverer } from '../webhooks/deliverer.js';
import { createApp } from '../../app.js';
import { pool } from '../../db/client.js';
import { expectJsonBody } from '../../test/expect-json-body.js';
import { type IdRow, requireFirstRow } from '../../test/pg-result.js';
import {
  configureWebhookServiceDependencies,
  dispatchWebhookDeliveries,
  enqueueWebhookEvent,
} from '../webhooks/service.js';

const OAuthAppCreatedSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    name: z.string(),
    client_id: z.string().startsWith('ship_app_'),
    client_secret_id: z.string().uuid(),
    client_secret: z.string().startsWith('ship_secret_'),
    redirect_uris: z.array(z.string()),
    requested_scopes: z.array(z.string()),
    is_active: z.boolean(),
    created_at: z.string().or(z.date()),
    updated_at: z.string().or(z.date()),
    warning: z.string(),
  }),
});

const OAuthAppsListSchema = z.object({
  success: z.literal(true),
  data: z.object({
    apps: z.array(z.object({
      id: z.string().uuid(),
      name: z.string(),
      client_id: z.string().startsWith('ship_app_'),
      redirect_uris: z.array(z.string()),
      requested_scopes: z.array(z.string()),
      is_active: z.boolean(),
      created_at: z.string(),
      updated_at: z.string(),
      secrets: z.array(z.object({
        id: z.string().uuid(),
        status: z.enum(['active', 'grace', 'revoked']),
        expires_at: z.string().nullable(),
        revoked_at: z.string().nullable(),
        created_at: z.string(),
      })),
    })),
  }),
});

const OAuthSecretRotationSchema = z.object({
  success: z.literal(true),
  data: z.object({
    app_id: z.string().uuid(),
    client_secret_id: z.string().uuid(),
    client_secret: z.string().startsWith('ship_secret_'),
    previous_secret_expires_at: z.string().nullable(),
    warning: z.string(),
  }),
});

const OAuthSecretSummarySchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    status: z.enum(['active', 'grace', 'revoked']),
    expires_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    created_at: z.string(),
  }),
});

const PortalWebhookCreatedSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    event: z.string(),
    target_url: z.string(),
    active: z.boolean(),
    created_at: z.string(),
    signing_secret: z.string(),
  }),
});

const PortalListPageSchema = z.object({
  success: z.literal(true),
  data: z.object({
    data: z.array(z.record(z.unknown())),
    next_cursor: z.string().nullable(),
  }),
});

const InternalErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

type CapturedWebhookDelivery = {
  headers: Record<string, string>;
  rawBody: string;
};

class CapturingWebhookDeliverer implements IWebhookDeliverer {
  readonly deliveries: CapturedWebhookDelivery[] = [];
  private readonly results: WebhookDelivererResult[] = [];

  queue(result: WebhookDelivererResult): void {
    this.results.push(result);
  }

  async deliver(delivery: WebhookDelivererRequest): Promise<WebhookDelivererResult> {
    this.deliveries.push({
      headers: delivery.headers,
      rawBody: delivery.rawBody,
    });
    return this.results.shift() ?? {
      responseStatus: 200,
      responseExcerpt: '{"ok":true}',
      error: null,
    };
  }
}

describe('OAuth app control plane', () => {
  const app = createApp();
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const adminEmail = `oauth-admin-${testRunId}@ship.local`;
  const memberEmail = `oauth-member-${testRunId}@ship.local`;

  let workspaceId: string;
  let adminUserId: string;
  let memberUserId: string;
  let adminSessionId: string;
  let memberSessionId: string;
  let adminApiToken: string;
  let deliverer: CapturingWebhookDeliverer;
  let restoreWebhookDependencies: (() => void) | null = null;

  beforeAll(async () => {
    deliverer = new CapturingWebhookDeliverer();
    restoreWebhookDependencies = configureWebhookServiceDependencies({
      deliverer,
      validateTargetUrl: async () => {},
    });

    const workspaceResult = await pool.query<IdRow>(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING id',
      [`OAuth Apps ${testRunId}`]
    );
    workspaceId = requireFirstRow(workspaceResult.rows).id;

    const adminResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'OAuth Admin')
       RETURNING id`,
      [adminEmail]
    );
    adminUserId = requireFirstRow(adminResult.rows).id;

    const memberResult = await pool.query<IdRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'OAuth Member')
       RETURNING id`,
      [memberEmail]
    );
    memberUserId = requireFirstRow(memberResult.rows).id;

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
      [workspaceId, adminUserId, memberUserId]
    );

    adminSessionId = crypto.randomBytes(32).toString('hex');
    memberSessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, NOW() + interval '1 hour'),
              ($4, $5, $3, NOW() + interval '1 hour')`,
      [adminSessionId, adminUserId, workspaceId, memberSessionId, memberUserId]
    );

    adminApiToken = `ship_${crypto.randomBytes(32).toString('hex')}`;
    await pool.query(
      `INSERT INTO api_tokens (user_id, workspace_id, name, token_hash, token_prefix, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        adminUserId,
        workspaceId,
        `OAuth app creation ${testRunId}`,
        crypto.createHash('sha256').update(adminApiToken).digest('hex'),
        adminApiToken.slice(0, 12),
        ['documents:read'],
      ]
    );
  });

  afterAll(async () => {
    restoreWebhookDependencies?.();
    await pool.query('DELETE FROM webhook_deliveries WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_events WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM webhook_subscriptions WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM public_api_audit_logs WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM audit_logs WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_app_secrets WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM oauth_apps WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM api_tokens WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM sessions WHERE id = ANY($1)', [[adminSessionId, memberSessionId]]);
    await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[adminUserId, memberUserId]]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
  });

  it('lets a workspace admin create an OAuth app with a shown-once secret', async () => {
    const body = await createOAuthAppViaRoute('Docs Demo App', ['documents:read']);
    const appResult = await pool.query<{
      client_id: string;
      client_secret_hash: string;
      requested_scopes: string[];
    }>(
      'SELECT client_id, client_secret_hash, requested_scopes FROM oauth_apps WHERE id = $1',
      [body.data.id]
    );
    const row = requireFirstRow(appResult.rows);

    expect(row.client_id).toBe(body.data.client_id);
    expect(row.client_secret_hash).not.toBe(body.data.client_secret);
    expect(JSON.stringify(row)).not.toContain(body.data.client_secret);
    await expect(argon2.verify(row.client_secret_hash, body.data.client_secret)).resolves.toBe(true);
    expect(row.requested_scopes).toEqual(['documents:read']);

    const secretResult = await pool.query<{ id: string; secret_hash: string; status: string }>(
      'SELECT id, secret_hash, status FROM oauth_app_secrets WHERE app_id = $1',
      [body.data.id]
    );
    const secret = requireFirstRow(secretResult.rows);
    expect(secret.id).toBe(body.data.client_secret_id);
    expect(secret.status).toBe('active');
    await expect(argon2.verify(secret.secret_hash, body.data.client_secret)).resolves.toBe(true);

    const auditResult = await pool.query<{ details: Record<string, unknown> | null }>(
      `SELECT details
       FROM audit_logs
       WHERE action = 'oauth_app.created'
         AND resource_type = 'oauth_app'
         AND resource_id = $1`,
      [body.data.id]
    );
    const auditDetails = requireFirstRow(auditResult.rows).details;
    expect(JSON.stringify(auditDetails)).not.toContain(body.data.client_secret);
  });

  it('lists apps and secret metadata without raw secrets', async () => {
    const created = await createOAuthAppViaRoute('Listable App', ['documents:read']);
    const response = await request(app)
      .get('/api/platform/apps')
      .set('Cookie', `session_id=${adminSessionId}`);
    expect(JSON.stringify(response.body)).not.toContain(created.data.client_secret);

    const body = expectJsonBody(response, 200, OAuthAppsListSchema);
    const listed = body.data.apps.find(row => row.id === created.data.id);
    expect(listed).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(created.data.client_secret);
    expect(listed?.secrets).toContainEqual(expect.objectContaining({
      id: created.data.client_secret_id,
      status: 'active',
    }));
  });

  it('rotates secrets with a 24-hour grace period and revokes grace secrets', async () => {
    const created = await createOAuthAppViaRoute('Rotating App', ['documents:read']);
    const csrf = await getCsrfCookie();
    const rotateStartedAt = Date.now();
    const rotateResponse = await request(app)
      .post(`/api/platform/apps/${created.data.id}/secrets/rotate`)
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({ revoke_previous_immediately: false });
    const rotateFinishedAt = Date.now();

    const rotated = expectJsonBody(rotateResponse, 200, OAuthSecretRotationSchema);
    expect(rotated.data.previous_secret_expires_at).not.toBeNull();
    expect(rotated.data.client_secret).not.toBe(created.data.client_secret);
    const graceExpiryMs = new Date(rotated.data.previous_secret_expires_at ?? '').getTime();
    expect(graceExpiryMs).toBeGreaterThanOrEqual(rotateStartedAt + 24 * 60 * 60 * 1000 - 1_000);
    expect(graceExpiryMs).toBeLessThanOrEqual(rotateFinishedAt + 24 * 60 * 60 * 1000 + 1_000);

    const secretRows = await pool.query<{
      id: string;
      secret_hash: string;
      status: string;
      expires_at: Date | null;
    }>(
      `SELECT id, secret_hash, status, expires_at
       FROM oauth_app_secrets
       WHERE app_id = $1
       ORDER BY created_at ASC`,
      [created.data.id]
    );
    const oldSecret = secretRows.rows.find(row => row.id === created.data.client_secret_id);
    const newSecret = secretRows.rows.find(row => row.id === rotated.data.client_secret_id);
    expect(oldSecret?.status).toBe('grace');
    expect(oldSecret?.expires_at).not.toBeNull();
    expect(oldSecret?.expires_at?.getTime()).toBe(graceExpiryMs);
    expect(newSecret?.status).toBe('active');
    await expect(argon2.verify(oldSecret?.secret_hash ?? '', created.data.client_secret)).resolves.toBe(true);
    await expect(argon2.verify(newSecret?.secret_hash ?? '', rotated.data.client_secret)).resolves.toBe(true);

    const auditResult = await pool.query<{ details: Record<string, unknown> | null }>(
      `SELECT details
       FROM audit_logs
       WHERE action = 'oauth_app.secret_rotated'
         AND resource_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [created.data.id]
    );
    expect(JSON.stringify(requireFirstRow(auditResult.rows).details)).not.toContain(rotated.data.client_secret);

    await pool.query(
      `UPDATE oauth_app_secrets
       SET expires_at = NOW() - interval '1 second'
       WHERE id = $1`,
      [created.data.client_secret_id]
    );
    const listResponse = await request(app)
      .get('/api/platform/apps')
      .set('Cookie', `session_id=${adminSessionId}`);
    const listed = expectJsonBody(listResponse, 200, OAuthAppsListSchema);
    const listedApp = listed.data.apps.find(row => row.id === created.data.id);
    const expiredSecret = listedApp?.secrets.find(secret => secret.id === created.data.client_secret_id);
    expect(expiredSecret?.status).toBe('revoked');
    expect(typeof expiredSecret?.revoked_at).toBe('string');

    const revokeResponse = await request(app)
      .post(`/api/platform/apps/${created.data.id}/secrets/${created.data.client_secret_id}/revoke`)
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({});
    const revoked = expectJsonBody(revokeResponse, 200, OAuthSecretSummarySchema);
    expect(revoked.data.status).toBe('revoked');

    const activeRevokeResponse = await request(app)
      .post(`/api/platform/apps/${created.data.id}/secrets/${rotated.data.client_secret_id}/revoke`)
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({});
    const activeRevoke = expectJsonBody(activeRevokeResponse, 400, InternalErrorSchema);
    expect(activeRevoke.error.code).toBe('VALIDATION_ERROR');
  });

  it('rotates secrets with immediate previous-secret revocation', async () => {
    const created = await createOAuthAppViaRoute('Immediate Rotation App', ['documents:read']);
    const csrf = await getCsrfCookie();
    const rotateResponse = await request(app)
      .post(`/api/platform/apps/${created.data.id}/secrets/rotate`)
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({ revoke_previous_immediately: true });

    const rotated = expectJsonBody(rotateResponse, 200, OAuthSecretRotationSchema);
    expect(rotated.data.previous_secret_expires_at).toBeNull();
    const oldSecret = await pool.query<{ status: string; revoked_at: Date | null }>(
      'SELECT status, revoked_at FROM oauth_app_secrets WHERE id = $1',
      [created.data.client_secret_id]
    );
    const revokedOldSecret = requireFirstRow(oldSecret.rows);
    expect(revokedOldSecret.status).toBe('revoked');
    expect(revokedOldSecret.revoked_at).toBeInstanceOf(Date);
  });

  it('allows HTTP localhost redirect URIs for local development', async () => {
    const csrf = await getCsrfCookie();
    const response = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Localhost App',
        redirect_uris: ['http://localhost:5173/callback'],
        requested_scopes: ['documents:read'],
      });

    const body = expectJsonBody(response, 201, OAuthAppCreatedSchema);
    expect(body.data.redirect_uris).toEqual(['http://localhost:5173/callback']);
  });

  it('rejects invalid requested scopes and redirect URIs', async () => {
    const csrf = await getCsrfCookie();
    const invalidScopeResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Bad Scope App',
        redirect_uris: ['https://example.test/callback'],
        requested_scopes: ['me:read'],
      });

    const invalidScope = expectJsonBody(invalidScopeResponse, 400, InternalErrorSchema);
    expect(invalidScope.error.code).toBe('VALIDATION_ERROR');

    const invalidUriResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Bad URI App',
        redirect_uris: ['not-a-url'],
        requested_scopes: ['documents:read'],
      });

    const invalidUri = expectJsonBody(invalidUriResponse, 400, InternalErrorSchema);
    expect(invalidUri.error.code).toBe('VALIDATION_ERROR');

    const unsafeSchemeResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Unsafe Scheme App',
        redirect_uris: ['javascript:alert(1)'],
        requested_scopes: ['documents:read'],
      });

    const unsafeScheme = expectJsonBody(unsafeSchemeResponse, 400, InternalErrorSchema);
    expect(unsafeScheme.error.code).toBe('VALIDATION_ERROR');

    const fragmentResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Fragment App',
        redirect_uris: ['https://example.test/callback#frag'],
        requested_scopes: ['documents:read'],
      });

    const fragment = expectJsonBody(fragmentResponse, 400, InternalErrorSchema);
    expect(fragment.error.code).toBe('VALIDATION_ERROR');

    const publicHttpResponse = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Public HTTP App',
        redirect_uris: ['http://example.test/callback'],
        requested_scopes: ['documents:read'],
      });

    const publicHttp = expectJsonBody(publicHttpResponse, 400, InternalErrorSchema);
    expect(publicHttp.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not let legacy API tokens create OAuth apps', async () => {
    const response = await request(app)
      .post('/api/platform/apps')
      .set('Authorization', `Bearer ${adminApiToken}`)
      .send({
        name: 'API Token App',
        redirect_uris: ['https://example.test/callback'],
        requested_scopes: ['documents:read'],
      });

    const body = expectJsonBody(response, 403, InternalErrorSchema);
    expect(body.error.message).toBe('Session authentication required for OAuth app control plane');
  });

  it('forbids non-admin workspace members from creating apps', async () => {
    const csrf = await getCsrfCookie();
    const response = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${memberSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name: 'Member App',
        redirect_uris: ['https://example.test/callback'],
        requested_scopes: ['documents:read'],
      });

    const body = expectJsonBody(response, 403, InternalErrorSchema);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('manages webhook subscriptions, DLQ deliveries, replay, and audit rows per app', async () => {
    const created = await createOAuthAppViaRoute('Webhook Ops App', ['documents:read', 'webhooks:manage']);
    const csrf = await getCsrfCookie();
    const subscriptionResponse = await request(app)
      .post(`/api/platform/apps/${created.data.id}/webhooks`)
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        event: 'document.created',
        target_url: 'https://hooks.example.test/ops',
    });
    const subscription = expectJsonBody(subscriptionResponse, 201, PortalWebhookCreatedSchema);
    expect(subscription.data.signing_secret).toMatch(/^ship_whsec_/);

    const subscriptionsResponse = await request(app)
      .get(`/api/platform/apps/${created.data.id}/webhooks`)
      .set('Cookie', `session_id=${adminSessionId}`);
    const subscriptions = expectJsonBody(subscriptionsResponse, 200, PortalListPageSchema);
    expect(subscriptions.data.data).toContainEqual(expect.objectContaining({
      id: subscription.data.id,
      event: 'document.created',
    }));

    const idempotencyKey = `document.created:portal-${testRunId}`;
    const documentId = requireFirstRow((await pool.query<IdRow>(
      `INSERT INTO documents (
         workspace_id, document_type, title, properties, created_by, visibility
       )
       VALUES ($1, 'wiki', $2, $3, $4, 'workspace')
       RETURNING id`,
      [workspaceId, `portal dlq proof ${testRunId}`, {}, adminUserId]
    )).rows).id;
    deliverer.queue({ responseStatus: 400, responseExcerpt: 'bad request', error: null });
    const deliveryStart = deliverer.deliveries.length;
    const enqueued = await enqueueWebhookEvent({
      type: 'document.created',
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      resource: {
        kind: 'document',
        id: documentId,
        document_type: 'wiki',
      },
      payload: {
        document: {
          id: documentId,
          title: 'portal dlq proof',
          document_type: 'wiki',
          api_url: `/api/v1/documents/${documentId}`,
          ui_url: `/documents/${documentId}`,
        },
        actor: { id: adminUserId },
      },
    });
    await dispatchWebhookDeliveries(enqueued.deliveryIds);

    const deliveriesResponse = await request(app)
      .get(`/api/platform/apps/${created.data.id}/webhooks/deliveries`)
      .set('Cookie', `session_id=${adminSessionId}`);
    const deliveries = expectJsonBody(deliveriesResponse, 200, PortalListPageSchema);
    const dlqDelivery = deliveries.data.data.find(row => row.idempotency_key === idempotencyKey);
    expect(dlqDelivery).toEqual(expect.objectContaining({
      status: 'dlq',
      response_status: 400,
    }));
    if (!dlqDelivery || typeof dlqDelivery.id !== 'string') {
      throw new Error('Expected DLQ delivery with string id');
    }

    deliverer.queue({ responseStatus: 200, responseExcerpt: '{"ok":true}', error: null });
    const replayResponse = await request(app)
      .post(`/api/platform/apps/${created.data.id}/webhooks/deliveries/${dlqDelivery.id}/replay`)
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({});
    const replay = expectJsonBody(replayResponse, 202, z.object({
      success: z.literal(true),
      data: z.object({
        id: z.string().uuid(),
        status: z.literal('succeeded'),
        idempotency_key: z.string(),
        replay_of_delivery_id: z.string().uuid(),
      }).passthrough(),
    }));
    expect(replay.data.idempotency_key).toBe(idempotencyKey);
    expect(headerValue(deliverer.deliveries[deliveryStart]?.headers ?? {}, 'Idempotency-Key')).toBe(idempotencyKey);
    expect(headerValue(deliverer.deliveries[deliveryStart + 1]?.headers ?? {}, 'Idempotency-Key')).toBe(idempotencyKey);

    await pool.query(
      `INSERT INTO public_api_audit_logs (
         request_id,
         app_id,
         client_id,
         user_id,
         workspace_id,
         method,
         route,
         scope_used,
         status,
         latency_ms,
         error_code,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, 'GET', '/api/v1/documents', 'documents:read', 200, 12, NULL, NOW() - interval '1 second'),
              ($6, $2, $3, $4, $5, 'POST', '/api/v1/documents', 'documents:write', 429, 7, 'rate_limited', NOW())`,
      [
        `req-ok-${testRunId}`,
        created.data.id,
        created.data.client_id,
        adminUserId,
        workspaceId,
        `req-rate-${testRunId}`,
      ]
    );

    const auditResponse = await request(app)
      .get(`/api/platform/apps/${created.data.id}/audit`)
      .query({ limit: 1 })
      .set('Cookie', `session_id=${adminSessionId}`);
    const audit = expectJsonBody(auditResponse, 200, PortalListPageSchema);
    expect(audit.data.data).toHaveLength(1);
    expect(audit.data.next_cursor).toEqual(expect.any(String));
    expect(audit.data.data[0]).toEqual(expect.objectContaining({
      route: '/api/v1/documents',
      request_id: `req-rate-${testRunId}`,
      scope_used: 'documents:write',
      status: 429,
      rate_limited: true,
    }));
    expect(JSON.stringify(audit.data.data)).not.toContain(created.data.client_secret);
  });

  async function getCsrfCookie(): Promise<{ token: string; cookie: string }> {
    const response = await request(app).get('/api/csrf-token');
    const token = z.object({ token: z.string() }).parse(response.body).token;
    const cookie = response.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    return { token, cookie };
  }

  async function createOAuthAppViaRoute(name: string, requestedScopes: string[]) {
    const csrf = await getCsrfCookie();
    const response = await request(app)
      .post('/api/platform/apps')
      .set('Cookie', `${csrf.cookie}; session_id=${adminSessionId}`)
      .set('x-csrf-token', csrf.token)
      .send({
        name,
        redirect_uris: ['https://example.test/callback'],
        requested_scopes: requestedScopes,
      });
    return expectJsonBody(response, 201, OAuthAppCreatedSchema);
  }
});

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}
