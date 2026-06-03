// Webhook service owns subscriptions, event persistence, delivery, retry, and replay.
import dns from 'node:dns/promises';
import net from 'node:net';
import type {
  DocumentType,
  PublicApiScope,
  PublicWebhookDelivery,
  PublicWebhookSubscription,
  PublicWebhookSubscriptionCreated,
  WebhookDeliveryStatus,
  WebhookEvent,
  WebhookEventType,
} from '@ship/shared';
import type { Pool, PoolClient } from 'pg';
import type { PublicCursorPayload } from '../api/v1/pagination.js';
import { isProduction } from '../../config/runtime.js';
import { pool } from '../../db/client.js';
import { requireWorkspaceMembership } from '../../services/document-access.js';
import { authorize } from '../../security/capabilities.js';
import type { Principal } from '../../security/principal.js';
import { logHotError } from '../../utils/hot-log.js';
import {
  FetchWebhookDeliverer,
  type IWebhookDeliverer,
} from './deliverer.js';
import { webhookEventBus } from './event-bus.js';
import {
  expectedDocumentTypeForWebhookEvent,
  parseWebhookEvent,
  readScopeForWebhookEvent,
} from './events.js';
import { WEBHOOK_IDEMPOTENCY_KEY_HEADER } from './headers.js';
import { WEBHOOK_MAX_FAILED_ATTEMPTS, WEBHOOK_RETRY_DELAYS_MS } from './retry-schedule.js';
import {
  SHIP_SIGNATURE_HEADER,
  decryptWebhookSigningSecret,
  encryptWebhookSigningSecret,
  generateWebhookSigningSecret,
  hashWebhookSigningSecret,
  signWebhookPayload,
} from './signature.js';

const RESPONSE_EXCERPT_MAX_LENGTH = 1_000;
const WEBHOOK_DELIVERY_TIMEOUT_MS = 5_000;
const MIN_STALE_SENDING_MS = 30_000;

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export type WebhookClock = {
  now(): Date;
  nowMs(): number;
};

export type WebhookServiceDependencies = {
  clock: WebhookClock;
  db: QueryRunner;
  deliverer: IWebhookDeliverer;
  deliveryTimeoutMs: number;
  validateTargetUrl: (targetUrl: string) => Promise<void>;
};

const systemClock: WebhookClock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

let webhookServiceDependencies: WebhookServiceDependencies = {
  clock: systemClock,
  db: pool,
  deliverer: new FetchWebhookDeliverer(),
  deliveryTimeoutMs: WEBHOOK_DELIVERY_TIMEOUT_MS,
  validateTargetUrl: validateWebhookTargetUrl,
};

export function configureWebhookServiceDependencies(
  overrides: Partial<WebhookServiceDependencies>
): () => void {
  const previous = webhookServiceDependencies;
  webhookServiceDependencies = {
    ...webhookServiceDependencies,
    ...overrides,
  };
  return () => {
    webhookServiceDependencies = previous;
  };
}

function webhookDb(): QueryRunner {
  return webhookServiceDependencies.db;
}

export class WebhookTargetUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookTargetUrlError';
  }
}

export class WebhookSubscriptionScopeError extends Error {
  constructor(readonly missingScope: PublicApiScope) {
    super(`Missing required webhook read scope: ${missingScope}`);
    this.name = 'WebhookSubscriptionScopeError';
  }
}

export function isWebhookSubscriptionScopeError(error: unknown): error is WebhookSubscriptionScopeError {
  return error instanceof WebhookSubscriptionScopeError;
}

export type WebhookReadContextSource = 'public_oauth' | 'portal_session';

type WebhookSubscriptionReadContextSource = 'legacy' | WebhookReadContextSource;

