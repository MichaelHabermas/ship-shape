// Shared module-level DI for webhook subscriptions, fanout, and delivery.
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/client.js';
import { FetchWebhookDeliverer, type IWebhookDeliverer } from './deliverer.js';

const WEBHOOK_DELIVERY_TIMEOUT_MS = 5_000;

export type QueryRunner = Pick<Pool | PoolClient, 'query'>;

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

export const webhookServiceDependencies: WebhookServiceDependencies = {
  clock: systemClock,
  db: pool,
  deliverer: new FetchWebhookDeliverer(),
  deliveryTimeoutMs: WEBHOOK_DELIVERY_TIMEOUT_MS,
  validateTargetUrl: async () => {
    throw new Error('Webhook target URL validator not wired');
  },
};

export function configureWebhookServiceDependencies(
  overrides: Partial<WebhookServiceDependencies>
): () => void {
  const previous = { ...webhookServiceDependencies };
  Object.assign(webhookServiceDependencies, overrides);
  return () => {
    Object.assign(webhookServiceDependencies, previous);
  };
}

export function webhookDb(): QueryRunner {
  return webhookServiceDependencies.db;
}

export function requireWebhookRow<T>(row: T | undefined, message: string): T {
  if (!row) throw new Error(message);
  return row;
}
