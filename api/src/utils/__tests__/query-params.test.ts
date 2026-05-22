import { describe, expect, it } from 'vitest';
import {
  getClampedIntegerQuery,
  getOptionalQueryString,
  getQueryString,
  getTrimmedQueryString,
} from '../query-params.js';

describe('query param helpers', () => {
  it('reads the first string from repeated query params', () => {
    expect(getQueryString(['alpha', 'beta'])).toBe('alpha');
    expect(getQueryString([123, 'beta'], 'fallback')).toBe('fallback');
  });

  it('distinguishes optional blank strings from present values', () => {
    expect(getOptionalQueryString(undefined)).toBeUndefined();
    expect(getOptionalQueryString('')).toBeUndefined();
    expect(getOptionalQueryString('issue')).toBe('issue');
  });

  it('trims search strings without changing the fallback contract', () => {
    expect(getTrimmedQueryString('  budget risk  ')).toBe('budget risk');
    expect(getTrimmedQueryString(undefined, '  fallback  ')).toBe('fallback');
  });

  it('defaults and clamps integer query values', () => {
    expect(getClampedIntegerQuery('25', { defaultValue: 20, min: 1, max: 50 })).toBe(25);
    expect(getClampedIntegerQuery('0', { defaultValue: 20, min: 1, max: 50 })).toBe(20);
    expect(getClampedIntegerQuery('-5', { defaultValue: 20, min: 1, max: 50 })).toBe(1);
    expect(getClampedIntegerQuery('500', { defaultValue: 20, min: 1, max: 50 })).toBe(50);
    expect(getClampedIntegerQuery('nope', { defaultValue: 20, min: 1, max: 50 })).toBe(20);
  });
});
