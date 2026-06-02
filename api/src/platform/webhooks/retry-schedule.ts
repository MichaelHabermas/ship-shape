// Retry timing from canon. Scheduling, jitter, DLQ transition, and deterministic
// test clocks are separate implementation work.
export const WEBHOOK_RETRY_DELAYS_MS = [
  1_000,
  4_000,
  16_000,
  60_000,
  300_000,
  1_800_000,
] as const;

export const WEBHOOK_MAX_FAILED_ATTEMPTS = 6;
