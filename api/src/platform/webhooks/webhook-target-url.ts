// Webhook target URL validation with DNS and private-IP guards in production.
import dns from 'node:dns/promises';
import net from 'node:net';
import { isProduction } from '../../config/runtime.js';
import { webhookServiceDependencies } from './webhook-service-deps.js';

export class WebhookTargetUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookTargetUrlError';
  }
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
