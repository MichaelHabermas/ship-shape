// Webhook signing utilities produce Stripe-style timestamped HMAC signatures.
import crypto from 'crypto';

export const SHIP_SIGNATURE_HEADER = 'Ship-Signature';
export const SHIP_SIGNATURE_VERSION = 'v1';
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

const WEBHOOK_SECRET_PREFIX = 'ship_whsec_';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

export type EncryptedWebhookSecret = {
  ciphertext: string;
  iv: string;
  tag: string;
};

export function generateWebhookSigningSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
}

export function hashWebhookSigningSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function encryptWebhookSigningSecret(secret: string): EncryptedWebhookSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, webhookEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
  };
}

export function decryptWebhookSigningSecret(encrypted: EncryptedWebhookSecret): string {
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    webhookEncryptionKey(),
    Buffer.from(encrypted.iv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function signWebhookPayload(input: {
  rawBody: string;
  secret: string;
  timestampSeconds?: number;
}): string {
  const timestamp = input.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest('hex');
  return `t=${timestamp},${SHIP_SIGNATURE_VERSION}=${signature}`;
}

function webhookEncryptionKey(): Buffer {
  return crypto
    .createHash('sha256')
    .update(process.env.SESSION_SECRET || 'dev-only-secret-do-not-use-in-production')
    .digest();
}
