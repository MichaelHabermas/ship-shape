import { describe, it, expect } from 'vitest';
import { formatWireDate, formatWireDateRequired } from './format-wire-date.js';

describe('formatWireDate', () => {
  it('formats Date objects to YYYY-MM-DD', () => {
    expect(formatWireDate(new Date('2025-01-30T14:30:00.000Z'))).toBe('2025-01-30');
  });

  it('uses local calendar date for pg DATE midnight values', () => {
    // Simulates node-pg returning a DATE column as local midnight.
    expect(formatWireDate(new Date(2026, 4, 22))).toBe('2026-05-22');
  });

  it('passes through date-only strings', () => {
    expect(formatWireDate('2025-01-30')).toBe('2025-01-30');
  });

  it('strips time from ISO datetime strings', () => {
    expect(formatWireDate('2025-01-30T00:00:00.000Z')).toBe('2025-01-30');
  });

  it('strips time from space-separated datetime strings', () => {
    expect(formatWireDate('2025-01-30 00:00:00')).toBe('2025-01-30');
  });

  it('returns null for nullish values', () => {
    expect(formatWireDate(null)).toBeNull();
    expect(formatWireDate(undefined)).toBeNull();
  });

  it('returns null for non-conforming strings', () => {
    expect(formatWireDate('not-a-date')).toBeNull();
  });
});

describe('formatWireDateRequired', () => {
  it('returns formatted date for valid input', () => {
    expect(formatWireDateRequired('2025-01-30')).toBe('2025-01-30');
  });

  it('throws for nullish input', () => {
    expect(() => formatWireDateRequired(null as unknown as string)).toThrow('Expected a date value');
  });
});
