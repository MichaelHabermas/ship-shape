// Domain mutation helpers publish webhooks in-transaction and dispatch after commit.
import type { WebhookEvent } from '@ship/shared';
import type { Pool, PoolClient } from 'pg';
import {
  commitAndDispatchWebhooks,
  publishWebhookEventInTransaction,
  type WebhookEventPublishResult,
} from './event-bus.js';

type QueryRunner = Pick<Pool | PoolClient, 'query'>;

export async function publishDomainWebhookInTransaction(
  event: WebhookEvent,
  db: QueryRunner
): Promise<WebhookEventPublishResult> {
  return publishWebhookEventInTransaction(event, db);
}

export function commitDomainWebhooks(deliveryIds: string[]): void {
  commitAndDispatchWebhooks(deliveryIds);
}
