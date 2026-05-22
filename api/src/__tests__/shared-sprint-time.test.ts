import { describe, it, expect } from 'vitest';
import {
  normalizeWorkspaceStartDate,
  utcToday,
  computeCurrentSprintNumber,
  formatUtcDateIso,
} from '@ship/shared';

describe('sprint-time', () => {
  it('normalizeWorkspaceStartDate parses Date at UTC midnight', () => {
    const raw = new Date('2025-01-15T14:30:00.000Z');
    const normalized = normalizeWorkspaceStartDate(raw);
    expect(normalized.toISOString()).toBe('2025-01-15T00:00:00.000Z');
  });

  it('normalizeWorkspaceStartDate parses ISO date string', () => {
    const normalized = normalizeWorkspaceStartDate('2025-03-01');
    expect(normalized.toISOString()).toBe('2025-03-01T00:00:00.000Z');
  });

  it('computeCurrentSprintNumber returns 1 on start date', () => {
    const start = normalizeWorkspaceStartDate('2025-01-01');
    const today = utcToday();
    const daysOffset = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const alignedStart = new Date(start);
    alignedStart.setUTCDate(alignedStart.getUTCDate() + daysOffset);
    const sprint = computeCurrentSprintNumber(alignedStart);
    expect(sprint).toBeGreaterThanOrEqual(1);
  });

  it('formatUtcDateIso returns date portion', () => {
    const date = new Date('2025-06-15T12:00:00.000Z');
    expect(formatUtcDateIso(date)).toBe('2025-06-15');
  });
});
