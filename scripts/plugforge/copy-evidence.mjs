#!/usr/bin/env node
// Copies PlugForge live evidence JSON and screenshot into web/public for deploy and Developer panel.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evidenceRoot,
  integrationEvidenceDir,
  metricsEvidenceDir,
  plugforgeEvidencePublicDir,
  repoRoot,
  slackScreenshotSource,
} from './reviewer/paths.mjs';

const EVIDENCE_FILES = [
  { from: path.join(integrationEvidenceDir, 'matrix.json'), to: 'matrix.json' },
  { from: path.join(integrationEvidenceDir, 'slack.json'), to: 'slack.json' },
  { from: path.join(integrationEvidenceDir, 'gitlab.json'), to: 'gitlab.json' },
  { from: path.join(integrationEvidenceDir, 'browser-sdk.json'), to: 'browser-sdk.json' },
  { from: path.join(metricsEvidenceDir, 'ttfe-timing.json'), to: 'ttfe-timing.json' },
];

export async function copyPlugforgeEvidence() {
  await mkdir(plugforgeEvidencePublicDir, { recursive: true });

  for (const entry of EVIDENCE_FILES) {
    await copyFile(entry.from, path.join(plugforgeEvidencePublicDir, entry.to));
    console.log(`Copied ${path.relative(repoRoot, entry.from)} → web/public/plugforge-evidence/${entry.to}`);
  }

  try {
    await copyFile(
      slackScreenshotSource,
      path.join(plugforgeEvidencePublicDir, 'slack-proof.png'),
    );
    console.log('Copied slack-proof.png → web/public/plugforge-evidence/slack-proof.png');
  } catch {
    console.warn(`Optional screenshot missing: ${path.relative(evidenceRoot, slackScreenshotSource)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  copyPlugforgeEvidence().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
