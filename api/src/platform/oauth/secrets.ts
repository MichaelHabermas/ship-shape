// OAuth secret generators and SHA-256 hashing for codes and refresh tokens.
import crypto from 'crypto';

export function generateAuthorizationCode(): string {
  return `ship_oac_${crypto.randomBytes(32).toString('hex')}`;
}

export function generateRefreshToken(): string {
  return `ship_ort_${crypto.randomBytes(32).toString('hex')}`;
}

export function generateDeviceCode(): string {
  return `ship_odc_${crypto.randomBytes(32).toString('hex')}`;
}

export function generateUserCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function hashOAuthSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}