type WebhookSubscriptionRow = {
  id: string;
  app_id: string;
  client_id: string;
  app_is_active: boolean;
  workspace_id: string;
  event_type: WebhookEventType;
  target_url: string;
  read_subject_user_id: string | null;
  read_subject_scopes: PublicApiScope[];
  read_context_source: WebhookSubscriptionReadContextSource;
  read_context_version: number;
  signing_secret_ciphertext: string;
  signing_secret_iv: string;
  signing_secret_tag: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

type WebhookEventRow = {
  id: string;
  workspace_id: string;
  event_type: WebhookEventType;
  idempotency_key: string;
  payload: Record<string, unknown>;
  resource_kind: 'document' | null;
  resource_id: string | null;
  resource_document_type: DocumentType | null;
  created_at: Date;
};

type WebhookDeliveryRow = {
  id: string;
  subscription_id: string;
  event_id: string;
  workspace_id: string;
  attempt_number: number;
  status: WebhookDeliveryStatus;
  idempotency_key: string;
  response_status: number | null;
  response_excerpt: string | null;
  latency_ms: number | null;
  next_attempt_at: Date | null;
  replay_of_delivery_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type DeliveryContextRow = WebhookDeliveryRow & {
  event_type: WebhookEventType;
  event_payload: Record<string, unknown>;
  event_created_at: Date;
  target_url: string;
  signing_secret_ciphertext: string;
  signing_secret_iv: string;
  signing_secret_tag: string;
};

export async function createWebhookSubscription(input: {
  appId: string;
  workspaceId: string;
  event: WebhookEventType;
  targetUrl: string;
  readSubjectUserId: string;
  readSubjectScopes: readonly PublicApiScope[];
  readContextSource: WebhookReadContextSource;
}): Promise<PublicWebhookSubscriptionCreated> {
  if (!input.readSubjectScopes.includes('webhooks:manage')) {
    throw new WebhookSubscriptionScopeError('webhooks:manage');
  }
  const requiredReadScope = readScopeForWebhookEvent(input.event);
  if (!input.readSubjectScopes.includes(requiredReadScope)) {
    throw new WebhookSubscriptionScopeError(requiredReadScope);
  }

  await webhookServiceDependencies.validateTargetUrl(input.targetUrl);
  const signingSecret = generateWebhookSigningSecret();
  const encrypted = encryptWebhookSigningSecret(signingSecret);
  const result = await webhookDb().query<WebhookSubscriptionRow>(
    `INSERT INTO webhook_subscriptions (
       app_id,
       workspace_id,
       event_type,
       target_url,
       read_subject_user_id,
       read_subject_scopes,
       read_context_source,
       read_context_version,
       signing_secret_hash,
       signing_secret_ciphertext,
       signing_secret_iv,
       signing_secret_tag
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $11)
     RETURNING id, app_id, NULL::text AS client_id, TRUE AS app_is_active,
               workspace_id, event_type, target_url, read_subject_user_id,
               read_subject_scopes, read_context_source, read_context_version,
               signing_secret_ciphertext, signing_secret_iv, signing_secret_tag,
               active, created_at, updated_at`,
    [
      input.appId,
      input.workspaceId,
      input.event,
      input.targetUrl,
      input.readSubjectUserId,
      [...input.readSubjectScopes],
      input.readContextSource,
      hashWebhookSigningSecret(signingSecret),
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
    ]
  );
  const row = requireRow(result.rows[0], 'Webhook subscription insert returned no row');
  return {
    ...publicSubscriptionFromRow(row),
    signing_secret: signingSecret,
  };
}

export async function listWebhookSubscriptions(input: {
  appId: string;
  workspaceId: string;
  limit: number;
  cursor?: PublicCursorPayload;
}): Promise<PublicWebhookSubscription[]> {
  const values: Array<string | number> = [input.appId, input.workspaceId];
  const cursorClause = input.cursor
    ? `AND (
         s.created_at < $3::timestamptz
         OR (s.created_at = $3::timestamptz AND s.id::text < $4)
       )`
    : '';
  if (input.cursor) values.push(input.cursor.timestamp, input.cursor.id);
  values.push(input.limit);
  const limitParam = values.length;

  const result = await webhookDb().query<WebhookSubscriptionRow>(
    `SELECT s.id, s.app_id, a.client_id, a.is_active AS app_is_active,
            s.workspace_id, s.event_type, s.target_url,
            s.read_subject_user_id, s.read_subject_scopes,
            s.read_context_source, s.read_context_version,
            signing_secret_ciphertext, signing_secret_iv, signing_secret_tag,
            s.active, s.created_at, s.updated_at
       FROM webhook_subscriptions s
       JOIN oauth_apps a ON a.id = s.app_id AND a.workspace_id = s.workspace_id
      WHERE s.app_id = $1
        AND s.workspace_id = $2
        ${cursorClause}
      ORDER BY s.created_at DESC, s.id::text DESC
      LIMIT $${limitParam}`,
    values
  );
  return result.rows.map(publicSubscriptionFromRow);
}

export async function listWebhookDeliveries(input: {
  appId: string;
  workspaceId: string;
  limit: number;
  cursor?: PublicCursorPayload;
}): Promise<PublicWebhookDelivery[]> {
  const values: Array<string | number> = [input.appId, input.workspaceId];
  const cursorClause = input.cursor
    ? `AND (
         d.created_at < $3::timestamptz
         OR (d.created_at = $3::timestamptz AND d.id::text < $4)
       )`
    : '';
  if (input.cursor) values.push(input.cursor.timestamp, input.cursor.id);
  values.push(input.limit);
  const limitParam = values.length;

  const result = await webhookDb().query<WebhookDeliveryRow>(
    `SELECT d.id, d.subscription_id, d.event_id, d.workspace_id, d.attempt_number,
            d.status, d.idempotency_key, d.response_status, d.response_excerpt,
            d.latency_ms, d.next_attempt_at, d.replay_of_delivery_id,
            d.created_at, d.updated_at
       FROM webhook_deliveries d
       JOIN webhook_subscriptions s ON s.id = d.subscription_id
      WHERE s.app_id = $1
        AND d.workspace_id = $2
        ${cursorClause}
      ORDER BY d.created_at DESC, d.id::text DESC
      LIMIT $${limitParam}`,
    values
  );
  return result.rows.map(publicDeliveryFromRow);
}

export async function persistAndDispatchWebhookEvent(event: WebhookEvent): Promise<void> {
  const enqueued = await enqueueWebhookEvent(event);
  await dispatchWebhookDeliveries(enqueued.deliveryIds);
}

export async function enqueueWebhookEvent(
  event: WebhookEvent,
  db: QueryRunner = webhookDb()
): Promise<{ eventId: string; deliveryIds: string[] }> {
  const parsed = parseWebhookEvent(event);
  const eventResult = await db.query<WebhookEventRow>(
    `INSERT INTO webhook_events (
       workspace_id,
       event_type,
       idempotency_key,
       payload,
       resource_kind,
       resource_id,
       resource_document_type
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, workspace_id, event_type, idempotency_key, payload,
               resource_kind, resource_id, resource_document_type, created_at`,
    [
      parsed.workspace_id,
      parsed.type,
      parsed.idempotency_key,
      parsed.payload,
      parsed.resource.kind,
      parsed.resource.id,
      parsed.resource.document_type,
    ]
  );
  const eventRow = eventResult.rows[0];
  if (!eventRow) {
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM webhook_events WHERE idempotency_key = $1',
      [parsed.idempotency_key]
    );
    return {
      eventId: requireRow(existing.rows[0], 'Webhook event conflict row not found').id,
      deliveryIds: [],
    };
  }

  const subscriptions = await db.query<WebhookSubscriptionRow>(
    `SELECT s.id, s.app_id, a.client_id, a.is_active AS app_is_active,
            s.workspace_id, s.event_type, s.target_url,
            s.read_subject_user_id, s.read_subject_scopes,
            s.read_context_source, s.read_context_version,
            s.signing_secret_ciphertext, s.signing_secret_iv, s.signing_secret_tag,
            s.active, s.created_at, s.updated_at
       FROM webhook_subscriptions s
       JOIN oauth_apps a ON a.id = s.app_id AND a.workspace_id = s.workspace_id
      WHERE s.workspace_id = $1
        AND s.event_type = $2
        AND s.active = TRUE`,
    [eventRow.workspace_id, eventRow.event_type]
  );

  const deliveryIds: string[] = [];
  for (const subscription of subscriptions.rows) {
    if (!(await shouldEnqueueWebhookForSubscription({
      db,
      event: eventRow,
      subscription,
    }))) {
      continue;
    }
    const delivery = await createDeliveryAttempt({
      subscriptionId: subscription.id,
      eventId: eventRow.id,
      workspaceId: eventRow.workspace_id,
      attemptNumber: 1,
      idempotencyKey: eventRow.idempotency_key,
      status: 'pending',
      nextAttemptAt: null,
      replayOfDeliveryId: null,
    }, db);
    if (delivery) deliveryIds.push(delivery.id);
  }

  return { eventId: eventRow.id, deliveryIds };
}

export async function dispatchWebhookDeliveries(deliveryIds: string[]): Promise<void> {
  await Promise.all(deliveryIds.map(async (deliveryId) => {
    try {
      await deliverWebhookDelivery(deliveryId);
    } catch (error) {
      logHotError('webhooks.dispatch', 'Failed to dispatch queued webhook delivery', error, {
        deliveryId,
      });
    }
  }));
}

export async function replayWebhookDelivery(input: {
  deliveryId: string;
  appId: string;
  workspaceId: string;
}): Promise<PublicWebhookDelivery> {
  const originalResult = await webhookDb().query<WebhookDeliveryRow>(
    `SELECT d.id, d.subscription_id, d.event_id, d.workspace_id, d.attempt_number,
            d.status, d.idempotency_key, d.response_status, d.response_excerpt,
            d.latency_ms, d.next_attempt_at, d.replay_of_delivery_id,
            d.created_at, d.updated_at
       FROM webhook_deliveries d
       JOIN webhook_subscriptions s ON s.id = d.subscription_id
      WHERE d.id = $1
        AND d.workspace_id = $2
        AND s.app_id = $3`,
    [input.deliveryId, input.workspaceId, input.appId]
  );
  const original = originalResult.rows[0];
  if (!original) {
    throw new Error('WEBHOOK_DELIVERY_NOT_FOUND');
  }

  const replay = await createReplayDeliveryAttempt(original);
  await deliverWebhookDelivery(replay.id);
  const updated = await findDelivery(replay.id);
  return publicDeliveryFromRow(updated);
}

export async function processDueWebhookDeliveries(now = webhookServiceDependencies.clock.now()): Promise<number> {
  const staleSendingBefore = new Date(now.getTime() - staleSendingMs());
  const due = await webhookDb().query<{ id: string }>(
    `SELECT id
       FROM webhook_deliveries
      WHERE (
        status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
      ) OR (
        status = 'sending'
        AND updated_at <= $2
      )
      ORDER BY next_attempt_at ASC NULLS FIRST, created_at ASC
      LIMIT 50`,
    [now, staleSendingBefore]
  );
  const delivered = await Promise.all(due.rows.map(row => deliverWebhookDelivery(row.id)));
  return delivered.filter(Boolean).length;
}

async function deliverWebhookDelivery(deliveryId: string): Promise<boolean> {
  const delivery = await claimDeliveryContext(deliveryId);
  if (!delivery) return false;

  const rawBody = JSON.stringify({
    id: delivery.event_id,
    type: delivery.event_type,
    created_at: delivery.event_created_at.toISOString(),
    data: delivery.event_payload,
  });
  const secret = decryptWebhookSigningSecret({
    ciphertext: delivery.signing_secret_ciphertext,
    iv: delivery.signing_secret_iv,
    tag: delivery.signing_secret_tag,
  });
  const startedAt = webhookServiceDependencies.clock.nowMs();

  try {
    await webhookServiceDependencies.validateTargetUrl(delivery.target_url);
    const result = await webhookServiceDependencies.deliverer.deliver({
      targetUrl: delivery.target_url,
      headers: {
        'Content-Type': 'application/json',
        [SHIP_SIGNATURE_HEADER]: signWebhookPayload({ rawBody, secret }),
        [WEBHOOK_IDEMPOTENCY_KEY_HEADER]: delivery.idempotency_key,
        'Ship-Event-Type': delivery.event_type,
      },
      rawBody,
      timeoutMs: webhookServiceDependencies.deliveryTimeoutMs,
    });
    await recordDeliveryResult({
      delivery,
      responseStatus: result.responseStatus,
      responseExcerpt: result.responseExcerpt?.slice(0, RESPONSE_EXCERPT_MAX_LENGTH) ?? null,
      latencyMs: webhookServiceDependencies.clock.nowMs() - startedAt,
      error: result.error,
    });
  } catch (error) {
    await recordDeliveryResult({
      delivery,
      responseStatus: null,
      responseExcerpt: null,
      latencyMs: webhookServiceDependencies.clock.nowMs() - startedAt,
      error: error instanceof Error ? error.message : 'Webhook delivery failed',
    });
  }
  return true;
}

export function isWebhookTargetUrlError(error: unknown): error is WebhookTargetUrlError {
  return error instanceof WebhookTargetUrlError;
}

export async function validateWebhookTargetUrl(rawTargetUrl: string): Promise<void> {
  const targetUrl = validateWebhookTargetUrlShape(rawTargetUrl);
  if (!isProduction()) return;

  const hostname = targetUrl.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
  const numericIpv4 = parseNumericIpv4(hostname);
  if (
    blockedWebhookHostnames.has(hostname) ||
    hostname.endsWith('.local') ||
    (net.isIP(hostname) !== 0 && isUnsafeIpAddress(hostname)) ||
    (numericIpv4 !== null && isUnsafeIpAddress(numericIpv4))
  ) {
    throw new WebhookTargetUrlError('Webhook target URL cannot target private or metadata hosts');
  }

  const addresses = await withTimeout(
    dns.lookup(targetUrl.hostname, { all: true, verbatim: true }),
    webhookServiceDependencies.deliveryTimeoutMs,
    () => new WebhookTargetUrlError('Webhook target URL DNS lookup timed out')
  );
  if (addresses.some(address => isUnsafeIpAddress(address.address))) {
    throw new WebhookTargetUrlError('Webhook target URL resolved to a private or metadata address');
  }
}

function validateWebhookTargetUrlShape(rawTargetUrl: string): URL {
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawTargetUrl);
  } catch {
    throw new WebhookTargetUrlError('Webhook target URL is malformed');
  }

  if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
    throw new WebhookTargetUrlError('Webhook target URL must use http(s)');
  }
  if (targetUrl.username || targetUrl.password) {
    throw new WebhookTargetUrlError('Webhook target URL cannot include credentials');
  }
  if (targetUrl.hash) {
    throw new WebhookTargetUrlError('Webhook target URL cannot include a fragment');
  }
  return targetUrl;
}

