import { describe, it, expect } from 'vitest';
import { normalizeNullableRefs } from './normalize-nullable-refs.js';

describe('normalizeNullableRefs', () => {
  it('rewrites nullable ref allOf pattern for openapi-typescript', () => {
    const input = {
      components: {
        schemas: {
          Project: {
            properties: {
              owner: {
                allOf: [
                  { $ref: '#/components/schemas/UserReference' },
                  { nullable: true },
                ],
              },
            },
          },
        },
      },
    };

    const output = normalizeNullableRefs(input as never);

    expect(output.components?.schemas?.Project).toEqual({
      properties: {
        owner: {
          nullable: true,
          allOf: [{ $ref: '#/components/schemas/UserReference' }],
        },
      },
    });
  });
});
