// Webhook deliverers isolate outbound HTTP transport from retry persistence.
export type WebhookDelivererRequest = {
  targetUrl: string;
  headers: Record<string, string>;
  rawBody: string;
  timeoutMs: number;
};

export type WebhookDelivererResult = {
  responseStatus: number | null;
  responseExcerpt: string | null;
  error: string | null;
};

export const WEBHOOK_RESPONSE_EXCERPT_MAX_BYTES = 1_000;

export interface IWebhookDeliverer<TDelivery = WebhookDelivererRequest> {
  deliver(delivery: TDelivery): Promise<WebhookDelivererResult>;
}

export class FetchWebhookDeliverer implements IWebhookDeliverer {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async deliver(delivery: WebhookDelivererRequest): Promise<WebhookDelivererResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), delivery.timeoutMs);
    try {
      const response = await this.fetchImpl(delivery.targetUrl, {
        method: 'POST',
        headers: delivery.headers,
        body: delivery.rawBody,
        signal: controller.signal,
        redirect: 'manual',
      });
      const responseExcerpt = await readBoundedResponseExcerpt(response);
      return {
        responseStatus: response.status,
        responseExcerpt,
        error: null,
      };
    } catch (error) {
      return {
        responseStatus: null,
        responseExcerpt: null,
        error: error instanceof Error ? error.message : 'Webhook delivery failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedResponseExcerpt(response: Response): Promise<string> {
  if (!response.body) return '';

  const body = response.body as ReadableStream<Uint8Array>;
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const decoder = new TextDecoder();
  let remainingBytes = WEBHOOK_RESPONSE_EXCERPT_MAX_BYTES;
  let excerpt = '';
  let reachedEnd = false;

  try {
    while (remainingBytes > 0) {
      const { done, value } = await reader.read();
      if (done) {
        reachedEnd = true;
        break;
      }

      const chunk = value.byteLength > remainingBytes
        ? value.subarray(0, remainingBytes)
        : value;
      excerpt += decoder.decode(chunk, { stream: true });
      remainingBytes -= chunk.byteLength;

      if (chunk.byteLength < value.byteLength) break;
    }
  } finally {
    if (!reachedEnd) {
      try {
        await reader.cancel();
      } catch {
        // The response already produced the bounded excerpt; cancellation is best-effort cleanup.
      }
    }
  }

  return excerpt + decoder.decode();
}
