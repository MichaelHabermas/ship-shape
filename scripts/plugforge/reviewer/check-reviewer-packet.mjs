#!/usr/bin/env node
// Fails when generated PlugForge reviewer packet HTML is stale vs evidence JSON.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReviewerPacket } from './render-reviewer-packet.mjs';
import { packetOutputs, repoRoot } from './paths.mjs';
import { normalizeHtml } from './reviewer-model.mjs';

async function main() {
  const requireScreenshot = process.argv.includes('--require-screenshot');
  const { html: expected } = await renderReviewerPacket({ requireScreenshot, dryRun: true });
  const normalizedExpected = normalizeHtml(expected);

  const mismatches = [];
  for (const outputPath of packetOutputs) {
    const actual = normalizeHtml(await readFile(outputPath, 'utf8'));
    if (actual !== normalizedExpected) {
      mismatches.push(path.relative(repoRoot, outputPath));
    }
  }

  if (mismatches.length > 0) {
    console.error('PlugForge reviewer packet is stale. Run pnpm plugforge:render-reviewer.');
    for (const file of mismatches) console.error(`  - ${file}`);
    process.exit(1);
  }

  console.log('PlugForge reviewer packet is current.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
