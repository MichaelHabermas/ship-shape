import { createHash } from 'crypto';

export function fleetGraphStableHash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}
