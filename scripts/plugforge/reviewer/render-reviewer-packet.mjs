#!/usr/bin/env node
// Renders PlugForge reviewer packet HTML from live integration evidence JSON.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReviewerEvidence } from './reviewer-evidence.mjs';
import { buildReviewerModel, normalizeHtml, openExternalLinksInNewTab } from './reviewer-model.mjs';
import { renderReviewerPacketHtml } from './render-html.mjs';
import { packetOutputs, repoRoot } from './paths.mjs';

export async function buildReviewerPacketHtml(options = {}) {
  const evidence = await loadReviewerEvidence({
    requireScreenshot: options.requireScreenshot ?? true,
  });
  const model = buildReviewerModel(evidence);
  const html = openExternalLinksInNewTab(normalizeHtml(renderReviewerPacketHtml(model)));
  return { model, html };
}

export async function renderReviewerPacket(options = {}) {
  const { model, html } = await buildReviewerPacketHtml(options);
  if (options.dryRun) return { model, html };

  await Promise.all(packetOutputs.map(async (outputPath) => {
    await writeFile(outputPath, html, 'utf8');
    console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
  }));

  return { model, html };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const requireScreenshot = process.argv.includes('--require-screenshot');
  try {
    await renderReviewerPacket({ requireScreenshot });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
