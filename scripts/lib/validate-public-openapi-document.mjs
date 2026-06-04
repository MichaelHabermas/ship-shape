#!/usr/bin/env node
// Shared public OpenAPI checks: OAS 3.1 meta-schema, Redocly lint, registry parity.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConfig, lintFromString } from '@redocly/openapi-core';
import { Validator } from '@seriousme/openapi-schema-validator';

/**
 * @param {string | Record<string, unknown>} source Path to JSON or parsed document.
 * @returns {Promise<string[]>}
 */
export async function validateAgainstOpenApi31Schema(source) {
  const validator = new Validator();
  const result = await validator.validate(source);
  if (result.valid) return [];

  const errors = Array.isArray(result.errors) ? result.errors : [String(result.errors ?? 'unknown schema error')];
  return errors.map((error) => {
    if (typeof error === 'string') return `OpenAPI 3.1 schema: ${error}`;
    const pointer = error.instancePath || error.schemaPath || '';
    const detail = error.message ?? 'validation failed';
    return `OpenAPI 3.1 schema${pointer ? ` at ${pointer}` : ''}: ${detail}`;
  });
}

/**
 * @param {{
 *   document: Record<string, unknown>;
 *   registrySource: string;
 *   rawSpec?: string;
 *   specPath?: string;
 * }} input
 * @returns {Promise<string[]>}
 */
export async function collectPublicOpenApiProblems(input) {
  const { document, registrySource, rawSpec, specPath } = input;
  const problems = [];

  problems.push(...await validateAgainstOpenApi31Schema(document));

  if (rawSpec && specPath) {
    const redoclyConfig = await createConfig({ extends: ['minimal'] });
    const redoclyProblems = await lintFromString({ source: rawSpec, absoluteRef: specPath, config: redoclyConfig });
    for (const problem of redoclyProblems.filter((entry) => entry.severity === 'error')) {
      const pointer = problem.location?.[0]?.pointer ? ` at ${problem.location[0].pointer}` : '';
      problems.push(`Redocly ${problem.ruleId ?? 'validation'}${pointer}: ${problem.message}`);
    }
  }

  if (!String(document.openapi ?? '').startsWith('3.1')) {
    problems.push(`expected openapi 3.1.x, got ${document.openapi ?? 'missing'}`);
  }
  if (!document.paths || typeof document.paths !== 'object') {
    problems.push('missing paths object');
  } else {
    const hasDocuments = Object.keys(document.paths).some((path) => path.includes('/documents'));
    if (!hasDocuments) problems.push('no /api/v1/documents paths found');
  }

  const serverUrl = document.servers?.[0]?.url;
  if (serverUrl !== '/api/v1') {
    problems.push(`expected servers[0].url /api/v1, got ${serverUrl ?? 'missing'}`);
  }

  const registryOperationIds = [...registrySource.matchAll(/operationId:\s*'([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  const specOperationIds = [];
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
      const operation = pathItem?.[method];
      if (operation?.operationId) specOperationIds.push(operation.operationId);
    }
  }
  specOperationIds.sort();

  if (registryOperationIds.length === 0) {
    problems.push('no operationIds parsed from route-metadata.ts');
  } else if (registryOperationIds.join('\0') !== specOperationIds.join('\0')) {
    const registrySet = new Set(registryOperationIds);
    const specSet = new Set(specOperationIds);
    const missingFromSpec = registryOperationIds.filter((id) => !specSet.has(id));
    const extraInSpec = specOperationIds.filter((id) => !registrySet.has(id));
    if (missingFromSpec.length > 0) {
      problems.push(`operationIds missing from docs/openapi.json: ${missingFromSpec.join(', ')}`);
    }
    if (extraInSpec.length > 0) {
      problems.push(`unexpected operationIds in docs/openapi.json: ${extraInSpec.join(', ')}`);
    }
  }

  return problems;
}

/**
 * @param {string} [rootDir]
 * @returns {Promise<{ document: Record<string, unknown>; problems: string[]; specPath: string }>}
 */
export async function validateCommittedPublicOpenApi(rootDir = process.cwd()) {
  const resolvedRoot = resolve(rootDir);
  const specPath = resolve(resolvedRoot, 'docs/openapi.json');
  const registryPath = resolve(resolvedRoot, 'api/src/platform/api/v1/route-metadata.ts');
  const rawSpec = readFileSync(specPath, 'utf8');
  const document = JSON.parse(rawSpec);
  const registrySource = readFileSync(registryPath, 'utf8');
  const problems = await collectPublicOpenApiProblems({
    document,
    registrySource,
    rawSpec,
    specPath,
  });
  return { document, problems, specPath };
}
