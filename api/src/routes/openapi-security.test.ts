import { describe, expect, it } from 'vitest';
import { openApiShouldRequireAuth } from '../app.js';

describe('production OpenAPI exposure policy', () => {
  it('gates production OpenAPI by default and keeps explicit public opt-in', () => {
    expect(openApiShouldRequireAuth({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
    expect(openApiShouldRequireAuth({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
    expect(openApiShouldRequireAuth({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(openApiShouldRequireAuth({ NODE_ENV: 'production', OPENAPI_PUBLIC: '1' } as NodeJS.ProcessEnv)).toBe(false);
  });
});
