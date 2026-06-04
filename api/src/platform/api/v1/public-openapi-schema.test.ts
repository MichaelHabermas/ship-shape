// Validates committed docs/openapi.json against the OpenAPI 3.1 JSON Schema.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generatePublicOpenApiDocument } from './openapi.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const specPath = resolve(repoRoot, 'docs/openapi.json');
const validateModuleUrl = pathToFileURL(
  resolve(repoRoot, 'scripts/lib/validate-public-openapi-document.mjs')
).href;

type ValidateModule = {
  collectPublicOpenApiProblems: (input: {
    document: Record<string, unknown>;
    registrySource: string;
  }) => Promise<string[]>;
  validateAgainstOpenApi31Schema: (source: string | Record<string, unknown>) => Promise<string[]>;
};

async function loadValidator(): Promise<ValidateModule> {
  return import(validateModuleUrl) as Promise<ValidateModule>;
}

describe('public OpenAPI 3.1 schema', () => {
  it('validates committed docs/openapi.json against the OpenAPI 3.1 JSON Schema', async () => {
    const { validateAgainstOpenApi31Schema } = await loadValidator();
    const rawSpec = readFileSync(specPath, 'utf8');
    const document = JSON.parse(rawSpec) as Record<string, unknown>;

    expect(document.openapi).toBe('3.1.0');

    const schemaErrors = await validateAgainstOpenApi31Schema(document);
    expect(schemaErrors, schemaErrors.join('\n')).toEqual([]);
  });

  it('validates the in-process generator output against the OpenAPI 3.1 JSON Schema', async () => {
    const { validateAgainstOpenApi31Schema } = await loadValidator();
    const document = generatePublicOpenApiDocument() as Record<string, unknown>;

    expect(document.openapi).toBe('3.1.0');

    const schemaErrors = await validateAgainstOpenApi31Schema(document);
    expect(schemaErrors, schemaErrors.join('\n')).toEqual([]);
  });

  it('keeps committed docs/openapi.json aligned with registry parity checks', async () => {
    const { collectPublicOpenApiProblems } = await loadValidator();
    const rawSpec = readFileSync(specPath, 'utf8');
    const document = JSON.parse(rawSpec) as Record<string, unknown>;
    const registrySource = readFileSync(
      resolve(repoRoot, 'api/src/platform/api/v1/route-metadata.ts'),
      'utf8'
    );

    const problems = await collectPublicOpenApiProblems({ document, registrySource });
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
