// Poll HTTP endpoints until ready or timeout.
import { sleep } from './process-utils.mjs';

export async function waitForHttp(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 250;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  const details = options.details?.() ?? '';
  const errorMessage = lastError instanceof Error ? lastError.message : '';
  throw new Error(`Timed out waiting for ${url}. ${details} ${errorMessage}`.trim());
}
