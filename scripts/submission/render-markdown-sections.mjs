#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  improvementReportPath,
  readLedger,
  repoRelative,
  writeText,
} from './ledger-utils.mjs';
import { buildLedgerModel, getCurrentLedgerTruth, formatValue } from './ledger-projections.mjs';

const validateLedgerScript = fileURLToPath(new URL('./validate-ledger.mjs', import.meta.url));
const START_MARKER = '<!-- ledger:generated start id="submission-current-truth" source="my-docs/evidence/submission-ledger.json" renderer="pnpm submission:render" -->';
const END_MARKER = '<!-- ledger:generated end id="submission-current-truth" -->';

export function renderCurrentTruthBlock(model) {
  const rows = getCurrentLedgerTruth(model);
  const lines = [
    START_MARKER,
    '| Category | Status | Ledger truth |',
    '| --- | --- | --- |',
    ...rows.map((row) =>
      `| Category ${row.categoryNumber} ${escapeMarkdownTable(row.title)} | \`${row.status}\` | ${escapeMarkdownTable(row.text)} |`
    ),
    '',
    `Gate snapshot: ${formatValue(model.gateSnapshot.proven)} proven, ${formatValue(model.gateSnapshot.partial)} partial, ${formatValue(model.gateSnapshot.openFill)} open/fill.`,
    END_MARKER,
  ];
  return lines.join('\n');
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

export function replaceCurrentTruthSection(markdown, generatedBlock) {
  const markedBlock = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`);
  if (markedBlock.test(markdown)) return markdown.replace(markedBlock, generatedBlock);

  const section = /(### Current Ledger Truth\n\n)([\s\S]*?)(\n### Operating Rule)/;
  if (!section.test(markdown)) {
    throw new Error('Could not find Current Ledger Truth section in IMPROVEMENT_REPORT.md');
  }
  return markdown.replace(section, `$1${generatedBlock}\n$3`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  execFileSync(process.execPath, [validateLedgerScript], { stdio: 'inherit' });
  const ledger = await readLedger();
  const model = buildLedgerModel(ledger);
  const generated = renderCurrentTruthBlock(model);
  const original = await readFile(improvementReportPath, 'utf8');
  const next = replaceCurrentTruthSection(original, generated);

  if (process.argv.includes('--check')) {
    if (next !== original) {
      console.error(`${repoRelative(improvementReportPath)} generated ledger block is stale. Run pnpm submission:render-markdown.`);
      process.exit(1);
    }
    console.log(`${repoRelative(improvementReportPath)} generated ledger block is current.`);
  } else {
    await writeText(improvementReportPath, next);
    console.log(`Markdown sections written to ${repoRelative(improvementReportPath)}`);
  }
}
