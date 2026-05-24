#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { buildEvidenceBundle } from './evidence-bundle-utils.mjs';
import { repoRelative } from './ledger-utils.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { outputPath } = await buildEvidenceBundle();
  console.log(`Reviewer evidence bundle written to ${repoRelative(outputPath)}`);
}
