import type { OpenAPIObject } from 'openapi3-ts/oas30';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableRefAllOf(value: unknown): value is {
  allOf: [{ $ref: string }, { nullable: true }];
} {
  if (!isRecord(value) || !Array.isArray(value.allOf) || value.allOf.length !== 2) {
    return false;
  }

  const [first, second] = value.allOf as readonly unknown[];
  return (
    isRecord(first)
    && typeof first.$ref === 'string'
    && isRecord(second)
    && second.nullable === true
    && Object.keys(second).length === 1
  );
}

function normalizeNullableRefNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeNullableRefNode);
  }

  if (!isRecord(value)) {
    return value;
  }

  if (isNullableRefAllOf(value)) {
    const [refPart] = value.allOf;
    return {
      nullable: true,
      allOf: [refPart],
    };
  }

  const normalized: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    normalized[key] = normalizeNullableRefNode(child);
  }
  return normalized;
}

export function normalizeNullableRefs(document: OpenAPIObject): OpenAPIObject {
  return normalizeNullableRefNode(document) as OpenAPIObject;
}
