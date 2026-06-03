// Generates FleetGraph product-surface eval reports for human review and trend tracking.
import { mkdir, writeFile, copyFile, access } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { pool } from '../db/client.js';
import {
  currentSurfaceCases,
  outputRoot,
  persistedSurfaceCases,
  repoRoot,
  reviewNotesPath,
  runsRoot,
} from './fleetgraph-product-surface/surface-eval-fixtures.js';
import {
  buildSurfaceEvalReport,
  htmlReport,
  markdownReport,
  sectionById,
} from './fleetgraph-product-surface/surface-eval-report.js';
import type { SurfaceEvalReport } from './fleetgraph-product-surface/surface-eval-types.js';

export type {
  SurfaceEvalReport,
  SurfaceEvalResult,
  SurfaceEvalSection,
  SurfaceEvalSectionId,
} from './fleetgraph-product-surface/surface-eval-types.js';
export { buildSurfaceEvalReport } from './fleetgraph-product-surface/surface-eval-report.js';

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function reportForNow(now = new Date()): Promise<SurfaceEvalReport> {
  return buildSurfaceEvalReport({
    generatedAt: now.toISOString(),
    currentCases: await currentSurfaceCases(),
    historicalCases: await persistedSurfaceCases(),
  });
}

async function ensureReviewNotes(): Promise<void> {
  try {
    await access(reviewNotesPath);
  } catch {
    await writeFile(reviewNotesPath, [
      '# FleetGraph Product Surface Review Notes',
      '',
      'Use this file for human judgment calls that the scores cannot know.',
      '',
      '## Template',
      '',
      '### <case id>',
      '',
      '- Decision: accept / tighten / change rubric',
      '- Reason:',
      '- Follow-up:',
      '',
    ].join('\n'), 'utf8');
  }
}

export async function main(): Promise<void> {
  const now = new Date();
  const report = await reportForNow(now);
  const runDir = path.join(runsRoot, timestampForPath(now));

  await mkdir(runDir, { recursive: true });
  await ensureReviewNotes();

  const json = JSON.stringify(report, null, 2) + '\n';
  const markdown = markdownReport(report);
  const html = htmlReport(report);

  const runJsonPath = path.join(runDir, 'results.json');
  const runMarkdownPath = path.join(runDir, 'report.md');
  const runHtmlPath = path.join(runDir, 'review-board.html');

  await writeFile(runJsonPath, json, 'utf8');
  await writeFile(runMarkdownPath, markdown, 'utf8');
  await writeFile(runHtmlPath, html, 'utf8');
  await copyFile(runJsonPath, path.join(outputRoot, 'latest.json'));
  await copyFile(runMarkdownPath, path.join(outputRoot, 'latest.md'));
  await copyFile(runHtmlPath, path.join(outputRoot, 'latest.html'));

  const historical = sectionById(report, 'historical');
  console.log(`FleetGraph product-surface eval current: ${report.summary.passCount} pass, ${report.summary.failCount} fail`);
  if (historical) {
    console.log(`FleetGraph product-surface eval historical: ${historical.summary.passCount} pass, ${historical.summary.failCount} fail (trend only)`);
  }
  console.log(`Markdown: ${path.relative(repoRoot, path.join(outputRoot, 'latest.md'))}`);
  console.log(`JSON: ${path.relative(repoRoot, path.join(outputRoot, 'latest.json'))}`);
  console.log(`Review board: ${path.relative(repoRoot, path.join(outputRoot, 'latest.html'))}`);
  console.log(`Run: ${path.relative(repoRoot, runDir)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
