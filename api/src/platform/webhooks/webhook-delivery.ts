// Webhook delivery dispatch, claim, POST, retry scheduling, and DLQ handling.
import type {
  PublicWebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEventType,
} from '@ship/shared';
import type { Pool } from 'pg';
import type { PublicCursorPayload } from '../api/v1/pagination.js';
import { logHotError } from '../../utils/hot-log.js';
import { WEBHOOK_IDEMPOTENCY_KEY_HEADER } from './headers.js';
import { WEBHOOK_MAX_FAILED_ATTEMPTS, WEBHOOK_RETRY_DELAYS_MS } from './retry-schedule.js';
import {
  decryptWebhookSigningSecret,
  signWebhookPayload,
  SHIP_SIGNATURE_HEADER,
} from './signature.js';
import {
  type QueryRunner,
  requireWebhookRow,
  webhookDb,
  webhookServiceDependencies,
} from './webhook-service-deps.js';

const RESPONSE_EXCERPT_MAX_LENGTH = 1_000;
const MIN_STALE_SENDING_MS = 30_000;

export type WebhookDeliveryRow = {
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

export type DeliveryContextRow = WebhookDeliveryRow & {
  event_type: WebhookEventType;
  event_payload: Record<string, unknown>;
  event_created_at: Date;
  target_url: string;
  signing_secret_ciphertext: string;
  signing_secret_iv: string;
  signing_secret_tag: string;
};

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

export async function deliverWebhookDelivery(deliveryId: string): Promise<boolean> {
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

export async function createDeliveryAttempt(input: {
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

export async function createReplayDeliveryAttempt(original: WebhookDeliveryRow): Promise<WebhookDeliveryRow> {
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

export async function findDelivery(deliveryId: string): Promise<WebhookDeliveryRow> {
  const result = await webhookDb().query<WebhookDeliveryRow>(
    `SELECT id, subscription_id, event_id, workspace_id, attempt_number,
            status, idempotency_key, response_status, response_excerpt,
            latency_ms, next_attempt_at, replay_of_delivery_id,
            created_at, updated_at
       FROM webhook_deliveries
      WHERE id = $1`,
    [deliveryId]
  );
  return requireWebhookRow(result.rows[0], 'Webhook delivery not found');
}

export function publicDeliveryFromRow(row: WebhookDeliveryRow): PublicWebhookDelivery {
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
