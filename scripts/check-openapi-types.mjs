import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const generatedTypesPath = path.join(repoRoot, 'web/src/api/generated/ship-openapi.d.ts');

const contents = fs.readFileSync(generatedTypesPath, 'utf8');
const unknownRefMatches = contents.match(/components\["schemas"\]\["[^"]+"\] & unknown/g) ?? [];

if (unknownRefMatches.length > 0) {
  console.error('Generated OpenAPI types contain nullable-ref drift (& unknown):');
  for (const match of unknownRefMatches.slice(0, 10)) {
    console.error(`  - ${match}`);
  }
  if (unknownRefMatches.length > 10) {
    console.error(`  ... and ${unknownRefMatches.length - 10} more`);
  }
  process.exit(1);
}

console.log('OpenAPI generated types: no nullable-ref & unknown drift detected');
