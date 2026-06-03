// Writes the generated public /api/v1 OpenAPI 3.1 document to docs/openapi.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePublicOpenApiDocument } from '../platform/api/v1/openapi.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const outputPath = resolve(root, 'docs/openapi.json');
const document = generatePublicOpenApiDocument();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