const blockedWebhookHostnames = new Set(['localhost', 'metadata.google.internal']);

function isUnsafeIpAddress(address: string): boolean {
  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
      || normalized.startsWith('::ffff:127.')
      || normalized.startsWith('::ffff:10.')
      || normalized.startsWith('::ffff:192.168.')
      || normalized.startsWith('::ffff:169.254.')
      || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
  }

  if (net.isIP(address) !== 4) return true;
  return address === '0.0.0.0'
    || address.startsWith('127.')
    || address.startsWith('10.')
    || address.startsWith('192.168.')
    || address.startsWith('169.254.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
}

function numberToIpv4(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function parseNumericIpv4(hostname: string): string | null {
  const normalized = hostname.toLowerCase();
  if (/^0x[0-9a-f]+$/.test(normalized)) return numberToIpv4(Number.parseInt(normalized.slice(2), 16));
  if (/^0[0-7]+$/.test(normalized)) return numberToIpv4(Number.parseInt(normalized, 8));
  if (/^\d+$/.test(normalized)) return numberToIpv4(Number.parseInt(normalized, 10));
  return null;
}

async function recordDeliveryResult(input: {
  delivery: DeliveryContextRow;
  responseStatus: number | null;
  responseExcerpt: string | null;
  latencyMs: number;
  error: string | null;
}): Promise<void> {
  const nextStatus = classifyDeliveryStatus(input.responseStatus, input.error);
  if (nextStatus === 'succeeded') {
    await updateDelivery(input.delivery.id, 'succeeded', input, {
      deliveredAt: webhookServiceDependencies.clock.now(),
      nextAttemptAt: null,
    });
    return;
  }

  const shouldRetry = nextStatus === 'retrying' && input.delivery.attempt_number < WEBHOOK_MAX_FAILED_ATTEMPTS;
  if (!shouldRetry) {
    await updateDelivery(input.delivery.id, 'dlq', input, {
      failedAt: webhookServiceDependencies.clock.now(),
      nextAttemptAt: null,
    });
    return;
  }

  const delay = WEBHOOK_RETRY_DELAYS_MS[input.delivery.attempt_number - 1] ?? WEBHOOK_RETRY_DELAYS_MS[0];
  const nextAttemptAt = new Date(webhookServiceDependencies.clock.nowMs() + delay);
  await withWebhookTransaction(async (db) => {
    await updateDelivery(input.delivery.id, 'retrying', input, { nextAttemptAt }, db);
    await createDeliveryAttempt({
      subscriptionId: input.delivery.subscription_id,
      eventId: input.delivery.event_id,
      workspaceId: input.delivery.workspace_id,
      attemptNumber: input.delivery.attempt_number + 1,
      idempotencyKey: input.delivery.idempotency_key,
      status: 'pending',
      nextAttemptAt,
      replayOfDeliveryId: input.delivery.replay_of_delivery_id,
    }, db);
  });
}

function classifyDeliveryStatus(
  responseStatus: number | null,
  error: string | null
): 'succeeded' | 'retrying' | 'failed' {
  if (error) return 'retrying';
  if (responseStatus === null) return 'retrying';
  if (responseStatus >= 200 && responseStatus < 300) return 'succeeded';
  if (responseStatus === 429 || responseStatus >= 500) return 'retrying';
  return 'failed';
}

async function updateDelivery(
  deliveryId: string,
  status: WebhookDeliveryStatus,
  result: {
    responseStatus: number | null;
    responseExcerpt: string | null;
    latencyMs: number;
    error: string | null;
  },
  timing: {
    deliveredAt?: Date;
    failedAt?: Date;
    nextAttemptAt: Date | null;
  },
  db: QueryRunner = webhookDb()
): Promise<void> {
  await db.query(
    `UPDATE webhook_deliveries
     SET status = $2,
         response_status = $3,
         response_excerpt = $4,
         latency_ms = $5,
         next_attempt_at = $6,
         delivered_at = $7,
         failed_at = $8,
         last_error = $9,
         updated_at = $10
     WHERE id = $1`,
    [
      deliveryId,
      status,
      result.responseStatus,
      result.responseExcerpt,
      result.latencyMs,
      timing.nextAttemptAt,
      timing.deliveredAt ?? null,
      timing.failedAt ?? null,
      result.error,
      webhookServiceDependencies.clock.now(),
    ]
  );
}

async function createDeliveryAttempt(input: {
  subscriptionId: string;
  eventId: string;
  workspaceId: string;
  attemptNumber: number;
  idempotencyKey: string;
  status: WebhookDeliveryStatus;
  nextAttemptAt: Date | null;
  replayOfDeliveryId: string | null;
}, db: QueryRunner = webhookDb()): Promise<WebhookDeliveryRow | null> {
  const result = await db.query<WebhookDeliveryRow>(
    `INSERT INTO webhook_deliveries (
       subscription_id,
       event_id,
       workspace_id,
       attempt_number,
       status,
       idempotency_key,
       next_attempt_at,
       replay_of_delivery_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT ON CONSTRAINT webhook_deliveries_subscription_event_attempt_unique
     DO NOTHING
     RETURNING id, subscription_id, event_id, workspace_id, attempt_number,
               status, idempotency_key, response_status, response_excerpt,
               latency_ms, next_attempt_at, replay_of_delivery_id,
               created_at, updated_at`,
    [
      input.subscriptionId,
      input.eventId,
      input.workspaceId,
      input.attemptNumber,
      input.status,
      input.idempotencyKey,
      input.nextAttemptAt,
      input.replayOfDeliveryId,
    ]
  );
  return result.rows[0] ?? null;
}

async function createReplayDeliveryAttempt(original: WebhookDeliveryRow): Promise<WebhookDeliveryRow> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextAttempt = await nextDeliveryAttemptNumber(original.event_id, original.subscription_id);
    const replay = await createDeliveryAttempt({
      subscriptionId: original.subscription_id,
      eventId: original.event_id,
      workspaceId: original.workspace_id,
      attemptNumber: nextAttempt,
      idempotencyKey: original.idempotency_key,
      status: 'pending',
      nextAttemptAt: null,
      replayOfDeliveryId: original.id,
    });
    if (replay) return replay;
  }

  throw new Error('Webhook replay delivery conflict did not settle');
}

