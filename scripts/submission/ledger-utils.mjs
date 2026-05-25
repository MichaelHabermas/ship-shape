import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { week4 } from './week4-paths.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, '../..');
export const ledgerPath = resolve(repoRoot, 'my-docs/evidence/submission-ledger.json');
export const schemaPath = resolve(repoRoot, 'my-docs/evidence/schema.json');
export const dashboardPath = resolve(repoRoot, week4.dashboard);
export const reviewerBundlePath = resolve(repoRoot, week4.reviewerBundle);
export const improvementReportPath = resolve(repoRoot, week4.improvementReport);

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function readLedger() {
  return readJson(ledgerPath);
}

export function normalizeWrittenText(text) {
  const cleanText = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  return cleanText.endsWith('\n') ? cleanText : `${cleanText}\n`;
}

export function gitValue(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

export async function writeText(path, text) {
  await writeFile(path, normalizeWrittenText(text));
}

export function repoRelative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}

export function repoPathExists(path) {
  return existsSync(resolve(repoRoot, path));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function sentenceList(items) {
  return (items || []).filter(Boolean).join(' ');
}

export function statusLabel(status) {
  return String(status || '').replaceAll('_', ' ');
}

export function statusClass(status) {
  if (status === 'proven') return 'proven';
  if (status === 'partial') return 'partial';
  if (status === 'open') return 'open';
  if (status === 'needs_fill_in' || status === 'not_measured') return 'fill';
  return 'fill';
}
