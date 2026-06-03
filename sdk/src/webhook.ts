// SDK webhook helpers verify Ship HMAC signatures in constant time.
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export function verifyWebhook(
  headers: Record<string, string | string[] | undefined> | Headers,
  rawBody: string,
  secret: string,
  toleranceSec = DEFAULT_WEBHOOK_TOLERANCE_SECONDS
): boolean {
  const header = headerValue(headers, 'ship-signature');
  if (!header) return false;

  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp) > toleranceSec) return false;

  const expected = bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`${parsed.timestamp}.${rawBody}`)));
  return constantTimeEqualHex(expected, parsed.signature);
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | Headers,
  name: string
): string | null {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
  const record = headers as Record<string, string | string[] | undefined>;
  const entry = Object.entries(record).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
  const parts = Object.fromEntries(
    header.split(',').map(part => {
      const [key, value] = part.trim().split('=');
      return [key, value];
    })
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isInteger(timestamp) || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;
  return { timestamp, signature: signature.toLowerCase() };
}

function constantTimeEqualHex(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return diff === 0;
}
