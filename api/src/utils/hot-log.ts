/**
 * Small structured error logger for hot paths (auth, secrets).
 * JSON lines keep production logs grep-friendly without pulling in a full logger.
 */

export function logHotError(
  scope: string,
  message: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const errorPayload = error instanceof Error
    ? { name: error.name, message: error.message }
    : error;

  console.error(JSON.stringify({
    level: 'error',
    scope,
    message,
    error: errorPayload,
    ...context,
    ts: new Date().toISOString(),
  }));
}
