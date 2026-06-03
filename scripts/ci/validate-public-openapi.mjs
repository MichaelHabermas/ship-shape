#!/usr/bin/env node
// MVP gate 7: generated public OpenAPI must be 3.1.x and include documents paths.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const specPath = resolve(process.cwd(), 'docs/openapi.json');
const document = JSON.parse(readFileSync(specPath, 'utf8'));
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

if (problems.length > 0) {
  console.error(`Public OpenAPI validation failed for ${specPath}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Public OpenAPI OK: ${specPath} (${document.openapi}, ${Object.keys(document.paths).length} paths)`
);
