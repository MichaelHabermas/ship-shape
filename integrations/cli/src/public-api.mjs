// Thin CLI helpers wrapping @ship/sdk public API clients.
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { FileTokenStore, ShipClient, ShipError } from '@ship/sdk';

export function shipClientFromParsed(parsed) {
  return new ShipClient({
    baseUrl: requireApiBaseUrl(parsed),
    clientId: stringFlag(parsed.flags['client-id']) ?? process.env.SHIP_CLIENT_ID,
    tokenStore: tokenStoreFromParsed(parsed),
  });
}

export function tokenStoreFromParsed(parsed) {
  const tokenPath = stringFlag(parsed.flags['token-path'])
    ?? process.env.SHIP_TOKEN_PATH
    ?? path.join(os.homedir(), '.ship', 'tokens.json');
  return new FileTokenStore(tokenPath);
}

export function requireApiBaseUrl(parsed) {
  const value = stringFlag(parsed.flags['api-url']) ?? process.env.SHIP_API_URL;
  if (!value) {
    throw new ShipError({
      kind: 'validation',
      message: 'Pass --api-url or set SHIP_API_URL',
    });
  }
  return value.replace(/\/+$/, '');
}

export function stringFlag(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function numberFlag(value) {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function printRows(rows) {
  if (rows.length === 0) return;
  for (const row of rows) {
    console.log(Object.values(row).join('\t'));
  }
}
