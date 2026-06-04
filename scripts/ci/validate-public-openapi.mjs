#!/usr/bin/env node
// Validates the generated public OpenAPI against OAS 3.1 schema, Redocly, and registry parity.
import { validateCommittedPublicOpenApi } from '../lib/validate-public-openapi-document.mjs';

const { document, problems, specPath } = await validateCommittedPublicOpenApi();

if (problems.length > 0) {
  console.error(`Public OpenAPI validation failed for ${specPath}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const pathCount = Object.keys(document.paths ?? {}).length;
const operationCount = Object.values(document.paths ?? {}).reduce((count, pathItem) => {
  let next = count;
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    if (pathItem?.[method]?.operationId) next += 1;
  }
  return next;
}, 0);

console.log(
  `Public OpenAPI OK: ${specPath} (${document.openapi}, ${pathCount} paths, ${operationCount} operations)`
);
