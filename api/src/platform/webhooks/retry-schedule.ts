// Retry timing from canon drives deterministic webhook scheduling and DLQ transition tests.
export const WEBHOOK_RETRY_DELAYS_MS = [
  1_000,
  4_000,
  16_000,
  60_000,
  300_000,
  1_800_000,
] as const;

export const WEBHOOK_MAX_FAILED_ATTEMPTS = 6;
