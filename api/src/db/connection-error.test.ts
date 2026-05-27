import { describe, it, expect } from 'vitest';
import { isDatabaseUnreachableError } from './connection-error.js';

describe('isDatabaseUnreachableError', () => {
  it('detects ECONNREFUSED on the root error', () => {
    expect(isDatabaseUnreachableError({ code: 'ECONNREFUSED' })).toBe(true);
  });

  it('detects nested ECONNREFUSED from pg AggregateError', () => {
    expect(
      isDatabaseUnreachableError({
        code: 'ECONNREFUSED',
        errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }],
      })
    ).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isDatabaseUnreachableError({ code: '42P01' })).toBe(false);
    expect(isDatabaseUnreachableError(null)).toBe(false);
  });
});
