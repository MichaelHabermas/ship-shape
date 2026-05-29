import { describe, expect, it } from 'vitest';
import { openApiShouldRequireAuth } from '../app.js';

describe('production OpenAPI exposure policy', () => {
  it('gates production OpenAPI by default and keeps explicit public opt-in', () => {
    expect(openApiShouldRequireAuth({ NODE_ENV: 'development' })).toBe(false);
    expect(openApiShouldRequireAuth({ NODE_ENV: 'test' })).toBe(false);
    expect(openApiShouldRequireAuth({ NODE_ENV: 'production' })).toBe(true);
    expect(openApiShouldRequireAuth({ NODE_ENV: 'production', OPENAPI_PUBLIC: '1' })).toBe(false);
  });
});
