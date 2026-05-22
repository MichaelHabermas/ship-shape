import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, '../..');
export const ledgerPath = resolve(repoRoot, 'my-docs/evidence/submission-ledger.json');
export const schemaPath = resolve(repoRoot, 'my-docs/evidence/schema.json');
export const dashboardPath = resolve(repoRoot, 'my-docs/reviewer-dashboard.html');

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function readLedger() {
  return readJson(ledgerPath);
}

export async function writeText(path, text) {
  const cleanText = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  await writeFile(path, cleanText.endsWith('\n') ? cleanText : `${cleanText}\n`);
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
