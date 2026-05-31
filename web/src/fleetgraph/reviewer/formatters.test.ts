// Verifies FleetGraph reviewer formatters shorten UUIDs and format durations consistently.
import { describe, expect, it } from 'vitest';
import { formatCompactDate, formatMs, shortUuid } from './formatters';

describe('FleetGraph reviewer formatters', () => {
  it('formats sub-second durations in milliseconds', () => {
    expect(formatMs(250)).toBe('250 ms');
  });

  it('shortens UUIDs for display', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(shortUuid(id)).toBe('1111...1111');
  });

  it('formats ISO timestamps in compact date text', () => {
    const formatted = formatCompactDate('2026-05-31T12:00:00.000Z');
    expect(formatted).toMatch(/May/);
  });
});
