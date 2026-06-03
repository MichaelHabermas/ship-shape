#!/usr/bin/env node
// MVP gate 7: generated public OpenAPI must be 3.1.x, include documents paths, and match registry operationIds.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const specPath = resolve(rootDir, 'docs/openapi.json');
const registryPath = resolve(rootDir, 'api/src/platform/api/v1/route-metadata.ts');
const document = JSON.parse(readFileSync(specPath, 'utf8'));
const registrySource = readFileSync(registryPath, 'utf8');
const problems = [];

if (!String(document.openapi ?? '').startsWith('3.1')) {
  problems.push(`expected openapi 3.1.x, got ${document.openapi ?? 'missing'}`);
}
if (!document.paths || typeof document.paths !== 'object') {
  problems.push('missing paths object');
} else {
  const hasDocuments = Object.keys(document.paths).some(path => path.includes('/documents'));
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

if (problems.length > 0) {
  console.error(`Public OpenAPI validation failed for ${specPath}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Public OpenAPI OK: ${specPath} (${document.openapi}, ${Object.keys(document.paths).length} paths, ${specOperationIds.length} operations)`
);
