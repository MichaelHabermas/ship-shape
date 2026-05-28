// Shared JSON shape guards for FleetGraph persistence and output helpers.
import type { JsonRecord } from '../persistence.js';

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringFromJsonRecord(value: unknown, keys: string[]): string | null {
  if (!isJsonRecord(value)) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}