async function claimDeliveryContext(deliveryId: string): Promise<DeliveryContextRow | null> {
  const now = webhookServiceDependencies.clock.now();
  const staleSendingBefore = new Date(now.getTime() - staleSendingMs());
  const result = await webhookDb().query<DeliveryContextRow>(
    `UPDATE webhook_deliveries d
        SET status = 'sending',
            updated_at = $2
       FROM webhook_events e,
            webhook_subscriptions s
      WHERE d.id = $1
        AND e.id = d.event_id
        AND s.id = d.subscription_id
        AND (
          (
            d.status = 'pending'
            AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= $2)
          ) OR (
            d.status = 'sending'
            AND d.updated_at <= $3
          )
        )
      RETURNING d.id, d.subscription_id, d.event_id, d.workspace_id, d.attempt_number,
                d.status, d.idempotency_key, d.response_status, d.response_excerpt,
                d.latency_ms, d.next_attempt_at, d.replay_of_delivery_id,
                d.created_at, d.updated_at,
                e.event_type, e.payload AS event_payload, e.created_at AS event_created_at,
                s.target_url, s.signing_secret_ciphertext, s.signing_secret_iv, s.signing_secret_tag`,
    [deliveryId, now, staleSendingBefore]
  );
  return result.rows[0] ?? null;
}

