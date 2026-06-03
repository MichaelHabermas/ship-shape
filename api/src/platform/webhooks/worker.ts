// In-process webhook delivery worker polls due retries and stale sending rows on an interval.
import { processDueWebhookDeliveries } from './service.js';

export type WebhookDeliveryWorkerOptions = {
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  logger?: Pick<typeof console, 'error'>;
  processDue?: typeof processDueWebhookDeliveries;
};

const DEFAULT_INTERVAL_MS = 5_000;

export function startWebhookDeliveryWorker(
  options: WebhookDeliveryWorkerOptions = {}
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const logger = options.logger ?? console;
  const processDue = options.processDue ?? processDueWebhookDeliveries;
  let stopped = false;
  let running = false;

  const timer = setIntervalFn(() => {
    if (stopped || running) return;
    running = true;
    void processDue()
      .catch((error: unknown) => {
        logger.error('Webhook delivery worker tick failed:', error);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  return () => {
    stopped = true;
    clearIntervalFn(timer);
  };
}