async function findDelivery(deliveryId: string): Promise<WebhookDeliveryRow> {
  const result = await webhookDb().query<WebhookDeliveryRow>(
    `SELECT id, subscription_id, event_id, workspace_id, attempt_number,
            status, idempotency_key, response_status, response_excerpt,
            latency_ms, next_attempt_at, replay_of_delivery_id,
            created_at, updated_at
       FROM webhook_deliveries
      WHERE id = $1`,
    [deliveryId]
  );
  return requireRow(result.rows[0], 'Webhook delivery not found');
}

async function nextDeliveryAttemptNumber(eventId: string, subscriptionId: string): Promise<number> {
  const result = await webhookDb().query<{ next_attempt: number }>(
    `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
       FROM webhook_deliveries
      WHERE event_id = $1
        AND subscription_id = $2`,
    [eventId, subscriptionId]
  );
  return result.rows[0]?.next_attempt ?? 1;
}

async function withWebhookTransaction<T>(run: (db: QueryRunner) => Promise<T>): Promise<T> {
  const db = webhookDb();
  if (canConnect(db)) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await db.query('BEGIN');
  try {
    const result = await run(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function canConnect(db: QueryRunner): db is Pool {
  return typeof (db as { connect?: unknown }).connect === 'function';
}

function staleSendingMs(): number {
  return Math.max(MIN_STALE_SENDING_MS, webhookServiceDependencies.deliveryTimeoutMs * 3);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(timeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function publicSubscriptionFromRow(row: WebhookSubscriptionRow): PublicWebhookSubscription {
  return {
    id: row.id,
    event: row.event_type,
    target_url: row.target_url,
    active: row.active,
    created_at: row.created_at.toISOString(),
  };
}

function publicDeliveryFromRow(row: WebhookDeliveryRow): PublicWebhookDelivery {
  return {
    id: row.id,
    subscription_id: row.subscription_id,
    event_id: row.event_id,
    attempt_number: row.attempt_number,
    status: row.status,
    idempotency_key: row.idempotency_key,
    response_status: row.response_status,
    response_excerpt: row.response_excerpt,
    latency_ms: row.latency_ms,
    next_attempt_at: row.next_attempt_at?.toISOString() ?? null,
    replay_of_delivery_id: row.replay_of_delivery_id,
    created_at: row.created_at.toISOString(),
  };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}

async function shouldEnqueueWebhookForSubscription(input: {
  db: QueryRunner;
  event: WebhookEventRow;
  subscription: WebhookSubscriptionRow;
}): Promise<boolean> {
  if (!input.subscription.app_is_active) return false;
  if (
    input.event.resource_kind !== 'document' ||
    !input.event.resource_id ||
    !input.event.resource_document_type ||
    !input.subscription.read_subject_user_id
  ) {
    return false;
  }

  const requiredScope = readScopeForWebhookEvent(input.event.event_type);
  if (!input.subscription.read_subject_scopes.includes(requiredScope)) return false;

  const actor = {
    userId: input.subscription.read_subject_user_id,
    workspaceId: input.event.workspace_id,
    isSuperAdmin: false,
  };
  if (!(await requireWorkspaceMembership(actor, input.db))) return false;

  const principal = webhookSubscriptionPrincipal(input.subscription, input.event.workspace_id);
  const expectedType = expectedDocumentTypeForWebhookEvent(
    input.event.event_type,
    input.event.resource_document_type
  );
  const decision = await authorize(input.db, principal, {
    resource: 'document',
    action: 'read',
    documentId: input.event.resource_id,
    expectedType,
    includeDeleted: input.event.event_type === 'document.deleted',
  });
  return decision.allowed;
}

function webhookSubscriptionPrincipal(
  subscription: WebhookSubscriptionRow,
  workspaceId: string
): Principal {
  const userId = subscription.read_subject_user_id;
  if (!userId) throw new Error('Webhook subscription subject missing');
  return {
    kind: 'oauth_access_token',
    tokenId: `webhook_subscription:${subscription.id}`,
    appId: subscription.app_id,
    clientId: subscription.client_id,
    userId,
    workspaceId,
    isSuperAdmin: false,
    scopes: subscription.read_subject_scopes,
  };
}

webhookEventBus.subscribe(async (event) => {
  try {
    await persistAndDispatchWebhookEvent(event);
  } catch (error) {
    logHotError('webhooks.dispatch', 'Failed to persist and dispatch webhook event', error, {
      eventType: event.type,
      workspaceId: event.workspace_id,
    });
  }
});
